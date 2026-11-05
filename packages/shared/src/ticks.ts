/**
 * WhatsApp-style delivery states.
 *
 * Email has no delivery receipt. "Delivered" is real evidence when we have it
 * (an Apple Mail or mail-security prefetch at arrival, or an open), otherwise
 * "sent and no bounce within the delivery window", which the worker stamps as
 * deliveredAt when the window closes so every screen updates live.
 */
export type Tick = "pending" | "sent" | "delivered" | "opened" | "bounced" | "untracked";

export const DELIVERED_AFTER_MS = 3 * 60_000;
/** Gmail rejects unknown addresses within seconds, so Gmail-only mail settles fast. */
export const GMAIL_DELIVERED_AFTER_MS = 30_000;

const GMAIL_DOMAIN = /@(gmail|googlemail)\.com$/i;

/** How long to wait for a bounce before calling a message delivered. */
export function deliveryWindowMs(recipients: string[] | undefined): number {
  return recipients?.length && recipients.every((r) => GMAIL_DOMAIN.test(r.trim()))
    ? GMAIL_DELIVERED_AFTER_MS
    : DELIVERED_AFTER_MS;
}

export interface TickInput {
  tracked: boolean;
  sentAt: number | null;
  bouncedAt: number | null;
  openCount: number;
  /** Stamped by the worker on arrival evidence, an open, or the bounce window closing. */
  deliveredAt?: number | null;
  /** Picks the bounce window while deliveredAt hasn't been stamped yet. */
  recipients?: string[];
}

export function deriveTick(m: TickInput, now = Date.now()): Tick {
  if (m.bouncedAt) return "bounced";
  if (!m.tracked) return m.sentAt ? "untracked" : "pending";
  if (m.openCount > 0) return "opened";
  if (!m.sentAt) return "pending";
  if (m.deliveredAt) return "delivered";
  return now - m.sentAt >= deliveryWindowMs(m.recipients) ? "delivered" : "sent";
}

const RANK: Record<Tick, number> = {
  untracked: 0,
  pending: 1,
  sent: 2,
  delivered: 3,
  opened: 4,
  bounced: 5,
};

/** The tick a thread row shows: the most significant state of its latest tracked message. */
export function threadTick(ticks: Tick[]): Tick {
  return ticks.reduce<Tick>((best, t) => (RANK[t] > RANK[best] ? t : best), "untracked");
}

export const TICK_LABEL: Record<Tick, string> = {
  pending: "Sending",
  sent: "Sent",
  delivered: "Delivered",
  opened: "Opened",
  bounced: "Bounced",
  untracked: "Not tracked",
};
