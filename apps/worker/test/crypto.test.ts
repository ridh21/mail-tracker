import { describe, expect, it } from "vitest";
import { decrypt, encrypt, randomKeyBase64, signPayload, verifyPayload } from "../src/lib/crypto";

describe("crypto", () => {
  it("round-trips AES-GCM and rejects tampering", async () => {
    const key = randomKeyBase64();
    const blob = await encrypt(key, "refresh-token-value");
    expect(blob).not.toContain("refresh-token-value");
    expect(await decrypt(key, blob)).toBe("refresh-token-value");
    const tampered = blob.slice(0, -2) + (blob.endsWith("A") ? "BB" : "AA");
    await expect(decrypt(key, tampered)).rejects.toThrow();
  });

  it("signs payloads with expiry", async () => {
    const key = randomKeyBase64();
    const token = await signPayload(key, { uid: "u_1" }, 60_000);
    expect(await verifyPayload(key, token)).toMatchObject({ uid: "u_1" });
    expect(await verifyPayload(key, token.replace(/.$/, "x"))).toBeNull();
    expect(await verifyPayload(key, await signPayload(key, { uid: "u_1" }, -1))).toBeNull();
    expect(await verifyPayload(randomKeyBase64(), token)).toBeNull();
  });
});
