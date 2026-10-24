import { ArrowBendUpLeft, CursorClick, Eye, MagnifyingGlass } from "@phosphor-icons/react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useDeferredValue, useState } from "react";
import { Tick } from "../components/Tick";
import { endpoints, type Filter, type ListItem } from "../lib/api";
import { ago, dateTime, recipientsLabel } from "../lib/format";
import { Link } from "../lib/router";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "opened", label: "Opened" },
  { value: "unopened", label: "Not opened" },
  { value: "bounced", label: "Bounced" },
];

export function Sent() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const q = useDeferredValue(query.trim());

  const list = useInfiniteQuery({
    queryKey: ["messages", q, filter],
    queryFn: ({ pageParam }) => endpoints.messages(q, filter, pageParam),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    refetchInterval: 60_000,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <section>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="relative flex-1">
          <span className="sr-only">Search sent mail</span>
          <MagnifyingGlass size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search subject or recipient"
            className="h-9 w-full rounded-lg bg-surface pr-3 pl-9 text-sm placeholder:text-faint smooth-shadow-ring-xs outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          />
        </label>
        <div role="radiogroup" aria-label="Filter" className="flex rounded-lg bg-surface-2 p-0.5 text-[13px]">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              role="radio"
              aria-checked={filter === f.value}
              onClick={() => setFilter(f.value)}
              className="press rounded-md px-3 py-1.5 text-muted aria-checked:bg-surface aria-checked:text-fg aria-checked:smooth-shadow-ring-xs"
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl bg-surface smooth-shadow-ring-sm">
        {list.isPending ? (
          <Skeleton />
        ) : items.length === 0 ? (
          <Empty searching={Boolean(q) || filter !== "all"} />
        ) : (
          <ul className="divide-y divide-line">
            {items.map((m) => (
              <Row key={m.id} m={m} />
            ))}
          </ul>
        )}
      </div>

      {list.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={() => void list.fetchNextPage()}
            disabled={list.isFetchingNextPage}
            className="press rounded-lg px-4 py-2 text-sm font-medium text-muted hover:text-fg disabled:opacity-50"
          >
            {list.isFetchingNextPage ? "Loading…" : "Load older"}
          </button>
        </div>
      )}
    </section>
  );
}

function Row({ m }: { m: ListItem }) {
  const when = m.sentAt ?? null;
  return (
    <li>
      <Link
        href={`/m/${encodeURIComponent(m.id)}`}
        className="grid grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-3.5 px-4 py-3 transition-colors duration-150 hover:bg-surface-2/60 sm:grid-cols-[16px_minmax(0,14rem)_minmax(0,1fr)_auto]"
      >
        <Tick tick={m.tick} />
        <span className="truncate text-sm font-medium">{recipientsLabel(m.recipients)}</span>
        <span className="col-start-2 truncate text-sm text-muted sm:col-start-auto">
          {m.isReply && !/^re:/i.test(m.subject) && <span className="text-faint">Re: </span>}
          {m.subject || "(no subject)"}
        </span>
        <span className="col-start-3 row-span-2 row-start-1 flex items-center gap-3 text-xs text-muted tabular-nums sm:col-start-auto sm:row-span-1">
          {m.openCount > 0 && (
            <span className="flex items-center gap-1" title={`Opened ${m.openCount} times, last ${ago(m.lastOpenAt)}`}>
              <Eye size={14} />
              {m.openCount}
            </span>
          )}
          {m.clickCount > 0 && (
            <span className="flex items-center gap-1" title={`${m.clickCount} link clicks`}>
              <CursorClick size={14} />
              {m.clickCount}
            </span>
          )}
          {m.replyCount > 0 && (
            <span className="flex items-center gap-1 text-accent" title={`${m.replyCount} replies`}>
              <ArrowBendUpLeft size={14} weight="bold" />
              {m.replyCount}
            </span>
          )}
          <time className="w-16 text-right text-faint" dateTime={when ? new Date(when).toISOString() : undefined} title={when ? dateTime(when) : undefined}>
            {when ? ago(when) : "Sending"}
          </time>
        </span>
      </Link>
    </li>
  );
}

function Skeleton() {
  return (
    <ul className="divide-y divide-line" aria-busy>
      {Array.from({ length: 6 }, (_, i) => (
        <li key={i} className="flex items-center gap-3.5 px-4 py-3.5">
          <span className="h-2.5 w-4 rounded bg-surface-2" />
          <span className="h-2.5 w-40 rounded bg-surface-2" />
          <span className="h-2.5 flex-1 rounded bg-surface-2" />
        </li>
      ))}
    </ul>
  );
}

function Empty({ searching }: { searching: boolean }) {
  return (
    <div className="px-6 py-16 text-center">
      <p className="text-sm font-medium">{searching ? "Nothing matches" : "No tracked emails yet"}</p>
      <p className="mx-auto mt-1 max-w-xs text-sm text-muted text-pretty">
        {searching
          ? "Try a different search or filter."
          : "Send an email from Gmail with the extension connected and it will show up here within seconds."}
      </p>
    </div>
  );
}
