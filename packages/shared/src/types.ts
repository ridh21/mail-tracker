import type { Settings } from "./schemas";
import type { Tick } from "./ticks";

export type OpenSource =
  | "gmail"
  | "yahoo"
  | "outlook"
  | "apple_mpp"
  | "scanner"
  | "direct";

/** Why an open did not count toward the "seen" state. */
export type DiscardReason =
  | "self_view"
  | "just_sent"
  | "duplicate"
  | "quoted"
  | "prefetch"
  | "bot";

export interface OpenEvent {
  id: number;
  kind: "open" | "click";
  at: number;
  source: OpenSource;
  counted: boolean;
  reason: DiscardReason | null;
  country: string | null;
  city: string | null;
  linkUrl: string | null;
}

export interface MessageSummary {
  id: string;
  trackingId: string | null;
  gmailMessageId: string | null;
  threadId: string | null;
  subject: string;
  recipients: string[];
  isReply: boolean;
  sentAt: number | null;
  bouncedAt: number | null;
  openCount: number;
  clickCount: number;
  firstOpenAt: number | null;
  lastOpenAt: number | null;
  tick: Tick;
}

export interface ReplySummary {
  gmailMessageId: string;
  threadId: string;
  fromEmail: string;
  fromName: string | null;
  at: number;
  isBounce: boolean;
  snippet: string | null;
}

export interface ThreadStatus {
  threadId: string;
  tick: Tick;
  openCount: number;
  lastOpenAt: number | null;
  replyCount: number;
  lastReplyAt: number | null;
  messages: MessageSummary[];
}

export type TimelineItem =
  | { type: "sent"; at: number; message: MessageSummary }
  | { type: "open"; at: number; messageId: string; event: OpenEvent }
  | { type: "reply"; at: number; reply: ReplySummary };

/** Events pushed over the realtime socket. */
export type RealtimeEvent =
  | { type: "message"; message: MessageSummary }
  | { type: "open"; message: MessageSummary; event: OpenEvent }
  /** A counted open turned out to be the sender's own view or a quoted pixel. */
  | { type: "revoke"; message: MessageSummary; eventId: number }
  | { type: "reply"; reply: ReplySummary }
  | { type: "gmail_status"; status: GmailStatus };

export type GmailStatus = "ok" | "reauth_required" | "watch_failed";

export interface Me {
  id: string;
  email: string;
  name: string | null;
  picture: string | null;
  gmailStatus: GmailStatus;
  watchExpiresAt: number | null;
  settings: Settings;
}
