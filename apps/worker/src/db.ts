import {
  deriveTick,
  settingsSchema,
  type GmailStatus,
  type Me,
  type MessageSummary,
  type OpenEvent,
  type ReplySummary,
  type ThreadStatus,
} from "@mail-tracker/shared";

export interface UserRow {
  id: string;
  google_sub: string;
  email: string;
  name: string | null;
  picture: string | null;
  settings: string;
  link_key: string;
  gmail_status: GmailStatus;
  history_id: string | null;
  watch_expires_at: number | null;
  created_at: number;
}

export interface MessageRow {
  id: string;
  user_id: string;
  tracking_id: string | null;
  gmail_message_id: string | null;
  thread_id: string | null;
  subject: string;
  recipients: string;
  is_reply: number;
  registered_at: number;
  sent_at: number | null;
  gmail_confirmed: number;
  bounced_at: number | null;
  open_count: number;
  click_count: number;
  first_open_at: number | null;
  last_open_at: number | null;
}

export interface EventRow {
  id: number;
  tracking_id: string;
  user_id: string | null;
  message_id: string | null;
  kind: "open" | "click";
  link_idx: number | null;
  at: number;
  source: OpenEvent["source"];
  counted: number;
  reason: OpenEvent["reason"];
  country: string | null;
  city: string | null;
  link_url?: string | null;
}

export interface ReplyRow {
  user_id: string;
  gmail_message_id: string;
  thread_id: string;
  from_email: string;
  from_name: string | null;
  at: number;
  is_bounce: number;
  snippet: string | null;
}

export function toMe(u: UserRow): Me {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    picture: u.picture,
    gmailStatus: u.gmail_status,
    watchExpiresAt: u.watch_expires_at,
    settings: settingsSchema.parse(JSON.parse(u.settings || "{}")),
  };
}

export function toMessage(r: MessageRow, now = Date.now()): MessageSummary {
  return {
    id: r.id,
    trackingId: r.tracking_id,
    gmailMessageId: r.gmail_message_id,
    threadId: r.thread_id,
    subject: r.subject,
    recipients: JSON.parse(r.recipients) as string[],
    isReply: r.is_reply === 1,
    sentAt: r.sent_at,
    bouncedAt: r.bounced_at,
    openCount: r.open_count,
    clickCount: r.click_count,
    firstOpenAt: r.first_open_at,
    lastOpenAt: r.last_open_at,
    tick: deriveTick(
      { tracked: r.tracking_id !== null, sentAt: r.sent_at, bouncedAt: r.bounced_at, openCount: r.open_count },
      now,
    ),
  };
}

export function toEvent(r: EventRow): OpenEvent {
  return {
    id: r.id,
    kind: r.kind,
    at: r.at,
    source: r.source,
    counted: r.counted === 1,
    reason: r.reason,
    country: r.country,
    city: r.city,
    linkUrl: r.link_url ?? null,
  };
}

export function toReply(r: ReplyRow): ReplySummary {
  return {
    gmailMessageId: r.gmail_message_id,
    threadId: r.thread_id,
    fromEmail: r.from_email,
    fromName: r.from_name,
    at: r.at,
    isBounce: r.is_bounce === 1,
    snippet: r.snippet,
  };
}

export function getUser(db: D1Database, id: string) {
  return db.prepare(`SELECT * FROM users WHERE id = ?`).bind(id).first<UserRow>();
}

export function getMessage(db: D1Database, userId: string, id: string) {
  return db
    .prepare(`SELECT * FROM messages WHERE id = ? AND user_id = ?`)
    .bind(id, userId)
    .first<MessageRow>();
}

export async function upsertThread(
  db: D1Database,
  userId: string,
  threadId: string,
  subject: string,
  at: number,
) {
  await db
    .prepare(
      `INSERT INTO threads (user_id, id, subject, last_activity_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (user_id, id) DO UPDATE SET
         last_activity_at = MAX(last_activity_at, ?4),
         subject = CASE WHEN threads.subject = '' THEN ?3 ELSE threads.subject END`,
    )
    .bind(userId, threadId, subject, at)
    .run();
}

/** Recomputes cached counters from the event log (used after late registration). */
export async function recomputeCounters(db: D1Database, messageId: string) {
  await db
    .prepare(
      `UPDATE messages SET
         open_count    = (SELECT COUNT(*) FROM open_events WHERE message_id = ?1 AND kind = 'open' AND counted = 1),
         click_count   = (SELECT COUNT(*) FROM open_events WHERE message_id = ?1 AND kind = 'click' AND counted = 1),
         first_open_at = (SELECT MIN(at) FROM open_events WHERE message_id = ?1 AND kind = 'open' AND counted = 1),
         last_open_at  = (SELECT MAX(at) FROM open_events WHERE message_id = ?1 AND kind = 'open' AND counted = 1)
       WHERE id = ?1`,
    )
    .bind(messageId)
    .run();
}

export async function threadStatuses(
  db: D1Database,
  userId: string,
  threadIds: string[],
): Promise<ThreadStatus[]> {
  if (threadIds.length === 0) return [];
  // One JSON parameter instead of N placeholders: D1 caps a query at 100 bound variables.
  const ids = JSON.stringify(threadIds);
  const [msgs, replies] = await db.batch([
    db
      .prepare(
        `SELECT * FROM messages WHERE user_id = ?1 AND thread_id IN (SELECT value FROM json_each(?2))
         ORDER BY COALESCE(sent_at, registered_at)`,
      )
      .bind(userId, ids),
    db
      .prepare(
        `SELECT thread_id, COUNT(*) AS n, MAX(at) AS last FROM replies
         WHERE user_id = ?1 AND thread_id IN (SELECT value FROM json_each(?2)) AND is_bounce = 0 GROUP BY thread_id`,
      )
      .bind(userId, ids),
  ]);

  const now = Date.now();
  const byThread = new Map<string, MessageSummary[]>();
  for (const row of (msgs!.results ?? []) as MessageRow[]) {
    const list = byThread.get(row.thread_id!) ?? [];
    list.push(toMessage(row, now));
    byThread.set(row.thread_id!, list);
  }
  const replyStats = new Map(
    ((replies!.results ?? []) as { thread_id: string; n: number; last: number }[]).map((r) => [r.thread_id, r]),
  );

  return [...byThread].map(([threadId, messages]) => {
    const tracked = messages.filter((m) => m.trackingId);
    const latest = tracked.at(-1) ?? messages.at(-1)!;
    const r = replyStats.get(threadId);
    const openTimes = tracked.flatMap((m) => (m.lastOpenAt ? [m.lastOpenAt] : []));
    return {
      threadId,
      tick: latest.tick,
      openCount: tracked.reduce((n, m) => n + m.openCount, 0),
      lastOpenAt: openTimes.length ? Math.max(...openTimes) : null,
      replyCount: r?.n ?? 0,
      lastReplyAt: r?.last ?? null,
      messages,
    };
  });
}
