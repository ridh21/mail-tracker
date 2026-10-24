import type { UserHub } from "./hub";

export interface AppEnv {
  DB: D1Database;
  ASSETS: Fetcher;
  USER_HUB: DurableObjectNamespace<UserHub>;
  TRACK_LIMITER: RateLimit;

  PUBLIC_URL: string;
  GOOGLE_CLIENT_ID: string;
  GMAIL_PUBSUB_TOPIC: string;
  PUBSUB_SERVICE_ACCOUNT: string;
  ALLOWED_EMAILS: string;
  ALLOWED_EXTENSION_IDS: string;

  GOOGLE_CLIENT_SECRET: string;
  /** Base64 encoded 32 byte AES-GCM key for OAuth tokens at rest. */
  TOKEN_ENCRYPTION_KEY: string;
  /** Base64 encoded HMAC key for cookies, CSRF and realtime tickets. */
  SESSION_SECRET: string;
}

export interface AuthedUser {
  id: string;
  email: string;
  sessionId: string;
  sessionKind: "web" | "extension";
}

export type HonoEnv = {
  Bindings: AppEnv;
  Variables: { user: AuthedUser };
};

export function hubFor(env: AppEnv, userId: string) {
  return env.USER_HUB.get(env.USER_HUB.idFromName(userId));
}

export function csv(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
