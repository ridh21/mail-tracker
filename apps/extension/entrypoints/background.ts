import "@inboxsdk/core/background.js";
import type { Me, MessageSummary, OpenEvent, RealtimeEvent, Settings, ThreadStatus } from "@mail-tracker/shared";
import { LIVE_PORT, type AuthState, type LiveMessage, type MessageDetail, type Request, type ResponseMap } from "@/lib/protocol";
import { API_URL, read, updateOutbox, write, type Credentials, type OutboxItem } from "@/lib/storage";

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const OUTBOX_MAX_AGE_MS = 3 * 86400_000;
const ports = new Set<chrome.runtime.Port>();

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const creds = await read("credentials");
  if (!creds) throw new HttpError(401, "Not connected");
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...init.headers, authorization: `Bearer ${creds.token}`, "content-type": "application/json" },
  });
  if (res.status === 401) {
    await disconnect();
    throw new HttpError(401, "Session expired, reconnect Mail Tracker");
  }
  if (!res.ok) throw new HttpError(res.status, `${path} failed with ${res.status}`);
  return (res.status === 204 ? null : await res.json()) as T;
}

async function authState(): Promise<AuthState> {
  const [creds, settings] = await Promise.all([read("credentials"), read("settings")]);
  return {
    connected: Boolean(creds),
    apiUrl: API_URL,
    uid: creds?.uid ?? null,
    email: creds?.email ?? null,
    linkKey: creds?.linkKey ?? null,
    settings,
  };
}

function broadcast(msg: LiveMessage) {
  for (const port of ports) port.postMessage(msg);
}

async function refreshMe() {
  const me = await api<Me>("/api/me");
  await write("settings", me.settings);
  broadcast({ type: "auth", state: await authState() });
}

async function connect(): Promise<AuthState> {
  const state = crypto.randomUUID();
  const redirect = chrome.identity.getRedirectURL("connect");
  const url = `${API_URL}/auth/extension/connect?${new URLSearchParams({ redirect_uri: redirect, state })}`;
  const result = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
  if (!result) throw new Error("Connection was cancelled");

  const params = new URLSearchParams(new URL(result).hash.slice(1));
  if (params.get("state") !== state) throw new Error("Connection state mismatch, try again");
  const creds: Credentials = {
    token: params.get("token") ?? "",
    uid: params.get("uid") ?? "",
    email: params.get("email") ?? "",
    linkKey: params.get("linkKey") ?? "",
  };
  if (!creds.token || !creds.uid) throw new Error("Server did not return credentials");
  await write("credentials", creds);
  await refreshMe();
  socket.ensure();
  void flushOutbox();
  return authState();
}

async function disconnect(): Promise<AuthState> {
  await write("credentials", null);
  socket.close();
  const state = await authState();
  broadcast({ type: "auth", state });
  return state;
}

// --- Outbox: registrations must survive network blips and SW restarts ------

async function enqueue(item: OutboxItem) {
  await updateOutbox((items) => [...items.filter((i) => i.id !== item.id), item]);
  void flushOutbox();
}

let flushing: Promise<void> | null = null;
function flushOutbox(): Promise<void> {
  flushing ??= (async () => {
    try {
      const items = await read("outbox");
      for (const item of items) {
        if (Date.now() - item.createdAt > OUTBOX_MAX_AGE_MS) {
          await updateOutbox((all) => all.filter((i) => i.id !== item.id));
          continue;
        }
        try {
          if (item.kind === "register") {
            await api("/api/messages", { method: "POST", body: JSON.stringify(item.payload) });
          } else {
            await api(`/api/messages/${item.trackingId}/sent`, { method: "POST", body: JSON.stringify(item.payload) });
          }
          await updateOutbox((all) => all.filter((i) => i.id !== item.id));
        } catch (err) {
          const status = err instanceof HttpError ? err.status : 0;
          if (status >= 400 && status < 500 && status !== 401 && status !== 429) {
            // Permanently rejected; retrying can't help.
            await updateOutbox((all) => all.filter((i) => i.id !== item.id));
            continue;
          }
          await updateOutbox((all) => all.map((i) => (i.id === item.id ? { ...i, attempts: i.attempts + 1 } : i)));
          break; // keep ordering: a "sent" must never overtake its "register"
        }
      }
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

// --- Realtime socket -------------------------------------------------------

const socket = (() => {
  let ws: WebSocket | null = null;
  let keepalive: ReturnType<typeof setInterval> | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let attempt = 0;

  async function open() {
    if (ws || !(await read("credentials"))) return;
    try {
      const { ticket } = await api<{ ticket: string }>("/api/realtime/ticket", { method: "POST" });
      const url = new URL(`${API_URL}/api/realtime`);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.searchParams.set("ticket", ticket);
      ws = new WebSocket(url);
    } catch {
      return schedule();
    }

    ws.onopen = () => {
      attempt = 0;
      // Socket traffic keeps the MV3 service worker alive, so opens notify even with Gmail closed.
      keepalive = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send("ping"), 20_000);
      void refreshMe().catch(() => undefined);
      void catchUp();
    };
    ws.onmessage = (e) => {
      if (e.data === "pong") return;
      try {
        onRealtime(JSON.parse(String(e.data)) as RealtimeEvent);
      } catch {
        // ignore malformed frames
      }
    };
    ws.onclose = () => {
      clearInterval(keepalive);
      ws = null;
      schedule();
    };
  }

  function schedule() {
    clearTimeout(retry);
    const delay = Math.min(60_000, 1000 * 2 ** attempt++) + Math.random() * 1000;
    retry = setTimeout(() => void open(), delay);
  }

  return {
    ensure: () => void open(),
    close() {
      clearTimeout(retry);
      clearInterval(keepalive);
      ws?.close();
      ws = null;
    },
  };
})();

async function onRealtime(event: RealtimeEvent) {
  broadcast({ type: "event", event });
  const settings: Settings = await read("settings");

  if (event.type === "open") await notifySeen(event.message, event.event, settings);
  // It was the sender's own view after all: take the notification back.
  if (event.type === "revoke") chrome.notifications.clear(`m:${event.message.id}:${event.eventId}`);
  if (event.type === "reply" && settings.notifyOnReply && !event.reply.isBounce) {
    chrome.notifications.create(`t:${event.reply.threadId}:${event.reply.gmailMessageId}`, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("/icon/128.png"),
      title: `Reply from ${event.reply.fromName ?? event.reply.fromEmail}`,
      message: event.reply.snippet ?? "",
    });
  }
}

// --- "Seen" notifications ------------------------------------------------

const NOTIFIED_LIMIT = 500;
let notifyLock: Promise<unknown> = Promise.resolve();

function recipientsLine(m: MessageSummary) {
  const extra = m.recipients.length > 1 ? ` +${m.recipients.length - 1}` : "";
  return (m.recipients[0] ?? "Recipient") + extra;
}

/** Shows one notification per counted open/click, never twice, and advances the catch-up cursor. */
function notifySeen(m: MessageSummary, e: OpenEvent, settings: Settings) {
  const run = notifyLock.then(async () => {
    if (!e.counted) return;
    const [notified, cursor] = await Promise.all([read("notified"), read("notifyCursor")]);
    if (notified.includes(e.id)) return;
    await Promise.all([
      write("notified", [...notified, e.id].slice(-NOTIFIED_LIMIT)),
      write("notifyCursor", Math.max(cursor ?? 0, e.at)),
    ]);
    if (!settings.notifyOnOpen || Date.now() - e.at > 24 * 3600_000) return;

    const title =
      e.kind === "click"
        ? `Link clicked by ${recipientsLine(m)}`
        : m.openCount > 1
          ? `Seen again by ${recipientsLine(m)} · ${m.openCount}×`
          : `Seen by ${recipientsLine(m)}`;
    chrome.notifications.create(`m:${m.id}:${e.id}`, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("/icon/128.png"),
      title,
      message: m.subject || "(no subject)",
      contextMessage: new Date(e.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }),
      priority: 2,
      silent: false,
    });
  });
  notifyLock = run.catch(() => undefined);
  return run;
}

