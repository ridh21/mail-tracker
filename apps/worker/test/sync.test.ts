import { env as rawEnv } from "cloudflare:workers";
import type { RealtimeEvent } from "@mail-tracker/shared";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AppEnv } from "../src/env";
import { encrypt, randomKeyBase64 } from "../src/lib/crypto";
import { syncHistory } from "../src/sync";

const env = rawEnv as unknown as AppEnv;
const USER = "u_sync";
const THREAD = "18c0ffee00000001";

function b64url(s: string) {
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const gmailMessages: Record<string, unknown> = {
  aaa0000000000001: {
    id: "aaa0000000000001",
    threadId: THREAD,
    labelIds: ["SENT"],
    internalDate: String(Date.now() - 60_000),
    payload: {
      mimeType: "multipart/alternative",
      headers: [
        { name: "Subject", value: "Proposal" },
        { name: "To", value: '"Asha K" <asha@example.com>, bob@example.com' },
      ],
      parts: [
        { mimeType: "text/plain", body: { size: 5, data: b64url("Hello") } },
        {
          mimeType: "text/html",
          body: { size: 10, data: b64url(`<div>Hello<img src="https://tracker.test/o/${"T".repeat(22)}.gif"></div>`) },
        },
      ],
    },
  },
  bbb0000000000002: {
    id: "bbb0000000000002",
    threadId: THREAD,
    labelIds: ["INBOX", "UNREAD"],
    snippet: "Sounds good, let's talk Monday",
    internalDate: String(Date.now()),
    payload: { mimeType: "text/html", headers: [{ name: "From", value: "Asha K <asha@example.com>" }] },
  },
  ccc0000000000003: {
    id: "ccc0000000000003",
    threadId: THREAD,
    labelIds: ["INBOX"],
    internalDate: String(Date.now() + 1000),
    payload: {
      mimeType: "multipart/report",
      headers: [
        { name: "From", value: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>" },
        { name: "X-Failed-Recipients", value: "bob@example.com" },
      ],
    },
  },
};

beforeAll(async () => {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, google_sub, email, link_key, history_id, created_at) VALUES (?, 'sub-sync', 'me@sync.test', ?, '100', ?)`,
    ).bind(USER, randomKeyBase64(), Date.now()),
    env.DB.prepare(
      `INSERT INTO oauth_tokens (user_id, refresh_token_enc, access_token_enc, access_expires_at, scope, updated_at)
       VALUES (?, ?, ?, ?, 'gmail.readonly', ?)`,
    ).bind(
      USER,
      await encrypt(env.TOKEN_ENCRYPTION_KEY, "refresh"),
      await encrypt(env.TOKEN_ENCRYPTION_KEY, "access"),
      Date.now() + 3_600_000,
      Date.now(),
    ),
    // Registered by the extension, but the "sent" callback never arrived.
    env.DB.prepare(
      `INSERT INTO messages (id, user_id, tracking_id, subject, recipients, registered_at) VALUES (?1, ?2, ?1, 'Proposal', '[]', ?3)`,
    ).bind("T".repeat(22), USER, Date.now() - 61_000),
  ]);
});

afterEach(() => vi.restoreAllMocks());

describe("syncHistory", () => {
  it("links sent mail, records replies and detects bounces", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname.endsWith("/history")) {
        expect(url.searchParams.get("startHistoryId")).toBe("100");
        return Response.json({
          historyId: "200",
          history: Object.values(gmailMessages).map((m, i) => ({
            id: String(101 + i),
            messagesAdded: [{ message: { id: (m as { id: string }).id, threadId: THREAD, labelIds: (m as { labelIds: string[] }).labelIds } }],
          })),
        });
      }
      const id = url.pathname.split("/").pop()!;
      const msg = gmailMessages[id];
      return msg ? Response.json(msg) : new Response("not found", { status: 404 });
    });

    const events: RealtimeEvent[] = [];
    await syncHistory(env, USER, (e) => events.push(e));

    const sent = await env.DB.prepare(`SELECT * FROM messages WHERE id = ?`).bind("T".repeat(22)).first();
    expect(sent).toMatchObject({ gmail_message_id: "aaa0000000000001", thread_id: THREAD, gmail_confirmed: 1 });
    expect(sent?.bounced_at).toBeTypeOf("number");

    const replies = await env.DB.prepare(`SELECT from_email, is_bounce FROM replies WHERE user_id = ? ORDER BY at`).bind(USER).all();
    expect(replies.results).toEqual([
      { from_email: "asha@example.com", is_bounce: 0 },
      { from_email: "mailer-daemon@googlemail.com", is_bounce: 1 },
    ]);

    const user = await env.DB.prepare(`SELECT history_id FROM users WHERE id = ?`).bind(USER).first();
    expect(user).toEqual({ history_id: "200" });
    expect(events.map((e) => e.type)).toEqual(["message", "reply", "message", "reply"]);

    // Replaying the same history is a no-op.
    await env.DB.prepare(`UPDATE users SET history_id = '100' WHERE id = ?`).bind(USER).run();
    const again: RealtimeEvent[] = [];
    await syncHistory(env, USER, (e) => again.push(e));
    expect(again).toEqual([]);
  });
});
