import { Hono } from "hono";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { hubFor, type HonoEnv } from "./env";

const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export const webhooks = new Hono<HonoEnv>();

/**
 * Gmail → Pub/Sub push. The subscription must use an authenticated push with
 * audience `<PUBLIC_URL>/webhooks/gmail`, so we can verify Google signed it.
 */
webhooks.post("/gmail", async (c) => {
  const env = c.env;
  const token = c.req.header("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) return c.json({ error: "missing token" }, 401);

  try {
    const { payload } = await jwtVerify(token, GOOGLE_JWKS, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: `${env.PUBLIC_URL.replace(/\/$/, "")}/webhooks/gmail`,
    });
    if (env.PUBSUB_SERVICE_ACCOUNT && payload.email !== env.PUBSUB_SERVICE_ACCOUNT) throw new Error("wrong account");
    if (payload.email_verified !== true) throw new Error("unverified account");
  } catch {
    return c.json({ error: "invalid token" }, 401);
  }

  const body = await c.req.json<{ message?: { data?: string } }>().catch(() => null);
  let notification: { emailAddress?: string; historyId?: number | string } = {};
  try {
    notification = JSON.parse(atob(body?.message?.data ?? ""));
  } catch {
    // Malformed: ack so Pub/Sub doesn't redeliver it forever.
    return c.body(null, 204);
  }

  const email = notification.emailAddress?.toLowerCase();
  if (!email) return c.body(null, 204);
  const user = await env.DB.prepare(`SELECT id FROM users WHERE email = ?`).bind(email).first<{ id: string }>();
  if (!user) return c.body(null, 204);

  // Awaited so a failure returns 5xx and Pub/Sub retries with backoff. Sync is idempotent.
  await hubFor(env, user.id).syncGmail(user.id);
  return c.body(null, 204);
});
