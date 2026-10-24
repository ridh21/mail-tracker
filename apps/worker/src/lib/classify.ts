import type { DiscardReason, OpenSource } from "@mail-tracker/shared";

export interface HitMeta {
  at: number;
  userAgent: string;
  asn: number | null;
  ip: string;
}

/** Where a hit came from, judged only by the request itself. */
export function classifySource(hit: HitMeta): { source: OpenSource; bot: boolean } {
  const ua = hit.userAgent;

  if (/GoogleImageProxy/i.test(ua)) return { source: "gmail", bot: false };
  if (/YahooMailProxy/i.test(ua)) return { source: "yahoo", bot: false };

  if (BOT_UA.test(ua) || (hit.asn !== null && SCANNER_ASNS.has(hit.asn))) {
    return { source: "scanner", bot: true };
  }

  // Apple Mail Privacy Protection fetches every image on delivery, from Apple's
  // network with a bare "Mozilla/5.0" user agent. It says nothing about a human.
  if (hit.asn === 714 || hit.ip.startsWith("17.") || ua.trim() === "Mozilla/5.0") {
    return { source: "apple_mpp", bot: true };
  }

  if (/Microsoft Outlook|ms-office|MSOffice|Outlook-iOS|Outlook-Android/i.test(ua)) {
    return { source: "outlook", bot: false };
  }
  return { source: "direct", bot: false };
}

const BOT_UA =
  /bot\b|crawler|spider|scanner|preview|headless|python-requests|python-urllib|curl\/|wget|go-http-client|okhttp|java\/|libwww|httpclient|barracuda|mimecast|proofpoint|symantec|forcepoint|trendmicro|cisco|ironport|safelinks|linkscanner|urldefense/i;

/**
 * Hosting / email security networks whose fetches are automated prefetches.
 * Google (15169) and Microsoft (8075) are deliberately absent: their mail
 * image proxies serve real opens from those networks.
 */
const SCANNER_ASNS = new Set([
  16509, // Amazon AWS
  14618, // Amazon AWS
  30031, // Mimecast
  26211, // Proofpoint
  22843, // Proofpoint
  15324, // Barracuda
  13448, // Forcepoint
  20860, // Iomart (Mailcontrol)
  14061, // DigitalOcean
  24940, // Hetzner
  16276, // OVH
]);

export interface OpenContext {
  sentAt: number | null;
  /** Times the sender's own Gmail tab rendered this message's thread. */
  viewPings: number[];
  lastCountedAt: number | null;
}

export const JUST_SENT_MS = 15_000;
export const SELF_VIEW_BEFORE_MS = 4_000;
export const SELF_VIEW_AFTER_MS = 10_000;
export const DUPLICATE_MS = 30_000;

export interface Verdict {
  source: OpenSource;
  counted: boolean;
  reason: DiscardReason | null;
}

export interface ClassifiedHit {
  at: number;
  source: OpenSource;
  bot: boolean;
}

/**
 * Decides whether a hit is a genuine open. Order matters: bot and self checks
 * win over the duplicate window so a self-view never refreshes it.
 */
export function classifyOpen(hit: ClassifiedHit, ctx: OpenContext): Verdict {
  const { source, bot } = hit;
  if (bot) return { source, counted: false, reason: source === "apple_mpp" ? "prefetch" : "bot" };

  if (ctx.sentAt !== null && hit.at - ctx.sentAt < JUST_SENT_MS) {
    return { source, counted: false, reason: "just_sent" };
  }

  // A view ping from the sender's tab may arrive slightly before or after the
  // proxy fetch it caused, so the window extends both ways.
  const selfView = ctx.viewPings.some(
    (t) => hit.at >= t - SELF_VIEW_BEFORE_MS && hit.at <= t + SELF_VIEW_AFTER_MS,
  );
  if (selfView) return { source, counted: false, reason: "self_view" };

  if (ctx.lastCountedAt !== null && hit.at - ctx.lastCountedAt < DUPLICATE_MS) {
    return { source, counted: false, reason: "duplicate" };
  }
  return { source, counted: true, reason: null };
}
