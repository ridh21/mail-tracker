import { describe, expect, it } from "vitest";
import {
  base64url,
  decrypt,
  encrypt,
  fromBase64url,
  randomKeyBase64,
  signPayload,
  verifyPayload,
} from "../src/lib/crypto";

describe("crypto", () => {
  it("round-trips AES-GCM and rejects tampering", async () => {
    const key = randomKeyBase64();
    const blob = await encrypt(key, "refresh-token-value");
    expect(blob).not.toContain("refresh-token-value");
    expect(await decrypt(key, blob)).toBe("refresh-token-value");
    const [version, iv, ciphertext] = blob.split(".") as [string, string, string];
    const bytes = fromBase64url(ciphertext);
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    const tampered = `${version}.${iv}.${base64url(bytes)}`;
    await expect(decrypt(key, tampered)).rejects.toThrow();
  });

  it("signs payloads with expiry", async () => {
    const key = randomKeyBase64();
    const token = await signPayload(key, { uid: "u_1" }, 60_000);
    expect(await verifyPayload(key, token)).toMatchObject({ uid: "u_1" });

    const [payload, signature] = token.split(".") as [string, string];
    const signatureBytes = fromBase64url(signature);
    signatureBytes[0] = (signatureBytes[0] ?? 0) ^ 1;
    expect(await verifyPayload(key, `${payload}.${base64url(signatureBytes)}`)).toBeNull();
    expect(await verifyPayload(key, await signPayload(key, { uid: "u_1" }, -1))).toBeNull();
    expect(await verifyPayload(randomKeyBase64(), token)).toBeNull();
  });
});
