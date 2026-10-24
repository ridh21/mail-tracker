import { describe, expect, it } from "vitest";
import { findTrackingIds } from "./index";
import { DELIVERED_AFTER_MS, deriveTick } from "./ticks";

describe("deriveTick", () => {
  const base = { tracked: true, sentAt: 1_000, bouncedAt: null, openCount: 0 };
  it("walks pending → sent → delivered → opened", () => {
    expect(deriveTick({ ...base, sentAt: null }, 2_000)).toBe("pending");
    expect(deriveTick(base, 2_000)).toBe("sent");
    expect(deriveTick(base, 1_000 + DELIVERED_AFTER_MS)).toBe("delivered");
    expect(deriveTick({ ...base, openCount: 2 }, 2_000)).toBe("opened");
  });
  it("lets a bounce override everything", () => {
    expect(deriveTick({ ...base, openCount: 3, bouncedAt: 5_000 })).toBe("bounced");
  });
  it("marks mail sent from other clients as untracked", () => {
    expect(deriveTick({ ...base, tracked: false })).toBe("untracked");
  });
});

describe("findTrackingIds", () => {
  it("finds pixel and click ids, including Gmail-proxied pixels", () => {
    const id = "A".repeat(22);
    const html = `<img src="https://ci3.googleusercontent.com/meips/x#https://t.dev/o/${id}.gif"><a href="https://t.dev/c/u_1/${"B".repeat(22)}/sig/0">`;
    expect(findTrackingIds(html)).toEqual([id, "B".repeat(22)]);
  });
});
