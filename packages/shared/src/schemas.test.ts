import { describe, expect, it } from "vitest";
import { settingsSchema } from "./schemas";

describe("settingsSchema", () => {
  it("pings once per email by default", () => {
    expect(settingsSchema.parse({}).notifyOnRepeat).toBe(false);
    expect(settingsSchema.parse({ notifyOnRepeat: true }).notifyOnRepeat).toBe(true);
  });

  it("keeps open and reply notifications on by default", () => {
    const settings = settingsSchema.parse({});
    expect(settings.notifyOnOpen).toBe(true);
    expect(settings.notifyOnReply).toBe(true);
  });
});
