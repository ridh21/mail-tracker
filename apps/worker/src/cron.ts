import type { UserRow } from "./db";
import { hubFor, type AppEnv } from "./env";
import { ReauthRequiredError } from "./lib/google";
import { ensureWatch, resyncRecentThreads } from "./sync";

const WATCH_RENEW_BEFORE_MS = 48 * 3600_000;
const ORPHAN_TTL_MS = 3 * 86400_000;

/**
 * `auto` (default) polls Gmail hourly only while no healthy Pub/Sub watch
 * exists, `always` keeps the old behaviour, `never` renews the watch but never
 * polls. Push is the fast path; the poll is a safety net.
 */
export type CronSyncMode = "auto" | "always" | "never";

export function cronSyncMode(raw: string | undefined): CronSyncMode {
  const value = (raw ?? "").trim().toLowerCase();
  return value === "always" || value === "never" ? value : "auto";
}

/**
 * A push subscription delivers every mailbox change within seconds, so an
 * hourly poll on top of it only burns Gmail quota. Skip the poll whenever the
 * watch is registered and not close to expiry — a missed push self-heals,
 * because the next one replays history from the stored `historyId`.
 */
export function shouldPollGmail(
  mode: CronSyncMode,
  hasTopic: boolean,
  watchExpiresAt: number | null,
  now: number,
): boolean {
  if (mode === "always") return true;
  if (mode === "never") return false;
  const watching = hasTopic && watchExpiresAt !== null && watchExpiresAt - now > WATCH_RENEW_BEFORE_MS;
  return !watching;
}

export async function runCron(env: AppEnv): Promise<void> {
  const { results: users } = await env.DB.prepare(
    `SELECT * FROM users WHERE gmail_status != 'reauth_required'`,
  ).all<UserRow>();
  const mode = cronSyncMode(env.CRON_SYNC);

  for (const user of users) {
    try {
      // Gmail watches expire after 7 days; Google recommends renewing daily.
      let watchExpiresAt = user.watch_expires_at;
      if (!watchExpiresAt || watchExpiresAt - Date.now() < WATCH_RENEW_BEFORE_MS) {
        watchExpiresAt = await ensureWatch(env, user.id);
      }
      // Pub/Sub is already syncing this mailbox, so a poll would duplicate it.
      if (!shouldPollGmail(mode, Boolean(env.GMAIL_PUBSUB_TOPIC), watchExpiresAt, Date.now())) continue;

      const hub = hubFor(env, user.id);
      await hub.syncGmail(user.id);
      await resyncRecentThreads(env, user, (e) => hub.broadcast(e), 25);
    } catch (err) {
      if (!(err instanceof ReauthRequiredError)) console.error(`cron failed for ${user.id}`, err);
    }
  }

  // Hits on tracking ids that were never registered (e.g. a draft preview).
  await env.DB.prepare(`DELETE FROM open_events WHERE message_id IS NULL AND at < ?`)
    .bind(Date.now() - ORPHAN_TTL_MS)
    .run();
  await env.DB.prepare(`DELETE FROM sessions WHERE expires_at < ?`).bind(Date.now()).run();
}
