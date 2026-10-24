import type { UserRow } from "./db";
import { hubFor, type AppEnv } from "./env";
import { ReauthRequiredError } from "./lib/google";
import { ensureWatch, resyncRecentThreads } from "./sync";

const WATCH_RENEW_BEFORE_MS = 48 * 3600_000;
const ORPHAN_TTL_MS = 3 * 86400_000;

export async function runCron(env: AppEnv): Promise<void> {
  const { results: users } = await env.DB.prepare(
    `SELECT * FROM users WHERE gmail_status != 'reauth_required'`,
  ).all<UserRow>();

  for (const user of users) {
    try {
      // Gmail watches expire after 7 days; Google recommends renewing daily.
      if (!user.watch_expires_at || user.watch_expires_at - Date.now() < WATCH_RENEW_BEFORE_MS) {
        await ensureWatch(env, user.id);
      }
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
