import type { RealtimeEvent } from "@mail-tracker/shared";
import { getUser, recomputeCounters, toMessage, toReply, upsertThread, type MessageRow, type ReplyRow, type UserRow } from "./db";
import type { AppEnv } from "./env";
import {
  Gmail,
  GmailApiError,
  ReauthRequiredError,
  header,
  htmlBody,
  parseAddress,
  parseAddressList,
} from "./lib/google";
import { JUST_SENT_MS } from "./lib/classify";

type Emit = (event: RealtimeEvent) => void;

interface AddedMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
}

const RESYNC_WINDOW_MS = 14 * 24 * 3600_000;
const INBOUND_HEADERS = ["From", "Subject", "X-Failed-Recipients", "Content-Type", "Auto-Submitted"];

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Matches this deployment's pixel URLs only, so other trackers' pixels are ignored. */
export function pixelIdsIn(env: AppEnv, html: string): string[] {
  const host = escapeRegExp(new URL(env.PUBLIC_URL).host);
  const re = new RegExp(`${host}/o/([A-Za-z0-9_-]{22})\\.gif`, "g");
  return [...new Set([...html.matchAll(re)].map((m) => m[1]!))];
}

export async function ensureWatch(env: AppEnv, userId: string): Promise<void> {
  if (!env.GMAIL_PUBSUB_TOPIC) return;
  try {
    const res = await new Gmail(env, userId).watch(env.GMAIL_PUBSUB_TOPIC);
    await env.DB.prepare(
      `UPDATE users SET watch_expires_at = ?2, history_id = COALESCE(history_id, ?3), gmail_status = 'ok' WHERE id = ?1`,
    )
      .bind(userId, Number(res.expiration), res.historyId)
      .run();
  } catch (err) {
    if (!(err instanceof ReauthRequiredError)) {
      await env.DB.prepare(`UPDATE users SET gmail_status = 'watch_failed' WHERE id = ?`).bind(userId).run();
    }
    throw err;
  }
}

/** Applies every mailbox change since the stored historyId. Idempotent. */
export async function syncHistory(env: AppEnv, userId: string, emit: Emit): Promise<void> {
  const user = await getUser(env.DB, userId);
  if (!user) return;
  const gmail = new Gmail(env, userId);

  if (!user.history_id) {
    const profile = await gmail.getProfile();
    await env.DB.prepare(`UPDATE users SET history_id = ? WHERE id = ?`).bind(profile.historyId, userId).run();
    return;
  }

  const added: AddedMessage[] = [];
  let latestHistoryId = user.history_id;
  try {
    let pageToken: string | undefined;
    do {
      const page = await gmail.listHistory(user.history_id, pageToken);
      for (const h of page.history ?? []) {
        for (const { message } of h.messagesAdded ?? []) added.push(message);
      }
      latestHistoryId = page.historyId;
      pageToken = page.nextPageToken;
    } while (pageToken);
  } catch (err) {
    // historyId older than ~a week: Gmail no longer has it.
    if (err instanceof GmailApiError && err.status === 404) return fullResync(env, user, emit);
    throw err;
  }

  const seen = new Set<string>();
  for (const msg of added) {
    if (seen.has(msg.id)) continue;
    seen.add(msg.id);
    await processMessage(env, gmail, user, msg, emit);
  }

  await env.DB.prepare(`UPDATE users SET history_id = ? WHERE id = ?`).bind(latestHistoryId, userId).run();
}

export async function fullResync(env: AppEnv, user: UserRow, emit: Emit): Promise<void> {
  const gmail = new Gmail(env, user.id);
  const profile = await gmail.getProfile();
  await env.DB.prepare(`UPDATE users SET history_id = ? WHERE id = ?`).bind(profile.historyId, user.id).run();
  await resyncRecentThreads(env, user, emit, 50);
}