/** Notifies about opens that happened while the service worker or socket was down. */
async function catchUp() {
  if (!(await read("credentials"))) return;
  const cursor = await read("notifyCursor");
  if (cursor === null) {
    // First run: don't flood with history, start from now.
    await write("notifyCursor", Date.now());
    return;
  }
  try {
    const items = await api<{ event: OpenEvent; message: MessageSummary }[]>(`/api/events?since=${cursor}`);
    const settings = await read("settings");
    for (const { event, message } of items) {
      await notifySeen(message, event, settings);
      broadcast({ type: "event", event: { type: "open", message, event } });
    }
  } catch {
    // Retried on the next alarm.
  }
}

// --- Wiring ----------------------------------------------------------------

async function handle(req: Request): Promise<ResponseMap[Request["type"]]> {
  switch (req.type) {
    case "auth.state":
      return authState();
    case "auth.connect":
      return connect();
    case "auth.disconnect":
      return disconnect();
    case "settings.update": {
      const next = await api<Settings>("/api/settings", { method: "PATCH", body: JSON.stringify(req.patch) });
      await write("settings", next);
      const state = await authState();
      broadcast({ type: "auth", state });
      return state;
    }
    case "register":
      await enqueue({ id: `r:${req.payload.trackingId}`, kind: "register", payload: req.payload, attempts: 0, createdAt: Date.now() });
      return { queued: true };
    case "sent":
      await enqueue({ id: `s:${req.trackingId}`, kind: "sent", trackingId: req.trackingId, payload: req.payload, attempts: 0, createdAt: Date.now() });
      return { queued: true };
    case "view":
      await api("/api/views", { method: "POST", body: JSON.stringify({ threadId: req.threadId }) });
      return { ok: true };
    case "status":
      return api<ThreadStatus[]>("/api/status", { method: "POST", body: JSON.stringify({ threadIds: req.threadIds }) });
    case "detail":
      return api<MessageDetail>(`/api/messages/${encodeURIComponent(req.messageId)}`).catch(() => null);
  }
}

export default defineBackground(() => {
  chrome.runtime.onMessage.addListener((req: Request, sender, sendResponse) => {
    // Only our own pages and content scripts may drive the background.
    if (sender.id !== chrome.runtime.id) return false;
    if (!req || typeof req !== "object" || !("type" in req) || String(req.type).startsWith("inboxsdk__")) return false;
    handle(req).then(
      (data) => sendResponse({ ok: true, data }),
      (err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
    );
    return true;
  });

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== LIVE_PORT || port.sender?.id !== chrome.runtime.id) return;
    ports.add(port);
    socket.ensure();
    port.onDisconnect.addListener(() => ports.delete(port));
  });

  // Wakes the worker every 30s: retry the outbox, revive the socket, catch up on missed opens.
  chrome.alarms.create("heartbeat", { periodInMinutes: 0.5 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== "heartbeat") return;
    void flushOutbox();
    socket.ensure();
    void catchUp();
  });
  chrome.runtime.onStartup.addListener(() => socket.ensure());
  socket.ensure();

  chrome.notifications.onClicked.addListener((id) => {
    const [kind, ref] = id.split(":");
    const path = kind === "m" && ref ? `/m/${encodeURIComponent(ref)}` : "/";
    void chrome.tabs.create({ url: `${API_URL}${path}` });
    chrome.notifications.clear(id);
  });
});
