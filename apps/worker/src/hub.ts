import { DurableObject } from "cloudflare:workers";
import type { DiscardReason, OpenSource, RealtimeEvent } from "@mail-tracker/shared";
import { recomputeCounters, toEvent, toMessage, type EventRow, type MessageRow } from "./db";
import type { AppEnv } from "./env";
import { classifyOpen, SELF_VIEW_AFTER_MS, SELF_VIEW_BEFORE_MS } from "./lib/classify";
import { syncHistory } from "./sync";

/** A pixel or click hit for a registered message. */
export interface PendingHit {
  trackingId: string;
  messageId: string;
  kind: "open" | "click";
  linkIdx: number | null;
  at: number;
  source: OpenSource;
  bot: boolean;
  userAgent: string;
  ipHash: string;
  country: string | null;
  city: string | null;
  asn: number | null;
}

/** Hits on several messages of one thread within this window are one render (quoted pixels). */
const QUOTED_WINDOW_MS = 5_000;
/** How long a counted open can still be taken back by a late view ping or a newer quoted hit. */
const REVOCABLE_MS = 60_000;
const VIEW_PING_TTL_MS = 10 * 60_000;

/**
 * One instance per user. Classifies hits the moment they arrive and pushes
 * them out immediately; evidence that shows up a moment later (the sender's
 * own view ping, a newer message's pixel in the same render) revokes the open
 * instead of delaying every open. Also serialises Gmail sync and fans
 * realtime events out to the user's extension and dashboard.
 */
export class UserHub extends DurableObject<AppEnv> {
  private sql: SqlStorage;
  private chain: Promise<unknown> = Promise.resolve();
  private syncing: Promise<void> | null = null;
  private syncAgain = false;

