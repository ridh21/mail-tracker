import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { endpoints, type Stats } from "../lib/api";
import { duration, percent, shortDate } from "../lib/format";

const PERIODS = [7, 30, 90];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function Insights() {
  const [days, setDays] = useState(30);
  const stats = useQuery({ queryKey: ["stats", days], queryFn: () => endpoints.stats(days) });
  const s = stats.data;

  return (
    <section className="enter">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-[-0.01em]">Insights</h1>
        <div role="radiogroup" aria-label="Period" className="flex rounded-lg bg-surface-2 p-0.5 text-[13px]">
          {PERIODS.map((p) => (
            <button
              key={p}
              role="radio"
              aria-checked={days === p}
              onClick={() => setDays(p)}
              className="press rounded-md px-3 py-1.5 text-muted tabular-nums aria-checked:bg-surface aria-checked:text-fg aria-checked:smooth-shadow-ring-xs"
            >
              {p}d
            </button>
          ))}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-line smooth-shadow-ring-sm sm:grid-cols-4">
        <Kpi label="Tracked emails" value={s ? String(s.sent) : "—"} />
        <Kpi label="Open rate" value={s ? percent(s.opened, s.sent) : "—"} hint={s ? `${s.opened} opened` : undefined} />
        <Kpi label="Reply rate" value={s ? percent(s.replied, s.sent) : "—"} hint={s ? `${s.replied} replied` : undefined} />
        <Kpi label="Time to first open" value={s ? duration(s.avgTimeToOpenMs) : "—"} hint="average" />
      </dl>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <Panel title="Opens per day">{s ? <DailyBars stats={s} /> : <div className="h-40" />}</Panel>
        <Panel title="When people open your email">{s ? <Heatmap stats={s} /> : <div className="h-40" />}</Panel>
      </div>
    </section>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="bg-surface px-4 py-3.5">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-semibold tracking-[-0.02em] tabular-nums">{value}</span>
        {hint && <span className="text-xs text-faint">{hint}</span>}
      </dd>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-[13px] font-medium text-muted">{title}</h2>
      <div className="rounded-xl bg-surface p-4 smooth-shadow-ring-sm">{children}</div>
    </section>
  );
}

function DailyBars({ stats }: { stats: Stats }) {
  const [hover, setHover] = useState<number | null>(null);
  const DAY = 86_400_000;
  const tz = new Date().getTimezoneOffset() * 60_000;
  const today = Math.floor((Date.now() - tz) / DAY);
  const byDay = new Map(stats.daily.map((d) => [Math.round(d.date / DAY), d.opens]));
  const series = Array.from({ length: stats.days }, (_, i) => {
    const day = today - stats.days + 1 + i;
    return { day, opens: byDay.get(day) ?? 0 };
  });
  const max = Math.max(1, ...series.map((d) => d.opens));
  const total = series.reduce((n, d) => n + d.opens, 0);
  const shown = hover !== null ? series[hover] : null;

  if (!total) return <EmptyChart />;
  return (
    <div>
      <div className="mb-3 flex items-baseline justify-between text-sm tabular-nums">
        <span className="font-medium">{shown ? `${shown.opens} opens` : `${total} opens`}</span>
        <span className="text-xs text-muted">{shown ? shortDate(shown.day * DAY + tz) : `last ${stats.days} days`}</span>
      </div>
      <div className="flex h-36 items-end gap-[2px]" onMouseLeave={() => setHover(null)}>
        {series.map((d, i) => (
          <div key={d.day} className="flex h-full flex-1 items-end" onMouseEnter={() => setHover(i)}>
            <div
              className="w-full rounded-t-[2px] transition-colors duration-100"
              style={{
                height: `${Math.max(d.opens ? 4 : 1, (d.opens / max) * 100)}%`,
                background: d.opens ? (hover === i ? "var(--accent)" : "color-mix(in oklch, var(--accent) 70%, transparent)") : "var(--line)",
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function Heatmap({ stats }: { stats: Stats }) {
  const grid = new Map(stats.heatmap.map((c) => [`${c.dow}:${c.hour}`, c.opens]));
  const max = Math.max(1, ...stats.heatmap.map((c) => c.opens));
  if (!stats.heatmap.length) return <EmptyChart />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-[2px] text-[10px] text-faint">
        <tbody>
          {DAYS.map((label, dow) => (
            <tr key={label}>
              <th scope="row" className="w-8 pr-1 text-left font-normal">
                {label}
              </th>
              {Array.from({ length: 24 }, (_, hour) => {
                const n = grid.get(`${dow}:${hour}`) ?? 0;
                return (
                  <td
                    key={hour}
                    title={`${label} ${String(hour).padStart(2, "0")}:00 · ${n} opens`}
                    className="h-4 min-w-2 rounded-[2px]"
                    style={{
                      background: n
                        ? `color-mix(in oklch, var(--accent) ${Math.round(20 + (n / max) * 80)}%, transparent)`
                        : "var(--surface-2)",
                    }}
                  />
                );
              })}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td />
            {Array.from({ length: 24 }, (_, h) => (
              <td key={h} className="pt-1 text-center tabular-nums">
                {h % 6 === 0 ? h : ""}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function EmptyChart() {
  return <div className="grid h-36 place-items-center text-sm text-muted">No opens in this period yet</div>;
}
