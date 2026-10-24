import {
  linkSentInput,
  registerMessageInput,
  settingsPatch,
  settingsSchema,
  statusQueryInput,
  trackingId as trackingIdSchema,
  viewPingInput,
  type TimelineItem,
} from "@mail-tracker/shared";
import { Hono } from "hono";
import type { z } from "zod";
import { requireAuth } from "./auth";
import {
  getMessage,
  getUser,
  threadStatuses,
  toEvent,
  toMe,
  toMessage,
  toReply,
  upsertThread,
  type EventRow,
  type MessageRow,
  type ReplyRow,
} from "./db";
import { hubFor, type HonoEnv } from "./env";
import { signPayload, verifyPayload } from "./lib/crypto";
import { adoptOrphanEvents, ensureWatch } from "./sync";

export const api = new Hono<HonoEnv>();

async function parse<T extends z.ZodType>(schema: T, req: Request): Promise<z.infer<T> | null> {
  const body = await req.json().catch(() => undefined);
  const result = schema.safeParse(body);
  return result.success ? result.data : null;
}

// Realtime socket: auth via short-lived ticket since browsers can't set headers on WebSockets.
api.get("/realtime", async (c) => {
  const ticket = await verifyPayload<{ uid: string }>(c.env.SESSION_SECRET, c.req.query("ticket"));
  if (!ticket) return c.json({ error: "invalid ticket" }, 401);
  return hubFor(c.env, ticket.uid).fetch(c.req.raw);
});

api.use("*", requireAuth);

api.post("/realtime/ticket", async (c) => {
  const ticket = await signPayload(c.env.SESSION_SECRET, { uid: c.get("user").id }, 60_000);
  return c.json({ ticket });
});

api.get("/me", async (c) => {
  const user = await getUser(c.env.DB, c.get("user").id);
  if (!user) return c.json({ error: "not found" }, 404);
  return c.json(toMe(user));
});

api.patch("/settings", async (c) => {
  const patch = await parse(settingsPatch, c.req.raw);
  if (!patch) return c.json({ error: "invalid settings" }, 400);
  const user = await getUser(c.env.DB, c.get("user").id);
  if (!user) return c.json({ error: "not found" }, 404);
  const next = settingsSchema.parse({ ...JSON.parse(user.settings || "{}"), ...patch });
  await c.env.DB.prepare(`UPDATE users SET settings = ? WHERE id = ?`).bind(JSON.stringify(next), user.id).run();
  return c.json(next);
});

// --- Extension: message lifecycle -----------------------------------------

/** Called at send time. Idempotent: the extension retries from its outbox. */
api.post("/messages", async (c) => {
  const input = await parse(registerMessageInput, c.req.raw);
  if (!input) return c.json({ error: "invalid message" }, 400);
  const userId = c.get("user").id;
  const now = Date.now();

  const row = await c.env.DB.prepare(
    `INSERT INTO messages (id, user_id, tracking_id, thread_id, subject, recipients, is_reply, registered_at)
     VALUES (?1, ?2, ?1, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT (id) DO UPDATE SET
       thread_id = COALESCE(messages.thread_id, excluded.thread_id),
       subject = excluded.subject, recipients = excluded.recipients, is_reply = excluded.is_reply
     WHERE messages.user_id = ?2
     RETURNING *`,
  )
    .bind(
      input.trackingId,
      userId,
      input.threadId ?? null,
      input.subject,
      JSON.stringify([...input.to, ...input.cc, ...input.bcc]),
      input.isReply ? 1 : 0,
      input.composedAt ? Math.min(input.composedAt, now) : now,
    )
    .first<MessageRow>();
  if (!row) return c.json({ error: "tracking id belongs to another account" }, 409);

  if (input.links.length) {
    await c.env.DB.batch(
      input.links.map((l) =>
        c.env.DB.prepare(`INSERT OR IGNORE INTO links (message_id, idx, url) VALUES (?, ?, ?)`).bind(row.id, l.idx, l.url),
      ),
    );
  }
  const message = toMessage(await adoptOrphanEvents(c.env, userId, row));
  c.executionCtx.waitUntil(hubFor(c.env, userId).broadcast({ type: "message", message }));
  return c.json(message);
});

/** Called when Gmail reports the message as sent, with its Gmail ids. */
api.post("/messages/:trackingId/sent", async (c) => {
  const tid = trackingIdSchema.safeParse(c.req.param("trackingId"));
  const input = await parse(linkSentInput, c.req.raw);
  if (!tid.success || !input) return c.json({ error: "invalid input" }, 400);
  const userId = c.get("user").id;
  const sentAt = Math.min(input.sentAt ?? Date.now(), Date.now());

  const row = await c.env.DB.prepare(
    `UPDATE messages SET gmail_message_id = ?3, thread_id = ?4, sent_at = COALESCE(sent_at, ?5)
     WHERE tracking_id = ?1 AND user_id = ?2 RETURNING *`,
  )
    .bind(tid.data, userId, input.gmailMessageId, input.threadId, sentAt)
    .first<MessageRow>();
  if (!row) return c.json({ error: "unknown tracking id" }, 404);

  await upsertThread(c.env.DB, userId, input.threadId, row.subject, sentAt);
  const message = toMessage(row);
  c.executionCtx.waitUntil(hubFor(c.env, userId).broadcast({ type: "message", message }));
  return c.json(message);
});

