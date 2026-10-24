import { TICK_LABEL, type MessageSummary, type ThreadStatus, type Tick } from "@mail-tracker/shared";

/**
 * Icons ship as extension files: Gmail's CSP / Trusted Types silently drop
 * data: image URLs injected into its UI, so they would never render.
 */
export function tickIcon(tick: Tick): string {
  return chrome.runtime.getURL(`/ticks/${tick === "untracked" ? "sent" : tick}.svg`);
}

export function assetUrl(path: string): string {
  return chrome.runtime.getURL(path);
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "short" });

export function ago(ts: number, now = Date.now()): string {
  const s = Math.round((ts - now) / 1000);
  const abs = Math.abs(s);
  if (abs < 45) return "just now";
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(s / 3600), "hour");
  if (abs < 7 * 86400) return rtf.format(Math.round(s / 86400), "day");
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function messageTooltip(m: MessageSummary): string {
  switch (m.tick) {
    case "opened":
      return `Opened ${m.openCount}× · last ${ago(m.lastOpenAt ?? 0)}${m.clickCount ? ` · ${m.clickCount} click${m.clickCount > 1 ? "s" : ""}` : ""}`;
    case "delivered":
      return `Delivered · not opened yet`;
    case "bounced":
      return `Bounced ${ago(m.bouncedAt ?? 0)}`;
    case "untracked":
      return "Sent without tracking";
    default:
      return TICK_LABEL[m.tick];
  }
}

export function threadTooltip(s: ThreadStatus): string {
  const latest = [...s.messages].reverse().find((m) => m.trackingId) ?? s.messages.at(-1);
  const base = latest ? messageTooltip(latest) : TICK_LABEL[s.tick];
  return s.replyCount ? `${base} · ${s.replyCount} repl${s.replyCount > 1 ? "ies" : "y"}` : base;
}
