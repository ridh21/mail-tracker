import { Hono, type Context, type MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { html } from "hono/html";
import { csv, type AppEnv, type HonoEnv } from "./env";
import type { UserRow } from "./db";
import {
  base64url,
  hmacSign,
  hmacVerify,
  randomKeyBase64,
  randomToken,
  sha256,
  signPayload,
  verifyPayload,
} from "./lib/crypto";
import { buildAuthUrl, exchangeCode, parseIdToken, storeTokens } from "./lib/google";
import { ensureWatch } from "./sync";

const SESSION_COOKIE = "mt_session";
const STATE_COOKIE = "mt_oauth";
const WEB_SESSION_MS = 30 * 24 * 3600_000;
const EXTENSION_SESSION_MS = 365 * 24 * 3600_000;
const SESSION_TOUCH_MS = 3600_000;

function isSecure(env: AppEnv) {
  return env.PUBLIC_URL.startsWith("https://");
}

/** Only same-origin relative paths, so `next` can't become an open redirect. */
function safeNext(next: string | undefined | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

async function createSession(env: AppEnv, userId: string, kind: "web" | "extension", label: string | null) {
  const token = randomToken();
  const now = Date.now();
  const ttl = kind === "web" ? WEB_SESSION_MS : EXTENSION_SESSION_MS;
  const id = randomToken(9);
  await env.DB.prepare(
    `INSERT INTO sessions (id, token_hash, user_id, kind, label, created_at, last_used_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, await sha256(token), userId, kind, label, now, now, now + ttl)
    .run();
  return { id, token };
}

export async function resolveSession(env: AppEnv, token: string | undefined) {
  if (!token) return null;
  const row = await env.DB.prepare(
    `SELECT s.id, s.kind, s.last_used_at, s.expires_at, u.id AS user_id, u.email
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`,
  )
    .bind(await sha256(token))
    .first<{ id: string; kind: "web" | "extension"; last_used_at: number; expires_at: number; user_id: string; email: string }>();
  if (!row || row.expires_at < Date.now()) return null;
  return row;
}

/**
 * Accepts the dashboard cookie or an extension bearer token. Cookie-authed
 * writes must carry a custom header, which a cross-site form cannot set.
 */
export const requireAuth: MiddlewareHandler<HonoEnv> = async (c, next) => {
  const bearer = c.req.header("authorization")?.match(/^Bearer (.+)$/)?.[1];
  const token = bearer ?? getCookie(c, SESSION_COOKIE);
  const session = await resolveSession(c.env, token);
  if (!session) return c.json({ error: "unauthorized" }, 401);

  // Re-check the allowlist on every request so a session created before the
  // instance was locked down stops working immediately.
  const allowed = csv(c.env.ALLOWED_EMAILS);
  if (allowed.length && !allowed.includes(session.email.toLowerCase())) {
    return c.json({ error: "not allowed on this instance" }, 403);
  }

  if (!bearer && c.req.method !== "GET" && c.req.header("x-requested-with") !== "mail-tracker") {
    return c.json({ error: "missing csrf header" }, 403);
  }

  if (Date.now() - session.last_used_at > SESSION_TOUCH_MS) {
    c.executionCtx.waitUntil(
      c.env.DB.prepare(`UPDATE sessions SET last_used_at = ? WHERE id = ?`).bind(Date.now(), session.id).run(),
    );
  }
  c.set("user", { id: session.user_id, email: session.email, sessionId: session.id, sessionKind: session.kind });
  await next();
};

async function pkcePair() {
  const verifier = randomToken(48);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return { verifier, challenge: base64url(new Uint8Array(digest)) };
}

async function startGoogleLogin(c: Context<HonoEnv>, next: string, forceConsent: boolean, loginHint?: string) {
  const state = randomToken(16);
  const { verifier, challenge } = await pkcePair();
  setCookie(c, STATE_COOKIE, await signPayload(c.env.SESSION_SECRET, { state, verifier, next }, 10 * 60_000), {
    httpOnly: true,
    secure: isSecure(c.env),
    sameSite: "Lax",
    path: "/auth",
    maxAge: 600,
  });
  return c.redirect(buildAuthUrl(c.env, { state, codeChallenge: challenge, forceConsent, loginHint }));
}

export const authRoutes = new Hono<HonoEnv>();

authRoutes.get("/google/login", (c) =>
  startGoogleLogin(c, safeNext(c.req.query("next")), c.req.query("consent") === "1"),
);

authRoutes.get("/google/callback", async (c) => {
  const env = c.env;
  const saved = await verifyPayload<{ state: string; verifier: string; next: string }>(
    env.SESSION_SECRET,
    getCookie(c, STATE_COOKIE),
  );
  deleteCookie(c, STATE_COOKIE, { path: "/auth" });

  const error = c.req.query("error");
  if (error) return c.text(`Google sign-in was cancelled (${error}).`, 400);
  if (!saved || saved.state !== c.req.query("state")) return c.text("Sign-in expired, please try again.", 400);
  const code = c.req.query("code");
  if (!code) return c.text("Missing authorization code.", 400);

  if (!env.GOOGLE_CLIENT_SECRET) {
    return c.text("Server misconfigured: GOOGLE_CLIENT_SECRET is not set (wrangler secret put GOOGLE_CLIENT_SECRET).", 500);
  }
  let tokens: Awaited<ReturnType<typeof exchangeCode>>;
  let claims: ReturnType<typeof parseIdToken>;
  try {
    tokens = await exchangeCode(env, code, saved.verifier);
    if (!tokens.id_token) return c.text("Google did not return an identity token.", 502);
    claims = parseIdToken(env, tokens.id_token);
  } catch (err) {
    console.error("google callback failed", err);
    return c.text(
      `Google sign-in failed: ${err instanceof Error ? err.message : "unknown error"}. ` +
        "Check the OAuth client id/secret and that the redirect URI matches exactly.",
      502,
    );
  }
  const email = claims.email.toLowerCase();

  const allowed = csv(env.ALLOWED_EMAILS);
  if (allowed.length && !allowed.includes(email)) {
    return c.text(`${email} is not allowed on this Mail Tracker instance.`, 403);
  }
  if (!tokens.scope.includes("gmail.readonly")) {
    return c.text("Gmail read access is required to track replies. Please allow it on the consent screen.", 400);
  }

  const user = await env.DB.prepare(
    `INSERT INTO users (id, google_sub, email, name, picture, link_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (google_sub) DO UPDATE SET email = excluded.email, name = excluded.name, picture = excluded.picture
     RETURNING *`,
  )
    .bind(`u_${randomToken(12)}`, claims.sub, email, claims.name ?? null, claims.picture ?? null, randomKeyBase64(), Date.now())
    .first<UserRow>();
  if (!user) throw new Error("User upsert failed");

  const hasRefresh = await env.DB.prepare(`SELECT 1 FROM oauth_tokens WHERE user_id = ?`).bind(user.id).first();
  if (!tokens.refresh_token && !hasRefresh) {
    // Google skips the refresh token when the app was approved before; ask again with consent.
    return startGoogleLogin(c, saved.next, true, email);
  }
  await storeTokens(env, user.id, tokens);
  c.executionCtx.waitUntil(ensureWatch(env, user.id).catch((err) => console.error("watch failed", err)));

  const session = await createSession(env, user.id, "web", c.req.header("user-agent")?.slice(0, 120) ?? null);
  setCookie(c, SESSION_COOKIE, session.token, {
    httpOnly: true,
    secure: isSecure(env),
    sameSite: "Lax",
    path: "/",
    maxAge: WEB_SESSION_MS / 1000,
  });
  return c.redirect(safeNext(saved.next));
});

authRoutes.post("/logout", async (c) => {
  const session = await resolveSession(c.env, getCookie(c, SESSION_COOKIE));
  if (session) await c.env.DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(session.id).run();
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Extension connect: chrome.identity.launchWebAuthFlow opens this page, the user
// confirms, and we redirect to https://<extension-id>.chromiumapp.org/ with a token.

function parseExtensionRedirect(env: AppEnv, raw: string | undefined) {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const m = url.hostname.match(/^([a-p]{32})\.chromiumapp\.org$/);
  if (url.protocol !== "https:" || !m) return null;
  const allowed = csv(env.ALLOWED_EXTENSION_IDS);
  if (allowed.length && !allowed.includes(m[1]!)) return null;
  return { url, extensionId: m[1]! };
}

authRoutes.get("/extension/connect", async (c) => {
  const target = parseExtensionRedirect(c.env, c.req.query("redirect_uri"));
  if (!target) return c.text("This extension is not allowed to connect.", 400);

  const session = await resolveSession(c.env, getCookie(c, SESSION_COOKIE));
  if (!session || session.kind !== "web") {
    const here = new URL(c.req.url);
    return startGoogleLogin(c, here.pathname + here.search, false);
  }

  const state = c.req.query("state") ?? "";
  const csrf = await hmacSign(c.env.SESSION_SECRET, `connect.${session.id}.${target.url}.${state}`);
  return c.html(html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Connect extension</title>
        <style>
          :root { color-scheme: light dark; font-family: ui-sans-serif, system-ui, sans-serif; }
          body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: Canvas; }
          main { max-width: 360px; padding: 24px; }
          h1 { font-size: 18px; margin: 0 0 8px; }
          p { margin: 0 0 20px; line-height: 1.5; opacity: 0.75; font-size: 14px; }
          code { font-size: 12px; }
          button { font: inherit; font-weight: 500; padding: 10px 16px; border-radius: 10px; border: 0;
            background: #1a73e8; color: white; cursor: pointer; width: 100%; }
          button:active { transform: scale(0.97); }
        </style>
      </head>
      <body>
        <main>
          <h1>Connect the Gmail extension</h1>
          <p>
            Signed in as <strong>${session.email}</strong>. The extension
            <code>${target.extensionId}</code> will be able to register and track the emails you send.
          </p>
          <form method="post">
            <input type="hidden" name="redirect_uri" value="${target.url.toString()}" />
            <input type="hidden" name="state" value="${state}" />
            <input type="hidden" name="csrf" value="${csrf}" />
            <button type="submit">Connect</button>
          </form>
        </main>
      </body>
    </html>`);
});

authRoutes.post("/extension/connect", async (c) => {
  const form = await c.req.parseBody();
  const target = parseExtensionRedirect(c.env, String(form.redirect_uri ?? ""));
  const session = await resolveSession(c.env, getCookie(c, SESSION_COOKIE));
  if (!target || !session || session.kind !== "web") return c.text("Session expired, try again.", 400);

  const state = String(form.state ?? "");
  const ok = await hmacVerify(
    c.env.SESSION_SECRET,
    `connect.${session.id}.${target.url}.${state}`,
    String(form.csrf ?? ""),
  );
  if (!ok) return c.text("Invalid request.", 403);

  const user = await c.env.DB.prepare(`SELECT id, email, link_key FROM users WHERE id = ?`)
    .bind(session.user_id)
    .first<{ id: string; email: string; link_key: string }>();
  if (!user) return c.text("Unknown user.", 400);

  const ext = await createSession(c.env, user.id, "extension", `Chrome extension ${target.extensionId}`);
  const params = new URLSearchParams({ token: ext.token, uid: user.id, email: user.email, linkKey: user.link_key, state });
  return c.redirect(`${target.url.origin}${target.url.pathname}#${params}`);
});
