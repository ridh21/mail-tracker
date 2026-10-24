import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env as rawEnv } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import worker from "../src";
import type { AppEnv } from "../src/env";
import { base64url, linkSignature, randomKeyBase64, randomToken, sha256 } from "../src/lib/crypto";

const env = rawEnv as unknown as AppEnv;
const GMAIL_UA = "Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)";
const USER = "u_test";
const LINK_KEY = randomKeyBase64();
let token = "";

async function call(path: string, init: RequestInit = {}) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`https://tracker.test${path}`, init), env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

function apiCall(path: string, body?: unknown, method = body ? "POST" : "GET") {
  return call(path, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** Hits are processed inline now; kept as a no-op so the tests read as a sequence. */
const flush = async () => undefined;

const pixel = (tid: string) => call(`/o/${tid}.gif`, { headers: { "user-agent": GMAIL_UA, "cf-connecting-ip": "66.249.84.1" } });
const tid = () => randomToken(16);
const gid = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("");

async function sendTracked(opts: { threadId?: string; sentAgoMs?: number } = {}) {
  const trackingId = tid();
  const threadId = opts.threadId ?? gid();
  expect((await apiCall("/api/messages", { trackingId, subject: "Hello", to: ["a@example.com"] })).status).toBe(200);
  const sent = await apiCall(`/api/messages/${trackingId}/sent`, {
    gmailMessageId: gid(),
    threadId,
    sentAt: Date.now() - (opts.sentAgoMs ?? 3_600_000),
  });
  expect(sent.status).toBe(200);
  return { trackingId, threadId };
}

async function message(trackingId: string) {
  return env.DB.prepare(`SELECT * FROM messages WHERE tracking_id = ?`).bind(trackingId).first<{
    open_count: number;
    click_count: number;
  }>();
}

beforeAll(async () => {
  token = randomToken();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, google_sub, email, link_key, created_at) VALUES (?, 'sub-1', 'me@example.com', ?, ?)`,
    ).bind(USER, LINK_KEY, Date.now()),
    env.DB.prepare(
      `INSERT INTO sessions (id, token_hash, user_id, kind, created_at, last_used_at, expires_at)
       VALUES ('s1', ?, ?, 'extension', ?, ?, ?)`,
    ).bind(await sha256(token), USER, Date.now(), Date.now(), Date.now() + 86400_000),
  ]);
});

describe("pixel", () => {
  it("always returns an uncacheable gif", async () => {
    const res = await call("/o/not-a-real-id.gif");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/gif");
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("counts a recipient open and pushes the opened tick", async () => {
    const { trackingId } = await sendTracked();
    await pixel(trackingId);
    await flush();
    expect((await message(trackingId))?.open_count).toBe(1);

    const status = await apiCall("/api/status", { threadIds: [(await sendTracked()).threadId] });
    expect(status.status).toBe(200);
  });

  it("lists counted opens after a cursor for missed notifications", async () => {
    const since = Date.now() - 1;
    const { trackingId } = await sendTracked();
    await pixel(trackingId);
    await flush();
    const res = await apiCall(`/api/events?since=${since}`);
    const items = (await res.json()) as { event: { counted: boolean }; message: { trackingId: string } }[];
    expect(items.some((i) => i.message.trackingId === trackingId && i.event.counted)).toBe(true);
  });

  it("ignores the sender's own view of the thread", async () => {
    const { trackingId, threadId } = await sendTracked();
    expect((await apiCall("/api/views", { threadId })).status).toBe(204);
    await pixel(trackingId);
    await flush();
    expect((await message(trackingId))?.open_count).toBe(0);
  });

  it("takes back an open when the sender's view ping arrives just after it", async () => {
    const { trackingId, threadId } = await sendTracked();
    await pixel(trackingId);
    expect((await message(trackingId))?.open_count).toBe(1);
    await apiCall("/api/views", { threadId });
    expect((await message(trackingId))?.open_count).toBe(0);
  });

  it("serves status for a full page of 100 threads", async () => {
    const ids = Array.from({ length: 100 }, () => gid());
    const res = await apiCall("/api/status", { threadIds: ids });
    expect(res.status).toBe(200);
  });

  it("collapses rapid repeat fetches", async () => {
    const { trackingId } = await sendTracked();
    await pixel(trackingId);
    await pixel(trackingId);
    await flush();
    expect((await message(trackingId))?.open_count).toBe(1);
  });

  it("credits only the newest message when a reply renders quoted pixels", async () => {
    const older = await sendTracked({ sentAgoMs: 7_200_000 });
    const newer = await sendTracked({ threadId: older.threadId, sentAgoMs: 3_600_000 });
    await Promise.all([pixel(older.trackingId), pixel(newer.trackingId)]);
    await flush();
    expect((await message(older.trackingId))?.open_count).toBe(0);
    expect((await message(newer.trackingId))?.open_count).toBe(1);
  });

  it("adopts hits that arrive before registration", async () => {
    const trackingId = tid();
    await pixel(trackingId);
    const orphan = await env.DB.prepare(`SELECT message_id FROM open_events WHERE tracking_id = ?`).bind(trackingId).first();
    expect(orphan).toEqual({ message_id: null });

    const res = await apiCall("/api/messages", { trackingId, subject: "Late", to: ["b@example.com"] });
    expect(res.status).toBe(200);
    const event = await env.DB.prepare(`SELECT message_id, counted, reason FROM open_events WHERE tracking_id = ?`)
      .bind(trackingId)
      .first();
    // The hit came right as it was sent, so it is the sender's own render.
    expect(event).toEqual({ message_id: trackingId, counted: 0, reason: "just_sent" });
  });
});

describe("clicks", () => {
  it("redirects signed links to the registered URL and counts the click", async () => {
    const trackingId = tid();
    await apiCall("/api/messages", {
      trackingId,
      subject: "Links",
      to: ["c@example.com"],
      links: [{ idx: 0, url: "https://example.com/real" }],
    });
    await apiCall(`/api/messages/${trackingId}/sent`, { gmailMessageId: gid(), threadId: gid(), sentAt: Date.now() - 3_600_000 });

    const sig = await linkSignature(LINK_KEY, USER, trackingId);
    const forged = base64url(new TextEncoder().encode("https://evil.example"));
    const res = await call(`/c/${USER}/${trackingId}/${sig}/0?u=${forged}`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://example.com/real");

    await flush();
    expect((await message(trackingId))?.click_count).toBe(1);
  });

  it("rejects a bad signature", async () => {
    const res = await call(`/c/${USER}/${tid()}/${"x".repeat(22)}/0?u=aHR0cHM6Ly9ldmlsLmV4YW1wbGU`, { redirect: "manual" });
    expect(res.status).toBe(404);
  });
});

describe("api auth", () => {
  it("rejects missing credentials", async () => {
    expect((await call("/api/me")).status).toBe(401);
  });

  it("requires the csrf header for cookie-authenticated writes", async () => {
    const res = await call("/api/views", {
      method: "POST",
      headers: { cookie: `mt_session=${token}`, "content-type": "application/json" },
      body: JSON.stringify({ threadId: gid() }),
    });
    expect(res.status).toBe(403);
  });

  it("returns the current user", async () => {
    const res = await apiCall("/api/me");
    expect(await res.json()).toMatchObject({ email: "me@example.com", settings: { trackByDefault: true } });
  });
});
