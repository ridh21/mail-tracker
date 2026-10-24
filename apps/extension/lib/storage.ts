import { settingsSchema, type RegisterMessageInput, type LinkSentInput, type Settings } from "@mail-tracker/shared";

export const API_URL = (import.meta.env.WXT_API_URL || "http://localhost:8787").replace(/\/$/, "");

export interface Credentials {
  token: string;
  uid: string;
  email: string;
  linkKey: string;
}

export type OutboxItem =
  | { id: string; kind: "register"; payload: RegisterMessageInput; attempts: number; createdAt: number }
  | { id: string; kind: "sent"; trackingId: string; payload: LinkSentInput; attempts: number; createdAt: number };

interface Shape {
  credentials: Credentials | null;
  settings: Settings;
  outbox: OutboxItem[];
  /** Event ids already shown as notifications. */
  notified: number[];
  /** Newest event time notified about; catch-up fetches after it. */
  notifyCursor: number | null;
}

const DEFAULTS: Shape = {
  credentials: null,
  settings: settingsSchema.parse({}),
  outbox: [],
  notified: [],
  notifyCursor: null,
};

export async function read<K extends keyof Shape>(key: K): Promise<Shape[K]> {
  const out = await chrome.storage.local.get(key);
  return (out[key] as Shape[K] | undefined) ?? DEFAULTS[key];
}

export function write<K extends keyof Shape>(key: K, value: Shape[K]): Promise<void> {
  return chrome.storage.local.set({ [key]: value });
}

/** Serialises read-modify-write cycles on the outbox within this service worker. */
let outboxLock: Promise<unknown> = Promise.resolve();
export function updateOutbox(fn: (items: OutboxItem[]) => OutboxItem[]): Promise<OutboxItem[]> {
  const run = outboxLock.then(async () => {
    const next = fn(await read("outbox"));
    await write("outbox", next);
    return next;
  });
  outboxLock = run.catch(() => undefined);
  return run;
}
