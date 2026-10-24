import type { AppEnv } from "../env";
import { decrypt, encrypt } from "./crypto";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
];

export class ReauthRequiredError extends Error {
  constructor(message = "Google access was revoked or expired") {
    super(message);
    this.name = "ReauthRequiredError";
  }
}

export class GmailApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GmailApiError";
  }
}

export function redirectUri(env: AppEnv) {
  return `${env.PUBLIC_URL.replace(/\/$/, "")}/auth/google/callback`;
}

export function buildAuthUrl(
  env: AppEnv,
  opts: { state: string; codeChallenge: string; forceConsent: boolean; loginHint?: string },
) {
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(env),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    include_granted_scopes: "true",
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: "S256",
    // Google only returns a refresh token on the consent screen.
    prompt: opts.forceConsent ? "consent select_account" : "select_account",
    ...(opts.loginHint ? { login_hint: opts.loginHint } : {}),
  }).toString();
  return url.toString();
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  id_token?: string;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const json = (await res.json().catch(() => ({}))) as TokenResponse & { error?: string };
  if (json.error === "invalid_grant") throw new ReauthRequiredError();
  if (!res.ok) throw new Error(`Google token endpoint failed: ${res.status} ${json.error ?? ""}`);
  return json;
}

export function exchangeCode(env: AppEnv, code: string, codeVerifier: string) {
  return tokenRequest({
    code,
    code_verifier: codeVerifier,
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    redirect_uri: redirectUri(env),
    grant_type: "authorization_code",
  });
}

export interface IdTokenClaims {
  sub: string;
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
}

/**
 * The id_token came straight from Google's token endpoint over TLS, so per
 * OIDC Core 3.1.3.7 we validate claims without checking the signature.
 */
export function parseIdToken(env: AppEnv, idToken: string): IdTokenClaims {
  const part = idToken.split(".")[1];
  if (!part) throw new Error("Malformed id_token");
  const claims = JSON.parse(
    atob(part.replace(/-/g, "+").replace(/_/g, "/")),
  ) as IdTokenClaims & { aud: string; iss: string; exp: number };
  if (claims.aud !== env.GOOGLE_CLIENT_ID) throw new Error("id_token audience mismatch");
  if (claims.iss !== "https://accounts.google.com" && claims.iss !== "accounts.google.com") {
    throw new Error("id_token issuer mismatch");
  }
  if (claims.exp * 1000 < Date.now()) throw new Error("id_token expired");
  if (!claims.email_verified) throw new Error("Google account email is not verified");
  return claims;
}

export async function storeTokens(env: AppEnv, userId: string, tokens: TokenResponse) {
  const now = Date.now();
  const accessEnc = await encrypt(env.TOKEN_ENCRYPTION_KEY, tokens.access_token);
  const expiresAt = now + tokens.expires_in * 1000;
  if (tokens.refresh_token) {
    const refreshEnc = await encrypt(env.TOKEN_ENCRYPTION_KEY, tokens.refresh_token);
    await env.DB.prepare(
      `INSERT INTO oauth_tokens (user_id, refresh_token_enc, access_token_enc, access_expires_at, scope, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT (user_id) DO UPDATE SET refresh_token_enc = ?2, access_token_enc = ?3,
         access_expires_at = ?4, scope = ?5, updated_at = ?6`,
    )
      .bind(userId, refreshEnc, accessEnc, expiresAt, tokens.scope, now)
      .run();
  } else {
    await env.DB.prepare(
      `UPDATE oauth_tokens SET access_token_enc = ?2, access_expires_at = ?3, updated_at = ?4 WHERE user_id = ?1`,
    )
      .bind(userId, accessEnc, expiresAt, now)
      .run();
  }
}

