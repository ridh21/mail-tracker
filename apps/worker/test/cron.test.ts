import { describe, expect, it } from "vitest";
import { cronSyncMode, shouldPollGmail } from "../src/cron";

const HOUR = 3600_000;
const WATCH_RENEW_BEFORE_MS = 48 * HOUR;
const now = 1_800_000_000_000;

describe("cronSyncMode", () => {
  it("defaults to auto", () => {
    expect(cronSyncMode(undefined)).toBe("auto");
    expect(cronSyncMode("")).toBe("auto");
    expect(cronSyncMode("nonsense")).toBe("auto");
  });

  it("accepts the explicit modes, case and whitespace included", () => {
    expect(cronSyncMode("always")).toBe("always");
    expect(cronSyncMode(" NEver ")).toBe("never");
  });
});

describe("shouldPollGmail", () => {
  const healthy = now + 7 * 24 * HOUR;

  it("skips the hourly poll while a Pub/Sub watch is healthy", () => {
    expect(shouldPollGmail("auto", true, healthy, now)).toBe(false);
  });

  it("polls when the watch is missing, expired, or about to expire", () => {
    expect(shouldPollGmail("auto", true, null, now)).toBe(true);
    expect(shouldPollGmail("auto", true, now - HOUR, now)).toBe(true);
    // Inside the renewal window: renew first, then decide again.
    expect(shouldPollGmail("auto", true, now + WATCH_RENEW_BEFORE_MS - HOUR, now)).toBe(true);
  });

  it("polls when Pub/Sub is not configured at all", () => {
    expect(shouldPollGmail("auto", false, healthy, now)).toBe(true);
  });

  it("honours the manual overrides", () => {
    expect(shouldPollGmail("always", true, healthy, now)).toBe(true);
    expect(shouldPollGmail("never", false, null, now)).toBe(false);
  });
});
