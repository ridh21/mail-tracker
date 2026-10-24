import { deriveTick, type MessageSummary, type ThreadStatus } from "@mail-tracker/shared";
import { send } from "./protocol";

type Listener = (status: ThreadStatus | null) => void;
type Entry = { value: ThreadStatus | null; fetchedAt: number };

const BATCH_DELAY_MS = 30;
const MAX_BATCH = 100;
const STALE_MS = 60_000;
const FOCUS_REFRESH_MS = 15_000;
const RETRY_MAX_MS = 30_000;
const CACHE_KEY = "statusCache";
const CACHE_LIMIT = 3000;
const CACHE_TTL_MS = 14 * 86400_000;

/**
 * Thread id → tracking status for everything Gmail is showing.
 *
 * Ticks paint from a persisted cache the moment a row appears, then refresh in
 * the background. Lookups are batched, retried with backoff when the service
 * worker or network hiccups, re-fetched on realtime events and on tab focus,
 * and ticks age locally (sent → delivered happens with time, not an event).
 */
export class StatusStore {
  private statuses = new Map<string, Entry>();
  private listeners = new Map<string, Set<Listener>>();
  private queue = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flushing = false;
  private retryDelay = 500;
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private lastFocusRefresh = 0;

  constructor() {
    setInterval(() => this.age(), 30_000);
    const refresh = () => {
      if (document.visibilityState !== "visible" || Date.now() - this.lastFocusRefresh < FOCUS_REFRESH_MS) return;
      this.lastFocusRefresh = Date.now();
      for (const id of this.listeners.keys()) this.queue.add(id);
      this.schedule(0);
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
  }

  /** Loads the last known statuses so ticks render before any network call. */
  async hydrate() {
    try {
      const out = await chrome.storage.local.get(CACHE_KEY);
      const cached = (out[CACHE_KEY] ?? {}) as Record<string, Entry>;
      const cutoff = Date.now() - CACHE_TTL_MS;
      for (const [id, entry] of Object.entries(cached)) {
        // Cached entries are shown immediately but always count as stale.
        if (entry.fetchedAt > cutoff && !this.statuses.has(id)) this.statuses.set(id, { value: entry.value, fetchedAt: 0 });
      }
    } catch {
      // Cache is a nicety; carry on without it.
    }
  }

  subscribe(threadId: string, fn: Listener): () => void {
    let set = this.listeners.get(threadId);
    if (!set) this.listeners.set(threadId, (set = new Set()));
    set.add(fn);

    const cached = this.statuses.get(threadId);
    if (cached) fn(this.aged(cached.value));
    if (!cached || Date.now() - cached.fetchedAt > STALE_MS) this.request(threadId);

    return () => {
      set.delete(fn);
      if (!set.size) this.listeners.delete(threadId);
    };
  }

  get(threadId: string): ThreadStatus | null {
    return this.statuses.get(threadId)?.value ?? null;
  }

  /** Something changed server-side for this thread: refetch it now. */
  invalidate(threadId: string) {
    this.queue.add(threadId);
    this.schedule(0);
  }

  /** Optimistic update straight from a realtime message event. */
  upsertMessage(message: MessageSummary) {
    if (!message.threadId) return;
    const current = this.get(message.threadId);
    if (current) {
      const messages = current.messages.some((m) => m.id === message.id)
        ? current.messages.map((m) => (m.id === message.id ? message : m))
        : [...current.messages, message];
      this.set(message.threadId, { ...current, messages, ...summarise(messages) });
    }
    this.invalidate(message.threadId);
  }

  private request(threadId: string) {
    this.queue.add(threadId);
    this.schedule(BATCH_DELAY_MS);
  }

  private schedule(delay: number) {
    if (this.flushing) return; // the running flush picks the queue up when done
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), delay);
  }

  private async flush() {
    if (this.flushing) return;
    this.flushing = true;
    let failed = false;
    try {
      while (this.queue.size && !failed) {
        const batch = [...this.queue].slice(0, MAX_BATCH);
        for (const id of batch) this.queue.delete(id);
        try {
          const results = await send({ type: "status", threadIds: batch });
          const found = new Map(results.map((s) => [s.threadId, s]));
          for (const id of batch) this.set(id, found.get(id) ?? null);
          if (found.size) console.debug(`[mail-tracker] ticks for ${found.size}/${batch.length} visible threads`);
          this.retryDelay = 500;
        } catch (err) {
          console.warn("[mail-tracker] status lookup failed, retrying", err);
          // Service worker asleep, offline or reconnecting: keep them queued and retry.
          for (const id of batch) this.queue.add(id);
          failed = true;
        }
      }
    } finally {
      this.flushing = false;
    }
    if (failed) {
      this.schedule(this.retryDelay);
      this.retryDelay = Math.min(RETRY_MAX_MS, this.retryDelay * 2);
    } else if (this.queue.size) {
      this.schedule(0);
    }
  }

  private set(threadId: string, value: ThreadStatus | null) {
    this.statuses.set(threadId, { value, fetchedAt: Date.now() });
    const shown = this.aged(value);
    for (const fn of this.listeners.get(threadId) ?? []) fn(shown);
    this.persistSoon();
  }

  private persistSoon() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      // Keep the newest entries; untracked (null) threads are cheap and avoid refetch flicker.
      const entries = [...this.statuses].filter(([, e]) => e.fetchedAt > 0).sort((a, b) => b[1].fetchedAt - a[1].fetchedAt);
      void chrome.storage.local
        .set({ [CACHE_KEY]: Object.fromEntries(entries.slice(0, CACHE_LIMIT)) })
        .catch(() => undefined);
    }, 1000);
  }

  /** Re-derive ticks from timestamps so cached and long-lived values stay correct. */
  private aged(value: ThreadStatus | null): ThreadStatus | null {
    if (!value) return null;
    const messages = value.messages.map((m) => ({
      ...m,
      tick: deriveTick({ tracked: Boolean(m.trackingId), sentAt: m.sentAt, bouncedAt: m.bouncedAt, openCount: m.openCount }),
    }));
    return { ...value, messages, ...summarise(messages) };
  }

  private age() {
    for (const [threadId, { value }] of this.statuses) {
      if (!value || !this.listeners.has(threadId)) continue;
      const next = this.aged(value)!;
      if (next.tick !== value.tick) {
        this.statuses.set(threadId, { value: next, fetchedAt: this.statuses.get(threadId)!.fetchedAt });
        for (const fn of this.listeners.get(threadId) ?? []) fn(next);
      }
    }
  }
}

function summarise(messages: MessageSummary[]) {
  const tracked = messages.filter((m) => m.trackingId);
  const latest = tracked.at(-1) ?? messages.at(-1);
  const opens = tracked.flatMap((m) => (m.lastOpenAt ? [m.lastOpenAt] : []));
  return {
    tick: latest?.tick ?? ("untracked" as const),
    openCount: tracked.reduce((n, m) => n + m.openCount, 0),
    lastOpenAt: opens.length ? Math.max(...opens) : null,
  };
}
