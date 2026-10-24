import type {
  LinkSentInput,
  MessageSummary,
  OpenEvent,
  RealtimeEvent,
  RegisterMessageInput,
  Settings,
  ThreadStatus,
  TimelineItem,
} from "@mail-tracker/shared";

export interface AuthState {
  connected: boolean;
  apiUrl: string;
  uid: string | null;
  email: string | null;
  linkKey: string | null;
  settings: Settings;
}

export interface MessageDetail {
  message: MessageSummary;
  events: OpenEvent[];
  timeline: TimelineItem[];
}

/** Requests from content scripts / popup to the background service worker. */
export type Request =
  | { type: "auth.state" }
  | { type: "auth.connect" }
  | { type: "auth.disconnect" }
  | { type: "settings.update"; patch: Partial<Settings> }
  | { type: "register"; payload: RegisterMessageInput }
  | { type: "sent"; trackingId: string; payload: LinkSentInput }
  | { type: "view"; threadId: string }
  | { type: "status"; threadIds: string[] }
  | { type: "detail"; messageId: string };

export interface ResponseMap {
  "auth.state": AuthState;
  "auth.connect": AuthState;
  "auth.disconnect": AuthState;
  "settings.update": AuthState;
  register: { queued: true };
  sent: { queued: true };
  view: { ok: boolean };
  status: ThreadStatus[];
  detail: MessageDetail | null;
}

export type Reply<T extends Request["type"]> = { ok: true; data: ResponseMap[T] } | { ok: false; error: string };

export async function send<T extends Request>(req: T): Promise<ResponseMap[T["type"]]> {
  const res = (await chrome.runtime.sendMessage(req)) as Reply<T["type"]> | undefined;
  if (!res) throw new Error("No response from background");
  if (!res.ok) throw new Error(res.error);
  return res.data;
}

/** Long-lived port name for realtime events pushed to Gmail tabs. */
export const LIVE_PORT = "mail-tracker:live";

export type LiveMessage = { type: "event"; event: RealtimeEvent } | { type: "auth"; state: AuthState };
