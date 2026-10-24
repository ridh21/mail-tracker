const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "short" });

export function ago(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return "—";
  const s = Math.round((ts - now) / 1000);
  const abs = Math.abs(s);
  if (abs < 45) return "just now";
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(s / 3600), "hour");
  if (abs < 7 * 86400) return rtf.format(Math.round(s / 86400), "day");
  return shortDate(ts);
}

export function shortDate(ts: number): string {
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

export function dateTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function duration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  const m = ms / 60_000;
  if (m < 1) return "<1 min";
  if (m < 60) return `${Math.round(m)} min`;
  const h = m / 60;
  if (h < 48) return `${h.toFixed(h < 10 ? 1 : 0)} h`;
  return `${Math.round(h / 24)} d`;
}

export function percent(part: number, total: number): string {
  if (!total) return "—";
  return `${Math.round((part / total) * 100)}%`;
}

export function recipientsLabel(list: string[]): string {
  if (!list.length) return "No recipients";
  const [first, ...rest] = list;
  return rest.length ? `${first} +${rest.length}` : first!;
}

export const SOURCE_LABEL: Record<string, string> = {
  gmail: "Gmail",
  yahoo: "Yahoo Mail",
  outlook: "Outlook",
  apple_mpp: "Apple Mail (automatic)",
  scanner: "Security scanner",
  direct: "Mail app",
};

export const REASON_LABEL: Record<string, string> = {
  self_view: "You viewed it",
  just_sent: "Right after sending",
  duplicate: "Repeat within 30s",
  quoted: "Quoted in a later reply",
  prefetch: "Privacy prefetch",
  bot: "Automated scanner",
};
