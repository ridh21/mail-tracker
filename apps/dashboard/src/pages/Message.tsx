import { TICK_LABEL, type OpenEvent, type TimelineItem } from "@mail-tracker/shared";
import { ArrowBendUpLeft, ArrowLeft, CursorClick, Eye, PaperPlaneTilt, Warning } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Tick } from "../components/Tick";
import { ApiError, endpoints } from "../lib/api";
import { ago, dateTime, duration, REASON_LABEL, SOURCE_LABEL } from "../lib/format";
import { Link } from "../lib/router";

export function MessagePage({ id }: { id: string }) {
  const detail = useQuery({ queryKey: ["message", id], queryFn: () => endpoints.message(id), refetchInterval: 60_000 });
  const [showIgnored, setShowIgnored] = useState(false);

  if (detail.isPending) return <div className="h-64" aria-busy />;
  if (detail.isError) {
    return (
      <div className="py-16 text-center text-sm text-muted">
        {detail.error instanceof ApiError && detail.error.status === 404 ? "This message doesn't exist." : detail.error.message}{" "}
        <Link href="/" className="font-medium text-accent">
          Back to sent
        </Link>
      </div>
    );
  }

  const { message: m, events, timeline } = detail.data;
  const counted = events.filter((e) => e.counted);
  const ignored = events.filter((e) => !e.counted);
  const timeToOpen = m.firstOpenAt && m.sentAt ? m.firstOpenAt - m.sentAt : null;

  // Weave this message's opens into the thread timeline.
  const items: TimelineItem[] = [
    ...timeline,
    ...counted.map((event): TimelineItem => ({ type: "open", at: event.at, messageId: m.id, event })),
  ].sort((a, b) => a.at - b.at);

  return (
    <article className="enter">
      <Link href="/" className="press -ml-1 inline-flex items-center gap-1.5 rounded-md px-1 py-0.5 text-sm text-muted hover:text-fg">
        <ArrowLeft size={14} /> Sent
      </Link>

      <header className="mt-4 mb-6">
        <h1 className="text-xl font-semibold tracking-[-0.015em] text-balance">{m.subject || "(no subject)"}</h1>
        <p className="mt-1 text-sm text-muted">To {m.recipients.join(", ") || "no recipients"}</p>
      </header>

      <dl className="mb-8 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-line smooth-shadow-ring-sm sm:grid-cols-4">
        <Stat label="Status">
          <span className="flex items-center gap-2">
            <Tick tick={m.tick} />
            {TICK_LABEL[m.tick]}
          </span>
        </Stat>
        <Stat label="Opens">{m.openCount}</Stat>
        <Stat label="First opened">{m.firstOpenAt ? <span title={dateTime(m.firstOpenAt)}>{duration(timeToOpen)} after</span> : "—"}</Stat>
        <Stat label="Last opened">{m.lastOpenAt ? <span title={dateTime(m.lastOpenAt)}>{ago(m.lastOpenAt)}</span> : "—"}</Stat>
      </dl>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section aria-labelledby="thread-heading">
          <h2 id="thread-heading" className="mb-3 text-[13px] font-medium text-muted">
            Thread activity
          </h2>
          <ol className="relative">
            {items.map((item, i) => (
              <TimelineRow key={i} item={item} currentId={m.id} last={i === items.length - 1} />
            ))}
          </ol>
        </section>

        <section aria-labelledby="opens-heading">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 id="opens-heading" className="text-[13px] font-medium text-muted">
              Open log
            </h2>
            {ignored.length > 0 && (
              <button onClick={() => setShowIgnored((v) => !v)} className="press text-xs text-faint hover:text-muted">
                {showIgnored ? "Hide" : "Show"} {ignored.length} ignored
              </button>
            )}
          </div>
          <ul className="divide-y divide-line overflow-hidden rounded-xl bg-surface text-sm smooth-shadow-ring-sm">
            {(showIgnored ? events : counted).map((e) => (
              <EventRow key={e.id} e={e} />
            ))}
            {!counted.length && !showIgnored && <li className="px-4 py-6 text-center text-muted">Not opened yet</li>}
          </ul>
          <p className="mt-3 text-xs leading-relaxed text-faint text-pretty">
            Gmail loads images through Google's proxy, so location isn't available for Gmail readers. Opens from your own
            Gmail, privacy prefetches and scanners are filtered out.
          </p>
        </section>
      </div>
    </article>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface px-4 py-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 text-[15px] font-medium tabular-nums">{children}</dd>
    </div>
  );
}

