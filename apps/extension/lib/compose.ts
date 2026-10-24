import { pixelUrl } from "@mail-tracker/shared";

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function newTrackingId(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(16)));
}

/** Matches the worker's `linkSignature`: truncated HMAC-SHA256 of `<uid>.<trackingId>`. */
export async function linkSignature(linkKeyBase64: string, uid: string, trackingId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(atob(linkKeyBase64), (c) => c.charCodeAt(0)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${uid}.${trackingId}`));
  return base64url(new Uint8Array(sig)).slice(0, 22);
}

/**
 * Removes every pixel of ours from the body. Covers the raw URL and Gmail's
 * proxied form (`…googleusercontent.com/…#https://<host>/o/<id>.gif`).
 */
export function stripPixels(body: HTMLElement, apiUrl: string): number {
  const marker = `${new URL(apiUrl).host}/o/`;
  let removed = 0;
  for (const img of body.querySelectorAll("img")) {
    if (img.src.includes(marker) || img.getAttribute("src")?.includes(marker)) {
      img.remove();
      removed++;
    }
  }
  return removed;
}

/**
 * Puts the pixel at the very top of the body. Gmail clips messages over ~102KB
 * and a pixel at the end of a long thread would never load.
 */
export function insertPixel(body: HTMLElement, apiUrl: string, trackingId: string) {
  const img = document.createElement("img");
  img.src = pixelUrl(apiUrl, trackingId);
  img.alt = "";
  img.width = 1;
  img.height = 1;
  img.setAttribute("style", "width:1px;height:1px;max-width:1px;max-height:1px;border:0;margin:0;padding:0;overflow:hidden");
  body.insertBefore(img, body.firstChild);
}

function isQuoted(el: Element) {
  return Boolean(el.closest(".gmail_quote, blockquote, .gmail_extra"));
}

/** Rewrites links in the new (non-quoted) part of the body through the click endpoint. */
export function rewriteLinks(
  body: HTMLElement,
  opts: { apiUrl: string; uid: string; trackingId: string; signature: string },
): { idx: number; url: string }[] {
  const prefix = `${opts.apiUrl}/c/`;
  const links: { idx: number; url: string }[] = [];
  for (const a of body.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const href = a.getAttribute("href") ?? "";
    if (!/^https?:\/\//i.test(href) || href.startsWith(prefix) || isQuoted(a) || links.length >= 200) continue;
    const idx = links.length;
    links.push({ idx, url: href });
    const target = base64url(new TextEncoder().encode(href));
    a.setAttribute("href", `${prefix}${opts.uid}/${opts.trackingId}/${opts.signature}/${idx}?u=${target}`);
  }
  return links;
}
