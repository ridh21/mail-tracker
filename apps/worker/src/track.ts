import { TRACKING_ID_RE } from "@mail-tracker/shared";
import { Hono, type Context } from "hono";
import { hubFor, type HonoEnv } from "./env";
import { classifySource } from "./lib/classify";
import { fromBase64url, linkSignature, sha256, timingSafeEqual } from "./lib/crypto";
import type { PendingHit } from "./hub";

// 1×1 transparent GIF.
const PIXEL = Uint8Array.from(
  atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"),
  (ch) => ch.charCodeAt(0),
);

const NO_CACHE = {
  "cache-control": "no-store, no-cache, must-revalidate, max-age=0, private",
  pragma: "no-cache",
  expires: "0",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex",
};

function pixelResponse() {
  return new Response(PIXEL, { headers: { ...NO_CACHE, "content-type": "image/gif", "content-length": String(PIXEL.length) } });
}

interface HitInput {
  trackingId: string;
  kind: "open" | "click";
  linkIdx: number | null;
}

/** Records a hit off the response path. Never throws: tracking must not break the email. */
async function recordHit(c: Context<HonoEnv>, input: HitInput, at: number) {
  const env = c.env;
  const { success } = await env.TRACK_LIMITER.limit({ key: input.trackingId });
  if (!success) return;

  const ip = c.req.header("cf-connecting-ip") ?? "";
  const cf = c.req.raw.cf as IncomingRequestCfProperties | undefined;
  const userAgent = c.req.header("user-agent") ?? "";
  const asn = typeof cf?.asn === "number" ? cf.asn : null;
  const { source, bot } = classifySource({ at, userAgent, asn, ip });

  const hit: Omit<PendingHit, "messageId"> = {
    ...input,
    at,
    source,
    bot,
    userAgent,
    // Salted with the day so IPs can't be correlated long term.
    ipHash: (await sha256(`${new Date(at).toISOString().slice(0, 10)}:${ip}`)).slice(0, 16),
    // Gmail's proxy hides the reader; its location would be Google's datacenter.
    country: source === "gmail" ? null : ((cf?.country as string | undefined) ?? null),
    city: source === "gmail" ? null : ((cf?.city as string | undefined) ?? null),
    asn,
  };

  const msg = await env.DB.prepare(`SELECT id, user_id FROM messages WHERE tracking_id = ?`)
    .bind(input.trackingId)
    .first<{ id: string; user_id: string }>();

  if (msg) {
    await hubFor(env, msg.user_id).ingestHit({ ...hit, messageId: msg.id });
    return;
  }

  // Not registered yet: keep the raw hit, it's adopted when registration lands.
  await env.DB.prepare(
    `INSERT INTO open_events (tracking_id, kind, link_idx, at, source, counted, reason, user_agent, ip_hash, country, city, asn)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      hit.trackingId,
      hit.kind,
      hit.linkIdx,
      at,
      source,
      bot ? 0 : 1,
      bot ? (source === "apple_mpp" ? "prefetch" : "bot") : null,
      userAgent.slice(0, 512),
      hit.ipHash,
      hit.country,
      hit.city,
      asn,
    )
    .run();
}

function background(c: Context<HonoEnv>, task: Promise<unknown>) {
  c.executionCtx.waitUntil(task.catch((err) => console.error("tracking hit failed", err)));
}

export const trackRoutes = new Hono<HonoEnv>();

trackRoutes.get("/o/:file", (c) => {
  const trackingId = c.req.param("file").replace(/\.gif$/, "");
  // Always answer with the image; a broken image icon would give the tracker away.
  if (TRACKING_ID_RE.test(trackingId)) {
    background(c, recordHit(c, { trackingId, kind: "open", linkIdx: null }, Date.now()));
  }
  return pixelResponse();
});

/** Click URL: /c/<userId>/<trackingId>/<sig>/<linkIdx>?u=<base64url target> */
trackRoutes.get("/c/:uid/:tid/:sig/:idx", async (c) => {
  const { uid, tid, sig, idx } = c.req.param();
  const linkIdx = Number(idx);
  if (!TRACKING_ID_RE.test(tid) || !Number.isInteger(linkIdx) || linkIdx < 0) return c.text("Not found", 404);

  const user = await c.env.DB.prepare(`SELECT link_key FROM users WHERE id = ?`).bind(uid).first<{ link_key: string }>();
  if (!user || !timingSafeEqual(sig, await linkSignature(user.link_key, uid, tid))) return c.text("Not found", 404);

  // Prefer the registered URL so a leaked click link can't be pointed elsewhere.
  const registered = await c.env.DB.prepare(
    `SELECT l.url FROM links l JOIN messages m ON m.id = l.message_id
     WHERE m.tracking_id = ? AND m.user_id = ? AND l.idx = ?`,
  )
    .bind(tid, uid, linkIdx)
    .first<{ url: string }>();

  let target = registered?.url;
  if (!target) {
    try {
      target = new TextDecoder().decode(fromBase64url(c.req.query("u") ?? ""));
    } catch {
      return c.text("Not found", 404);
    }
  }
  if (!/^https?:\/\//i.test(target)) return c.text("Not found", 404);

  background(c, recordHit(c, { trackingId: tid, kind: "click", linkIdx }, Date.now()));
  return new Response(null, { status: 302, headers: { ...NO_CACHE, location: target } });
});