/** The sender's Gmail tab rendered a thread: opens around now are their own. */
api.post("/views", async (c) => {
  const input = await parse(viewPingInput, c.req.raw);
  if (!input) return c.json({ error: "invalid input" }, 400);
  await hubFor(c.env, c.get("user").id).recordView(input.threadId);
  return c.body(null, 204);
});

api.post("/status", async (c) => {
  const input = await parse(statusQueryInput, c.req.raw);
  if (!input) return c.json({ error: "invalid input" }, 400);
  return c.json(await threadStatuses(c.env.DB, c.get("user").id, input.threadIds));
});

/** Counted opens/clicks after `since`, so the extension can notify about anything it missed offline. */
api.get("/events", async (c) => {
  const userId = c.get("user").id;
  const since = Math.max(Number(c.req.query("since")) || 0, Date.now() - 7 * 86400_000);
  const { results } = await c.env.DB.prepare(
    `SELECT e.*, l.url AS link_url FROM open_events e
     LEFT JOIN links l ON l.message_id = e.message_id AND l.idx = e.link_idx
     WHERE e.user_id = ? AND e.counted = 1 AND e.at > ? ORDER BY e.at LIMIT 50`,
  )
    .bind(userId, since)
    .all<EventRow>();
  if (!results.length) return c.json([]);

  const ids = [...new Set(results.map((e) => e.message_id!))];
  const { results: msgs } = await c.env.DB.prepare(
    `SELECT * FROM messages WHERE user_id = ?1 AND id IN (SELECT value FROM json_each(?2))`,
  )
    .bind(userId, JSON.stringify(ids))
    .all<MessageRow>();
  const byId = new Map(msgs.map((m) => [m.id, toMessage(m)]));
  return c.json(
    results.flatMap((e) => {
      const message = byId.get(e.message_id!);
      return message ? [{ event: toEvent(e), message }] : [];
    }),
  );
});

// --- Dashboard ------------------------------------------------------------

api.get("/messages", async (c) => {
  const userId = c.get("user").id;
  const limit = Math.min(Number(c.req.query("limit")) || 50, 100);
  const before = Number(c.req.query("before")) || Number.MAX_SAFE_INTEGER;
  const q = c.req.query("q")?.trim().toLowerCase();
  const filter = c.req.query("filter");

  const where = [`user_id = ?1`, `COALESCE(sent_at, registered_at) < ?2`];
  const binds: (string | number)[] = [userId, before];
  if (q) {
    binds.push(`%${q.replace(/[%_\\]/g, "\\$&")}%`);
    where.push(`(LOWER(subject) LIKE ?${binds.length} ESCAPE '\\' OR LOWER(recipients) LIKE ?${binds.length} ESCAPE '\\')`);
  }
  if (filter === "opened") where.push(`open_count > 0`);
  if (filter === "unopened") where.push(`tracking_id IS NOT NULL AND open_count = 0 AND bounced_at IS NULL`);
  if (filter === "bounced") where.push(`bounced_at IS NOT NULL`);
  if (filter === "tracked") where.push(`tracking_id IS NOT NULL`);

  binds.push(limit + 1);
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM messages WHERE ${where.join(" AND ")}
     ORDER BY COALESCE(sent_at, registered_at) DESC LIMIT ?${binds.length}`,
  )
    .bind(...binds)
    .all<MessageRow>();

  const page = results.slice(0, limit);
  const threadIds = [...new Set(page.flatMap((m) => (m.thread_id ? [m.thread_id] : [])))];
  const replyCounts = new Map<string, number>();
  if (threadIds.length) {
    const { results: rc } = await c.env.DB.prepare(
      `SELECT thread_id, COUNT(*) AS n FROM replies WHERE user_id = ?1 AND is_bounce = 0
       AND thread_id IN (SELECT value FROM json_each(?2)) GROUP BY thread_id`,
    )
      .bind(userId, JSON.stringify(threadIds))
      .all<{ thread_id: string; n: number }>();
    for (const r of rc) replyCounts.set(r.thread_id, r.n);
  }

  const last = page.at(-1);
  return c.json({
    items: page.map((m) => ({ ...toMessage(m), replyCount: m.thread_id ? (replyCounts.get(m.thread_id) ?? 0) : 0 })),
    nextBefore: results.length > limit && last ? (last.sent_at ?? last.registered_at) : null,
  });
});

api.get("/messages/:id", async (c) => {
  const userId = c.get("user").id;
  const row = await getMessage(c.env.DB, userId, c.req.param("id"));
  if (!row) return c.json({ error: "not found" }, 404);

  const [events, siblings, replies] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT e.*, l.url AS link_url FROM open_events e
       LEFT JOIN links l ON l.message_id = e.message_id AND l.idx = e.link_idx
       WHERE e.message_id = ? ORDER BY e.at DESC LIMIT 500`,
    ).bind(row.id),
    c.env.DB.prepare(
      `SELECT * FROM messages WHERE user_id = ? AND thread_id = ? ORDER BY COALESCE(sent_at, registered_at)`,
    ).bind(userId, row.thread_id ?? ""),
    c.env.DB.prepare(`SELECT * FROM replies WHERE user_id = ? AND thread_id = ? ORDER BY at`).bind(userId, row.thread_id ?? ""),
  ]);

  const threadMessages = row.thread_id ? ((siblings!.results ?? []) as MessageRow[]).map((m) => toMessage(m)) : [toMessage(row)];
  const timeline: TimelineItem[] = [
    ...threadMessages.map((m): TimelineItem => ({ type: "sent", at: m.sentAt ?? 0, message: m })),
    ...((replies!.results ?? []) as ReplyRow[]).map((r): TimelineItem => ({ type: "reply", at: r.at, reply: toReply(r) })),
  ].sort((a, b) => a.at - b.at);

  return c.json({
    message: toMessage(row),
    events: ((events!.results ?? []) as EventRow[]).map(toEvent),
    timeline,
  });
});