/** Returns a valid access token, refreshing it when it expires within a minute. */
export async function getAccessToken(env: AppEnv, userId: string): Promise<string> {
  const row = await env.DB.prepare(
    `SELECT refresh_token_enc, access_token_enc, access_expires_at FROM oauth_tokens WHERE user_id = ?`,
  )
    .bind(userId)
    .first<{ refresh_token_enc: string; access_token_enc: string | null; access_expires_at: number | null }>();
  if (!row) throw new ReauthRequiredError("No Google tokens stored");

  if (row.access_token_enc && row.access_expires_at && row.access_expires_at - Date.now() > 60_000) {
    return decrypt(env.TOKEN_ENCRYPTION_KEY, row.access_token_enc);
  }

  try {
    const tokens = await tokenRequest({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: await decrypt(env.TOKEN_ENCRYPTION_KEY, row.refresh_token_enc),
      grant_type: "refresh_token",
    });
    await storeTokens(env, userId, tokens);
    return tokens.access_token;
  } catch (err) {
    if (err instanceof ReauthRequiredError) {
      await env.DB.prepare(`UPDATE users SET gmail_status = 'reauth_required' WHERE id = ?`)
        .bind(userId)
        .run();
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Gmail REST client

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailPart {
  mimeType: string;
  headers?: GmailHeader[];
  body?: { data?: string; size: number };
  parts?: GmailPart[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate: string;
  payload?: GmailPart;
}

export interface HistoryPage {
  history?: { id: string; messagesAdded?: { message: { id: string; threadId: string; labelIds?: string[] } }[] }[];
  historyId: string;
  nextPageToken?: string;
}

const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export class Gmail {
  constructor(
    private readonly env: AppEnv,
    private readonly userId: string,
  ) {}

  async request<T>(path: string, init: RequestInit = {}, attempt = 0): Promise<T> {
    const token = await getAccessToken(this.env, this.userId);
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${token}`, "content-type": "application/json" },
    });
    if (res.ok) return (await res.json()) as T;

    if (res.status === 401 && attempt === 0) {
      // Token revoked mid-flight; force a refresh once.
      await this.env.DB.prepare(`UPDATE oauth_tokens SET access_expires_at = 0 WHERE user_id = ?`)
        .bind(this.userId)
        .run();
      return this.request(path, init, attempt + 1);
    }
    if (RETRYABLE.has(res.status) && attempt < 4) {
      const retryAfter = Number(res.headers.get("retry-after")) * 1000;
      const backoff = retryAfter || Math.min(8000, 250 * 2 ** attempt) + Math.random() * 250;
      await new Promise((r) => setTimeout(r, backoff));
      return this.request(path, init, attempt + 1);
    }
    throw new GmailApiError(res.status, `Gmail ${path.split("?")[0]} failed: ${res.status} ${await res.text()}`);
  }

  getProfile() {
    return this.request<{ emailAddress: string; historyId: string }>("profile");
  }

  watch(topicName: string) {
    return this.request<{ historyId: string; expiration: string }>("watch", {
      method: "POST",
      // INBOX catches replies and bounces, SENT catches messages sent from any client.
      // Filtering avoids a notification on every draft autosave.
      body: JSON.stringify({ topicName, labelIds: ["INBOX", "SENT"], labelFilterBehavior: "include" }),
    });
  }

  stop() {
    return this.request<unknown>("stop", { method: "POST" });
  }

  listHistory(startHistoryId: string, pageToken?: string) {
    const q = new URLSearchParams({ startHistoryId, historyTypes: "messageAdded", maxResults: "500" });
    if (pageToken) q.set("pageToken", pageToken);
    return this.request<HistoryPage>(`history?${q}`);
  }

  getMessage(id: string, format: "full" | "metadata", headers: string[] = []) {
    const q = new URLSearchParams({ format });
    for (const h of headers) q.append("metadataHeaders", h);
    return this.request<GmailMessage>(`messages/${id}?${q}`);
  }

  getThread(id: string, headers: string[]) {
    const q = new URLSearchParams({ format: "metadata" });
    for (const h of headers) q.append("metadataHeaders", h);
    return this.request<{ id: string; messages?: GmailMessage[] }>(`threads/${id}?${q}`);
  }
}

export function header(msg: GmailMessage, name: string): string | undefined {
  const lower = name.toLowerCase();
  return msg.payload?.headers?.find((h) => h.name.toLowerCase() === lower)?.value;
}

/** Concatenates every text/html part of a full-format message. */
export function htmlBody(part: GmailPart | undefined): string {
  if (!part) return "";
  let out = "";
  if (part.mimeType === "text/html" && part.body?.data) {
    const b64 = part.body.data.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64);
    out += new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  }
  for (const child of part.parts ?? []) out += htmlBody(child);
  return out;
}

/** Parses `"Name" <a@b.c>` / `a@b.c` into its parts. */
export function parseAddress(raw: string | undefined): { email: string; name: string | null } {
  if (!raw) return { email: "", name: null };
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { email: m[2]!.trim().toLowerCase(), name: m[1]!.trim() || null };
  return { email: raw.trim().toLowerCase(), name: null };
}

export function parseAddressList(raw: string | undefined): string[] {
  if (!raw) return [];
  // Split on commas that are not inside quotes.
  return raw
    .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
    .map((a) => parseAddress(a).email)
    .filter(Boolean);
}