  constructor(ctx: DurableObjectState, env: AppEnv) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      DROP TABLE IF EXISTS pending_hits;
      CREATE TABLE IF NOT EXISTS view_pings (thread_id TEXT NOT NULL, at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS view_pings_thread ON view_pings(thread_id, at);
      CREATE TABLE IF NOT EXISTS recent_hits (
        event_id INTEGER PRIMARY KEY, message_id TEXT NOT NULL, thread_id TEXT, sent_order INTEGER NOT NULL,
        kind TEXT NOT NULL, at INTEGER NOT NULL, counted INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS recent_hits_thread ON recent_hits(thread_id, at);
      CREATE INDEX IF NOT EXISTS recent_hits_message ON recent_hits(message_id, at);
    `);
    // Answer keepalives without waking a hibernated object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade") !== "websocket") return new Response("Expected websocket", { status: 426 });
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  override webSocketMessage() {
    // Clients only send keepalives, handled by the auto response.
  }

  override webSocketClose(ws: WebSocket, code: number) {
    try {
      ws.close(code, "closing");
    } catch {
      // already closed
    }
  }

  broadcast(event: RealtimeEvent) {
    const data = JSON.stringify(event);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(data);
      } catch {
        // socket went away; the runtime cleans it up
      }
    }
  }

  /** Runs `fn` after every earlier hit/view finished, so counters never race. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  /** The sender's tab rendered this thread. Any open it caused is theirs, even one already counted. */
  recordView(threadId: string, at = Date.now()) {
    return this.serial(async () => {
      this.sql.exec(`INSERT INTO view_pings (thread_id, at) VALUES (?, ?)`, threadId, at);
      const caused = this.sql
        .exec<{ event_id: number; message_id: string }>(
          `SELECT event_id, message_id FROM recent_hits
           WHERE thread_id = ? AND kind = 'open' AND counted = 1 AND at BETWEEN ? AND ?`,
          threadId,
          at - SELF_VIEW_BEFORE_MS,
          at + SELF_VIEW_AFTER_MS,
        )
        .toArray();
      for (const hit of caused) await this.revoke(hit.event_id, hit.message_id, "self_view");
    });
  }

  ingestHit(hit: PendingHit) {
    return this.serial(() => this.processHit(hit));
  }

  private async processHit(hit: PendingHit) {
    const db = this.env.DB;
    const msg = await db.prepare(`SELECT * FROM messages WHERE id = ?`).bind(hit.messageId).first<MessageRow>();
    if (!msg) return;
    const sentOrder = msg.sent_at ?? msg.registered_at;

    const pings = msg.thread_id
      ? this.sql
          .exec<{ at: number }>(
            `SELECT at FROM view_pings WHERE thread_id = ? AND at BETWEEN ? AND ?`,
            msg.thread_id,
            hit.at - 60_000,
            hit.at + 60_000,
          )
          .toArray()
          .map((r) => r.at)
      : [];
    const lastLocal = this.sql
      .exec<{ t: number | null }>(
        `SELECT MAX(at) AS t FROM recent_hits WHERE message_id = ? AND kind = 'open' AND counted = 1`,
        msg.id,
      )
      .one().t;

    let verdict = classifyOpen(hit, {
      sentAt: sentOrder,
      viewPings: pings,
      lastCountedAt: hit.kind === "open" ? Math.max(lastLocal ?? 0, msg.last_open_at ?? 0) || null : null,
    });

    // Opening a reply renders the quoted earlier pixels too: credit only the newest message.
    if (verdict.counted && hit.kind === "open" && msg.thread_id) {
      const newer = this.sql
        .exec<{ n: number }>(
          `SELECT COUNT(*) AS n FROM recent_hits
           WHERE thread_id = ? AND kind = 'open' AND message_id != ? AND sent_order > ? AND ABS(at - ?) <= ?`,
          msg.thread_id,
          msg.id,
          sentOrder,
          hit.at,
          QUOTED_WINDOW_MS,
        )
        .one().n;
      if (newer) verdict = { ...verdict, counted: false, reason: "quoted" };
    }

    const insert = db
      .prepare(
        `INSERT INTO open_events (tracking_id, user_id, message_id, kind, link_idx, at, source, counted, reason,
           user_agent, ip_hash, country, city, asn)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      )
      .bind(
        hit.trackingId,
        msg.user_id,
        msg.id,
        hit.kind,
        hit.linkIdx,
        hit.at,
        verdict.source,
        verdict.counted ? 1 : 0,
        verdict.reason,
        hit.userAgent.slice(0, 512),
        hit.ipHash,
        hit.country,
        hit.city,
        hit.asn,
      );
    const update = !verdict.counted
      ? null
      : hit.kind === "open"
        ? db
            .prepare(
              `UPDATE messages SET open_count = open_count + 1, first_open_at = COALESCE(first_open_at, ?2),
                 last_open_at = MAX(COALESCE(last_open_at, 0), ?2) WHERE id = ?1 RETURNING *`,
            )
            .bind(msg.id, hit.at)
        : db.prepare(`UPDATE messages SET click_count = click_count + 1 WHERE id = ? RETURNING *`).bind(msg.id);

    const out = await db.batch(update ? [insert, update] : [insert]);
    const event = out[0]?.results[0] as EventRow | undefined;
    if (!event) return;

    this.sql.exec(
      `INSERT INTO recent_hits (event_id, message_id, thread_id, sent_order, kind, at, counted) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      event.id,
      msg.id,
      msg.thread_id,
      sentOrder,
      hit.kind,
      hit.at,
      verdict.counted ? 1 : 0,
    );

    const updated = out[1]?.results[0] as MessageRow | undefined;
    if (updated) this.broadcast({ type: "open", message: toMessage(updated), event: toEvent(event) });

    // This newer message's pixel proves older opens in the same render were quoted copies.
    if (verdict.counted && hit.kind === "open" && msg.thread_id) {
      const quoted = this.sql
        .exec<{ event_id: number; message_id: string }>(
          `SELECT event_id, message_id FROM recent_hits
           WHERE thread_id = ? AND kind = 'open' AND counted = 1 AND sent_order < ? AND ABS(at - ?) <= ?`,
          msg.thread_id,
          sentOrder,
          hit.at,
          QUOTED_WINDOW_MS,
        )
        .toArray();
      for (const q of quoted) await this.revoke(q.event_id, q.message_id, "quoted");
    }
    this.prune();
  }

  /** Un-counts an open that later evidence showed was not the recipient. */
  private async revoke(eventId: number, messageId: string, reason: DiscardReason) {
    const db = this.env.DB;
    const { meta } = await db
      .prepare(`UPDATE open_events SET counted = 0, reason = ? WHERE id = ? AND counted = 1`)
      .bind(reason, eventId)
      .run();
    this.sql.exec(`UPDATE recent_hits SET counted = 0 WHERE event_id = ?`, eventId);
    if (!meta.changes) return;
    await recomputeCounters(db, messageId);
    const row = await db.prepare(`SELECT * FROM messages WHERE id = ?`).bind(messageId).first<MessageRow>();
    if (row) this.broadcast({ type: "revoke", message: toMessage(row), eventId });
  }

  private prune() {
    const now = Date.now();
    this.sql.exec(`DELETE FROM recent_hits WHERE at < ?`, now - REVOCABLE_MS);
    this.sql.exec(`DELETE FROM view_pings WHERE at < ?`, now - VIEW_PING_TTL_MS);
  }

  /** Runs Gmail history sync; concurrent pushes coalesce into one follow-up run. */
  async syncGmail(userId: string): Promise<void> {
    if (this.syncing) {
      this.syncAgain = true;
      return this.syncing;
    }
    this.syncing = (async () => {
      try {
        do {
          this.syncAgain = false;
          await syncHistory(this.env, userId, (e) => this.broadcast(e));
        } while (this.syncAgain);
      } finally {
        this.syncing = null;
      }
    })();
    return this.syncing;
  }
}
