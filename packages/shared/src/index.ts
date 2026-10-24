export * from "./schemas";
export * from "./ticks";
export * from "./types";

/** Extracts every tracking id referenced by a pixel or click URL in an HTML body. */
export function findTrackingIds(html: string): string[] {
  const ids = new Set<string>();
  for (const m of html.matchAll(/\/(?:o|c\/[A-Za-z0-9_-]+)\/([A-Za-z0-9_-]{22})(?:\.gif|\/)/g)) {
    if (m[1]) ids.add(m[1]);
  }
  return [...ids];
}

export function pixelUrl(baseUrl: string, trackingId: string): string {
  return `${baseUrl.replace(/\/$/, "")}/o/${trackingId}.gif`;
}
