/**
 * WhatsApp-style delivery states.
 *
 * Email has no delivery receipt, so "delivered" means "sent and no bounce seen
 * within DELIVERED_AFTER_MS" — the same heuristic every tracker uses.
 */
export type Tick = "pending" | "sent" | "delivered" | "opened" | "bounced" | "untracked";

export const DELIVERED_AFTER_MS = 3 * 60_000;

export interface TickInput {
  tracked: boolean;
  sentAt: number | null;
  bouncedAt: number | null;
  openCount: number;
}

export function deriveTick(m: TickInput, now = Date.now()): Tick {
  if (m.bouncedAt) return "bounced";
  if (!m.tracked) return m.sentAt ? "untracked" : "pending";
  if (m.openCount > 0) return "opened";
  if (!m.sentAt) return "pending";
  return now - m.sentAt >= DELIVERED_AFTER_MS ? "delivered" : "sent";
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