/** Walks recently active tracked threads directly — catches anything a missed push skipped. */
export async function resyncRecentThreads(env: AppEnv, user: UserRow, emit: Emit, limit: number) {
  const gmail = new Gmail(env, user.id);
  const { results } = await env.DB.prepare(
    `SELECT id FROM threads WHERE user_id = ? AND last_activity_at > ? ORDER BY last_activity_at DESC LIMIT ?`,
  )
    .bind(user.id, Date.now() - RESYNC_WINDOW_MS, limit)
    .all<{ id: string }>();

  for (const { id } of results) {
    try {
      const thread = await gmail.getThread(id, INBOUND_HEADERS);
      for (const m of thread.messages ?? []) await processMessage(env, gmail, user, m, emit);
    } catch (err) {
      if (err instanceof GmailApiError && err.status === 404) continue; // thread deleted
      throw err;
    }
  }
}

async function processMessage(env: AppEnv, gmail: Gmail, user: UserRow, msg: AddedMessage, emit: Emit) {
  const labels = msg.labelIds ?? [];
  if (labels.includes("DRAFT")) return;
  if (labels.includes("SENT")) return processSent(env, gmail, user, msg, emit);
  return processInbound(env, gmail, user, msg, emit);
}

async function processSent(env: AppEnv, gmail: Gmail, user: UserRow, msg: AddedMessage, emit: Emit) {
  const existing = await env.DB.prepare(`SELECT * FROM messages WHERE user_id = ? AND gmail_message_id = ?`)
    .bind(user.id, msg.id)
    .first<MessageRow>();
  if (existing) {
    if (!existing.gmail_confirmed) {
      const row = await env.DB.prepare(`UPDATE messages SET gmail_confirmed = 1 WHERE id = ? RETURNING *`)
        .bind(existing.id)
        .first<MessageRow>();
      if (row) emit({ type: "message", message: toMessage(row) });
    }
    return;
  }

  const full = await gmail.getMessage(msg.id, "full");
  const sentAt = Number(full.internalDate);
  const subject = header(full, "Subject") ?? "";
  const recipients = [
    ...parseAddressList(header(full, "To")),
    ...parseAddressList(header(full, "Cc")),
    ...parseAddressList(header(full, "Bcc")),
  ];
  const isReply = Boolean(header(full, "In-Reply-To"));
  const ids = pixelIdsIn(env, htmlBody(full.payload));

  let row: MessageRow | null = null;
  if (ids.length) {
    // A reply may still quote older pixels; the new one is the registered-but-unlinked row.
    const idsJson = JSON.stringify(ids);
    const candidate = await env.DB.prepare(
      `SELECT * FROM messages WHERE user_id = ?1 AND tracking_id IN (SELECT value FROM json_each(?2))
       AND gmail_message_id IS NULL ORDER BY registered_at DESC LIMIT 1`,
    )
      .bind(user.id, idsJson)
      .first<MessageRow>();

    if (candidate) {
      row = await env.DB.prepare(
        `UPDATE messages SET gmail_message_id = ?2, thread_id = ?3, sent_at = COALESCE(sent_at, ?4), gmail_confirmed = 1
         WHERE id = ?1 RETURNING *`,
      )
        .bind(candidate.id, msg.id, msg.threadId, sentAt)
        .first<MessageRow>();
    } else {
      // Registration never reached us (extension closed mid-send). Pixels that are
      // already known belong to older messages, so only an unknown id is this one.
      const known = await env.DB.prepare(
        `SELECT tracking_id FROM messages WHERE tracking_id IN (SELECT value FROM json_each(?))`,
      )
        .bind(idsJson)
        .all<{ tracking_id: string }>();
      const knownSet = new Set(known.results.map((r) => r.tracking_id));
      const fresh = ids.find((id) => !knownSet.has(id));
      if (fresh) {
        row = await env.DB.prepare(
          `INSERT INTO messages (id, user_id, tracking_id, gmail_message_id, thread_id, subject, recipients, is_reply,
             registered_at, sent_at, gmail_confirmed)
           VALUES (?1, ?2, ?1, ?3, ?4, ?5, ?6, ?7, ?8, ?8, 1)
           ON CONFLICT DO NOTHING RETURNING *`,
        )
          .bind(fresh, user.id, msg.id, msg.threadId, subject, JSON.stringify(recipients), isReply ? 1 : 0, sentAt)
          .first<MessageRow>();
        if (row) row = await adoptOrphanEvents(env, user.id, row);
      }
    }
  }

  if (!row) {
    row = await env.DB.prepare(
      `INSERT INTO messages (id, user_id, gmail_message_id, thread_id, subject, recipients, is_reply,
         registered_at, sent_at, gmail_confirmed)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, 1)
       ON CONFLICT DO NOTHING RETURNING *`,
    )
      .bind(`g_${msg.id}`, user.id, msg.id, msg.threadId, subject, JSON.stringify(recipients), isReply ? 1 : 0, sentAt)
      .first<MessageRow>();
  }

  await upsertThread(env.DB, user.id, msg.threadId, subject, sentAt);
  if (row) emit({ type: "message", message: toMessage(row) });
}