function EventRow({ e }: { e: OpenEvent }) {
  const where = e.kind === "click" ? `Clicked ${e.linkUrl ? new URL(e.linkUrl).hostname : "a link"}` : SOURCE_LABEL[e.source] ?? e.source;
  return (
    <li className={`flex items-center justify-between gap-3 px-4 py-2.5 ${e.counted ? "" : "text-faint"}`}>
      <span className="min-w-0 truncate">
        {where}
        {e.city && <span className="text-muted"> · {e.city}</span>}
        {!e.counted && e.reason && <span> · {REASON_LABEL[e.reason] ?? e.reason}</span>}
      </span>
      <time className="shrink-0 text-xs text-muted tabular-nums" title={new Date(e.at).toLocaleString()}>
        {dateTime(e.at)}
      </time>
    </li>
  );
}

function TimelineRow({ item, currentId, last }: { item: TimelineItem; currentId: string; last: boolean }) {
  let icon: React.ReactNode;
  let title: React.ReactNode;
  let body: React.ReactNode = null;

  if (item.type === "sent") {
    const mine = item.message.id === currentId;
    icon = <PaperPlaneTilt size={14} weight={mine ? "fill" : "regular"} />;
    title = (
      <span className="flex items-center gap-2">
        {mine ? (
          "You sent this email"
        ) : (
          <Link href={`/m/${encodeURIComponent(item.message.id)}`} className="hover:underline">
            You {item.message.isReply ? "replied" : "sent"}
          </Link>
        )}
        <Tick tick={item.message.tick} />
        {!mine && item.message.openCount > 0 && <span className="text-xs text-muted">{item.message.openCount} opens</span>}
      </span>
    );
  } else if (item.type === "open") {
    icon = item.event.kind === "click" ? <CursorClick size={14} /> : <Eye size={14} />;
    title = item.event.kind === "click" ? "Link clicked" : "Opened";
    body = <span className="text-muted">{SOURCE_LABEL[item.event.source]}</span>;
  } else if (item.reply.isBounce) {
    icon = <Warning size={14} className="text-danger" />;
    title = <span className="text-danger">Bounced</span>;
    body = item.reply.snippet && <span className="line-clamp-2 text-muted">{item.reply.snippet}</span>;
  } else {
    icon = <ArrowBendUpLeft size={14} weight="bold" className="text-accent" />;
    title = <span>{item.reply.fromName ?? item.reply.fromEmail} replied</span>;
    body = item.reply.snippet && <span className="line-clamp-2 text-muted">{item.reply.snippet}</span>;
  }

  return (
    <li className="relative grid grid-cols-[28px_minmax(0,1fr)] gap-x-3 pb-5">
      {!last && <span className="absolute top-7 bottom-0 left-[13.5px] w-px bg-line" aria-hidden />}
      <span className="grid size-7 place-items-center rounded-full bg-surface text-muted smooth-shadow-ring-xs">{icon}</span>
      <div className="min-w-0 pt-1 text-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <div className="font-medium">{title}</div>
          <time className="text-xs text-faint tabular-nums">{item.at ? dateTime(item.at) : "Sending"}</time>
        </div>
        {body && <div className="mt-0.5">{body}</div>}
      </div>
    </li>
  );
}