api.get("/stats", async (c) => {
  const userId = c.get("user").id;
  const days = Math.min(Math.max(Number(c.req.query("days")) || 30, 1), 365);
  const since = Date.now() - days * 86400_000;
  const tz = Math.max(-840, Math.min(840, Number(c.req.query("tzOffset")) || 0)); // minutes, as Date#getTimezoneOffset

  const [totals, daily, heat, sources] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT
         COUNT(*) AS sent,
         SUM(CASE WHEN m.open_count > 0 THEN 1 ELSE 0 END) AS opened,
         SUM(CASE WHEN m.bounced_at IS NOT NULL THEN 1 ELSE 0 END) AS bounced,
         SUM(CASE WHEN EXISTS (SELECT 1 FROM replies r WHERE r.user_id = m.user_id AND r.thread_id = m.thread_id
               AND r.is_bounce = 0 AND r.at > m.sent_at) THEN 1 ELSE 0 END) AS replied,
         AVG(CASE WHEN m.first_open_at IS NOT NULL THEN m.first_open_at - m.sent_at END) AS avg_time_to_open
       FROM messages m WHERE m.user_id = ? AND m.tracking_id IS NOT NULL AND m.sent_at >= ?`,
    ).bind(userId, since),
    c.env.DB.prepare(
      `SELECT CAST((at - ?3 * 60000) / 86400000 AS INTEGER) AS day, COUNT(*) AS opens
       FROM open_events WHERE user_id = ?1 AND kind = 'open' AND counted = 1 AND at >= ?2 GROUP BY day ORDER BY day`,
    ).bind(userId, since, tz),
    c.env.DB.prepare(
      `SELECT CAST(strftime('%w', (at - ?3 * 60000) / 1000, 'unixepoch') AS INTEGER) AS dow,
              CAST(strftime('%H', (at - ?3 * 60000) / 1000, 'unixepoch') AS INTEGER) AS hour, COUNT(*) AS opens
       FROM open_events WHERE user_id = ?1 AND kind = 'open' AND counted = 1 AND at >= ?2 GROUP BY dow, hour`,
    ).bind(userId, since, tz),
    c.env.DB.prepare(
      `SELECT source, counted, COUNT(*) AS n FROM open_events WHERE user_id = ? AND at >= ? GROUP BY source, counted`,
    ).bind(userId, since),
  ]);

  const t = (totals!.results[0] ?? {}) as Record<string, number | null>;
  return c.json({
    days,
    sent: t.sent ?? 0,
    opened: t.opened ?? 0,
    replied: t.replied ?? 0,
    bounced: t.bounced ?? 0,
    avgTimeToOpenMs: t.avg_time_to_open ?? null,
    daily: (daily!.results as { day: number; opens: number }[]).map((d) => ({ date: d.day * 86400_000, opens: d.opens })),
    heatmap: heat!.results as { dow: number; hour: number; opens: number }[],
    sources: sources!.results as { source: string; counted: number; n: number }[],
  });
});

api.get("/sessions", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT id, kind, label, created_at, last_used_at FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_used_at DESC`,
  )
    .bind(c.get("user").id, Date.now())
    .all();
  return c.json(results.map((s) => ({ ...s, current: s.id === c.get("user").sessionId })));
});

api.delete("/sessions/:id", async (c) => {
  await c.env.DB.prepare(`DELETE FROM sessions WHERE id = ? AND user_id = ?`).bind(c.req.param("id"), c.get("user").id).run();
  return c.body(null, 204);
});

api.post("/gmail/resync", async (c) => {
  const userId = c.get("user").id;
  try {
    await ensureWatch(c.env, userId);
    await hubFor(c.env, userId).syncGmail(userId);
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : "sync failed" }, 502);
  }
  const user = await getUser(c.env.DB, userId);
  return c.json(user ? toMe(user) : null);
});