async function processInbound(env: AppEnv, gmail: Gmail, user: UserRow, msg: AddedMessage, emit: Emit) {
  const [tracked, already] = await env.DB.batch([
    env.DB.prepare(`SELECT 1 FROM threads WHERE user_id = ? AND id = ?`).bind(user.id, msg.threadId),
    env.DB.prepare(`SELECT 1 FROM replies WHERE user_id = ? AND gmail_message_id = ?`).bind(user.id, msg.id),
  ]);
  if (!tracked!.results.length || already!.results.length) return;

  const meta = await gmail.getMessage(msg.id, "metadata", INBOUND_HEADERS);
  const from = parseAddress(header(meta, "From"));
  if (!from.email || from.email === user.email) return;

  const at = Number(meta.internalDate);
  const isBounce =
    /^(mailer-daemon|postmaster)@/i.test(from.email) ||
    Boolean(header(meta, "X-Failed-Recipients")) ||
    /report-type="?delivery-status/i.test(header(meta, "Content-Type") ?? "");

  const reply = await env.DB.prepare(
    `INSERT INTO replies (user_id, gmail_message_id, thread_id, from_email, from_name, at, is_bounce, snippet)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING *`,
  )
    .bind(user.id, msg.id, msg.threadId, from.email, from.name, at, isBounce ? 1 : 0, meta.snippet?.slice(0, 280) ?? null)
    .first<ReplyRow>();
  if (!reply) return;

  await upsertThread(env.DB, user.id, msg.threadId, header(meta, "Subject") ?? "", at);

  if (isBounce) {
    const bounced = await env.DB.prepare(
      `UPDATE messages SET bounced_at = ?3 WHERE id = (
         SELECT id FROM messages WHERE user_id = ?1 AND thread_id = ?2 AND sent_at <= ?3 AND bounced_at IS NULL
         ORDER BY sent_at DESC LIMIT 1
       ) RETURNING *`,
    )
      .bind(user.id, msg.threadId, at)
      .first<MessageRow>();
    if (bounced) emit({ type: "message", message: toMessage(bounced) });
  }
  emit({ type: "reply", reply: toReply(reply) });
}

/** Links pixel hits that arrived before the message was registered. */
export async function adoptOrphanEvents(env: AppEnv, userId: string, row: MessageRow): Promise<MessageRow> {
  if (!row.tracking_id) return row;
  const { meta } = await env.DB.prepare(
    `UPDATE open_events SET user_id = ?1, message_id = ?2 WHERE tracking_id = ?3 AND message_id IS NULL`,
  )
    .bind(userId, row.id, row.tracking_id)
    .run();
  if (!meta.changes) return row;
  // Orphans were classified without knowing the send time; drop the sender's own
  // render of the just-sent message now that we do.
  await env.DB.prepare(
    `UPDATE open_events SET counted = 0, reason = 'just_sent'
     WHERE message_id = ?1 AND kind = 'open' AND counted = 1 AND at < ?2`,
  )
    .bind(row.id, (row.sent_at ?? row.registered_at) + JUST_SENT_MS)
    .run();
  await recomputeCounters(env.DB, row.id);
  return (await env.DB.prepare(`SELECT * FROM messages WHERE id = ?`).bind(row.id).first<MessageRow>()) ?? row;
}
