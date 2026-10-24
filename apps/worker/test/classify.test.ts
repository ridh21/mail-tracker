import { describe, expect, it } from "vitest";
import { classifyOpen, classifySource, JUST_SENT_MS } from "../src/lib/classify";

const GMAIL_UA = "Mozilla/5.0 (Windows NT 5.1; rv:11.0) Gecko Firefox/11.0 (via ggpht.com GoogleImageProxy)";
const T = 1_700_000_000_000;

describe("classifySource", () => {
  it("recognises Gmail's image proxy", () => {
    expect(classifySource({ at: T, userAgent: GMAIL_UA, asn: 15169, ip: "66.249.1.1" })).toEqual({ source: "gmail", bot: false });
  });

  it("flags Apple Mail Privacy Protection prefetches", () => {
    expect(classifySource({ at: T, userAgent: "Mozilla/5.0", asn: 714, ip: "17.58.0.1" }).source).toBe("apple_mpp");
  });

  it("flags security scanners by user agent and network", () => {
    expect(classifySource({ at: T, userAgent: "python-requests/2.31", asn: 1, ip: "1.1.1.1" }).bot).toBe(true);
    expect(classifySource({ at: T, userAgent: "Mozilla/5.0 (X11)", asn: 30031, ip: "1.1.1.1" }).source).toBe("scanner");
  });

  it("treats ordinary clients as direct opens", () => {
    const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15";
    expect(classifySource({ at: T, userAgent: ua, asn: 9829, ip: "49.36.0.1" })).toEqual({ source: "direct", bot: false });
  });
});

describe("classifyOpen", () => {
  const gmail = (at: number) => ({ at, source: "gmail" as const, bot: false });
  const base = { sentAt: T, viewPings: [] as number[], lastCountedAt: null };

  it("counts a normal open", () => {
    expect(classifyOpen(gmail(T + 60_000), base)).toEqual({ source: "gmail", counted: true, reason: null });
  });

  it("ignores the sender's own render right after sending", () => {
    expect(classifyOpen(gmail(T + JUST_SENT_MS - 1), base).reason).toBe("just_sent");
  });

  it("ignores opens caused by the sender viewing the thread", () => {
    const at = T + 3_600_000;
    expect(classifyOpen(gmail(at), { ...base, viewPings: [at + 2_000] }).reason).toBe("self_view");
    expect(classifyOpen(gmail(at), { ...base, viewPings: [at - 8_000] }).reason).toBe("self_view");
    expect(classifyOpen(gmail(at), { ...base, viewPings: [at - 60_000] }).counted).toBe(true);
  });

  it("collapses repeat hits within the duplicate window", () => {
    const at = T + 3_600_000;
    expect(classifyOpen(gmail(at), { ...base, lastCountedAt: at - 10_000 }).reason).toBe("duplicate");
    expect(classifyOpen(gmail(at), { ...base, lastCountedAt: at - 120_000 }).counted).toBe(true);
  });

  it("never counts bots, even long after sending", () => {
    expect(classifyOpen({ at: T + 3_600_000, source: "apple_mpp", bot: true }, base)).toMatchObject({
      counted: false,
      reason: "prefetch",
    });
  });
});
