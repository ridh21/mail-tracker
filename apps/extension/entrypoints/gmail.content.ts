import * as InboxSDK from "@inboxsdk/core";
import type { ComposeView, InboxSDK as SDK, MessageView, ThreadRowView } from "@inboxsdk/core";
import { GMAIL_ID_RE, type ThreadStatus } from "@mail-tracker/shared";
import Kefir from "kefir";
import { insertPixel, linkSignature, newTrackingId, rewriteLinks, stripPixels } from "@/lib/compose";
import { POPOVER_CSS, showPopover } from "@/lib/popover";
import { LIVE_PORT, send, type AuthState, type LiveMessage } from "@/lib/protocol";
import { StatusStore } from "@/lib/status-store";
import { assetUrl, messageTooltip, threadTooltip, tickIcon } from "@/lib/ticks";

const APP_ID = import.meta.env.WXT_INBOXSDK_APP_ID as string | undefined;

export default defineContentScript({
  matches: ["https://mail.google.com/*"],
  runAt: "document_end",
  async main() {
    if (!APP_ID) {
      console.error("[mail-tracker] WXT_INBOXSDK_APP_ID is not set; see apps/extension/.env.example");
      return;
    }
    const style = document.createElement("style");
    style.textContent = POPOVER_CSS;
    document.head.append(style);

    // Start everything at once: SDK boot is the slow part, so cache and auth load meanwhile.
    const store = new StatusStore();
    const [sdk, initialAuth] = await Promise.all([
      InboxSDK.load(2, APP_ID, { appName: "Mail Tracker" }),
      sendWithRetry(() => send({ type: "auth.state" })),
      store.hydrate(),
    ]);
    let auth = initialAuth;
    console.info(`[mail-tracker] ready · ${auth.connected ? `connected as ${auth.email}` : "NOT connected"} · ${auth.apiUrl}`);
    connectLive(store, (next) => (auth = next));

    warnIfDisconnected(sdk, auth);
    const getAuth = () => auth;
    registerCompose(sdk, getAuth);
    registerThreadRows(sdk, store);
    registerMessages(sdk, store, getAuth);
  },
});

/** The MV3 service worker may still be starting; retry the first calls briefly. */
async function sendWithRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 150 * 2 ** i));
    }
  }
}

/** Stable id when Gmail has one, otherwise wait for it instead of skipping the row. */
async function rowThreadId(row: ThreadRowView): Promise<string | null> {
  const stable = row.getThreadIDIfStable();
  if (stable) return stable;
  try {
    return (await row.getThreadIDIfStableAsync()) ?? (await row.getThreadIDAsync());
  } catch {
    return null;
  }
}

function connectLive(store: StatusStore, onAuth: (s: AuthState) => void) {
  const open = () => {
    const port = chrome.runtime.connect({ name: LIVE_PORT });
    port.onMessage.addListener((msg: LiveMessage) => {
      if (msg.type === "auth") return onAuth(msg.state);
      const e = msg.event;
      if (e.type === "message" || e.type === "open" || e.type === "revoke") store.upsertMessage(e.message);
      if (e.type === "reply") store.invalidate(e.reply.threadId);
    });
    // The service worker can restart; reconnect so live updates keep flowing.
    port.onDisconnect.addListener(() => setTimeout(open, 1000));
  };
  open();
}

function warnIfDisconnected(sdk: SDK, auth: AuthState) {
  if (auth.connected) return;
  sdk.ButterBar.showMessage({
    text: "Mail Tracker isn't connected. Open the extension popup and click Connect to start tracking.",
    time: 10_000,
  });
}

function recipientsOf(cv: ComposeView) {
  const emails = (list: { emailAddress: string }[]) => list.map((c) => c.emailAddress.trim().toLowerCase()).filter(Boolean);
  return { to: emails(cv.getToRecipients()), cc: emails(cv.getCcRecipients()), bcc: emails(cv.getBccRecipients()) };
}

