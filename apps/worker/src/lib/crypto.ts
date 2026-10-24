const enc = new TextEncoder();
const dec = new TextDecoder();

export function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function fromBase64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

export function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function randomKeyBase64(bytes = 32): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(bytes))));
}

export async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(input));
  return base64url(new Uint8Array(digest));
}

const hmacKeys = new Map<string, Promise<CryptoKey>>();

function hmacKey(secretBase64: string): Promise<CryptoKey> {
  let key = hmacKeys.get(secretBase64);
  if (!key) {
    key = crypto.subtle.importKey(
      "raw",
      fromBase64(secretBase64),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
    hmacKeys.set(secretBase64, key);
  }
  return key;
}

export async function hmacSign(secretBase64: string, message: string): Promise<string> {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secretBase64), enc.encode(message));
  return base64url(new Uint8Array(sig));
}

/** Constant-time verification (crypto.subtle.verify compares in constant time). */
export async function hmacVerify(
  secretBase64: string,
  message: string,
  signature: string,
): Promise<boolean> {
  let sig: Uint8Array;
  try {
    sig = fromBase64url(signature);
  } catch {
    return false;
  }
  return crypto.subtle.verify("HMAC", await hmacKey(secretBase64), sig, enc.encode(message));
}

/** Signs a JSON payload with an expiry: `<payload>.<sig>`. */
export async function signPayload(
  secretBase64: string,
  data: Record<string, unknown>,
  ttlMs: number,
): Promise<string> {
  const payload = base64url(enc.encode(JSON.stringify({ ...data, exp: Date.now() + ttlMs })));
  return `${payload}.${await hmacSign(secretBase64, payload)}`;
}

export async function verifyPayload<T extends Record<string, unknown>>(
  secretBase64: string,
  token: string | undefined | null,
): Promise<T | null> {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig || !(await hmacVerify(secretBase64, payload, sig))) return null;
  try {
    const data = JSON.parse(dec.decode(fromBase64url(payload))) as T & { exp: number };
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

const aesKeys = new Map<string, Promise<CryptoKey>>();

function aesKey(keyBase64: string): Promise<CryptoKey> {
  let key = aesKeys.get(keyBase64);
  if (!key) {
    const raw = fromBase64(keyBase64);
    if (raw.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes, base64 encoded");
    key = crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
    aesKeys.set(keyBase64, key);
  }
  return key;
}

/** AES-256-GCM. Output: `v1.<iv>.<ciphertext>` (base64url). */
export async function encrypt(keyBase64: string, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await aesKey(keyBase64),
    enc.encode(plaintext),
  );
  return `v1.${base64url(iv)}.${base64url(new Uint8Array(ct))}`;
}

export async function decrypt(keyBase64: string, blob: string): Promise<string> {
  const [version, iv, ct] = blob.split(".");
  if (version !== "v1" || !iv || !ct) throw new Error("Unrecognised ciphertext format");
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64url(iv) },
    await aesKey(keyBase64),
    fromBase64url(ct),
  );
  return dec.decode(pt);
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Click URLs carry a 128-bit truncated HMAC of `<userId>.<trackingId>` keyed by the user's link key. */
export async function linkSignature(linkKeyBase64: string, userId: string, trackingId: string) {
  return (await hmacSign(linkKeyBase64, `${userId}.${trackingId}`)).slice(0, 22);
}