function registerCompose(sdk: SDK, getAuth: () => AuthState) {
  sdk.Compose.registerComposeViewHandler((cv) => {
    const auth = getAuth();
    const state = {
      trackingId: newTrackingId(),
      enabled: auth.settings.trackByDefault,
      signature: null as string | null,
      links: null as { idx: number; url: string }[] | null,
      registered: false,
    };

    // HMAC is async and presending must be synchronous, so sign up front.
    if (auth.settings.linkTracking && auth.linkKey && auth.uid) {
      void linkSignature(auth.linkKey, auth.uid, state.trackingId).then((sig) => (state.signature = sig));
    }

    const button = Kefir.stream<{ title: string; iconUrl: string; onClick: () => void }, never>((emitter) => {
      const emit = () =>
        emitter.emit({
          title: state.enabled ? "Tracking on: click to send without tracking" : "Tracking off: click to track this email",
          iconUrl: assetUrl(state.enabled ? "/ticks/tracking-on.svg" : "/ticks/tracking-off.svg"),
          onClick: () => {
            state.enabled = !state.enabled;
            emit();
          },
        });
      emit();
    });
    cv.addButton(button as never);

    cv.on("presending", () => {
      const current = getAuth();
      if (!state.enabled || !current.connected) return;
      const { to, cc, bcc } = recipientsOf(cv);
      if (!to.length && !cc.length && !bcc.length) return;

      try {
        const body = cv.getBodyElement();
        stripPixels(body, current.apiUrl);
        if (state.links === null && state.signature && current.uid) {
          state.links = rewriteLinks(body, {
            apiUrl: current.apiUrl,
            uid: current.uid,
            trackingId: state.trackingId,
            signature: state.signature,
          });
        }
        insertPixel(body, current.apiUrl, state.trackingId);
      } catch (err) {
        // Never block the send because of tracking.
        console.error("[mail-tracker] could not add tracking", err);
        return;
      }

      const threadId = cv.isReply() ? cv.getThreadID() : "";
      state.registered = true;
      void send({
        type: "register",
        payload: {
          trackingId: state.trackingId,
          subject: cv.getSubject(),
          to,
          cc,
          bcc,
          isReply: cv.isReply(),
          threadId: GMAIL_ID_RE.test(threadId) ? threadId : undefined,
          links: state.links ?? [],
          composedAt: Date.now(),
        },
      }).catch((err) => console.error("[mail-tracker] register failed", err));
    });

    cv.on("sent", async (event) => {
      if (!state.registered) return;
      const [gmailMessageId, threadId] = await Promise.all([event.getMessageID(), event.getThreadID()]);
      if (!GMAIL_ID_RE.test(gmailMessageId) || !GMAIL_ID_RE.test(threadId)) return;
      void send({ type: "sent", trackingId: state.trackingId, payload: { gmailMessageId, threadId, sentAt: Date.now() } });
      // Gmail renders the sent message in the open thread right away.
      void send({ type: "view", threadId }).catch(() => undefined);
    });
  });
}

function statusStream<T>(store: StatusStore, threadId: string, map: (s: ThreadStatus | null) => T | null) {
  return Kefir.stream<T | null, never>((emitter) => store.subscribe(threadId, (s) => emitter.emit(map(s))));
}

function registerThreadRows(sdk: SDK, store: StatusStore) {
  sdk.Lists.registerThreadRowViewHandler((row: ThreadRowView) => {
    void rowThreadId(row).then((threadId) => {
      if (!threadId || row.destroyed || !GMAIL_ID_RE.test(threadId)) return;
      row.addImage(
        statusStream(store, threadId, (s) =>
          s && s.tick !== "untracked"
            ? {
                imageUrl: tickIcon(s.tick),
                imageClass: "mt-tick",
                tooltip: threadTooltip(s),
                orderHint: -100,
                onHover: ({ hoverEnd }: { hoverEnd: Promise<void> }) => {
                  const status = store.get(threadId);
                  if (status) void showPopover(row.getElement(), status, hoverEnd);
                },
              }
            : null,
        ) as never,
      );
    });
  });
}

/** Debounced "the sender is looking at this thread" ping, used to discard self-opens. */
const lastPing = new Map<string, number>();
function pingView(threadId: string) {
  if (!GMAIL_ID_RE.test(threadId)) return;
  const now = Date.now();
  if (now - (lastPing.get(threadId) ?? 0) < 1500) return;
  lastPing.set(threadId, now);
  void send({ type: "view", threadId }).catch(() => undefined);
}

function registerMessages(sdk: SDK, store: StatusStore, getAuth: () => AuthState) {
  sdk.Conversations.registerThreadViewHandler((thread) => {
    void thread.getThreadIDAsync().then(pingView);
  });

  sdk.Conversations.registerMessageViewHandler((mv: MessageView) => {
    const thread = mv.getThreadView();
    void thread.getThreadIDAsync().then((threadId) => {
      pingView(threadId);
      mv.on("viewStateChange", (e) => e.newViewState === "EXPANDED" && pingView(threadId));

      const me = getAuth().email ?? sdk.User.getEmailAddress();
      if (mv.getSender().emailAddress.toLowerCase() !== me.toLowerCase()) return;

      void mv.getMessageIDAsync().then((gmailMessageId) => {
        if (mv.destroyed) return;
        mv.addAttachmentIcon(
          statusStream(store, threadId, (s) => {
            const m = s?.messages.find((x) => x.gmailMessageId === gmailMessageId);
            if (!m || m.tick === "untracked") return null;
            return {
              iconUrl: tickIcon(m.tick),
              iconClass: "mt-tick",
              tooltip: messageTooltip(m),
              onClick: () => window.open(`${getAuth().apiUrl}/m/${encodeURIComponent(m.id)}`, "_blank", "noopener"),
            };
          }) as never,
        );
      });
    });
  });
}
