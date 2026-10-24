import type { Me } from "@mail-tracker/shared";
import { WarningCircle } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { Link } from "../lib/router";
import { Tick } from "./Tick";
import { ThemeToggle } from "./ThemeToggle";

const NAV = [
  { href: "/", label: "Sent" },
  { href: "/insights", label: "Insights" },
  { href: "/settings", label: "Settings" },
];

export function Shell({ me, path, children }: { me: Me; path: string; children: ReactNode }) {
  const active = (href: string) => (href === "/" ? path === "/" || path.startsWith("/m/") : path === href);

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-line bg-bg/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4 sm:gap-6 sm:px-6">
          <Link href="/" className="flex shrink-0 items-center gap-2 text-[15px] font-semibold tracking-[-0.01em] whitespace-nowrap">
            <Tick tick="opened" className="h-[14px] w-5" />
            <span className="max-sm:sr-only">Mail Tracker</span>
          </Link>
          <nav className="flex items-center gap-1 text-sm">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active(n.href) ? "page" : undefined}
                className="press rounded-md px-2.5 py-1.5 text-muted hover:text-fg aria-[current=page]:bg-surface-2 aria-[current=page]:text-fg"
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex min-w-0 items-center gap-2.5">
            <ThemeToggle className="-mr-1" />
            <span className="hidden truncate text-sm text-muted sm:block">{me.email}</span>
            {me.picture ? (
              <img src={me.picture} alt="" referrerPolicy="no-referrer" className="size-7 rounded-full" />
            ) : (
              <span className="grid size-7 place-items-center rounded-full bg-surface-2 text-xs font-medium">
                {me.email[0]?.toUpperCase()}
              </span>
            )}
          </div>
        </div>
      </header>

      {me.gmailStatus !== "ok" && (
        <div className="border-b border-line bg-surface">
          <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-2.5 text-sm sm:px-6">
            <WarningCircle size={16} weight="fill" className="shrink-0 text-danger" />
            <span className="text-muted">
              {me.gmailStatus === "reauth_required"
                ? "Google access expired, so replies and bounces aren't being picked up."
                : "Gmail push notifications aren't set up. Replies sync hourly instead of instantly."}
            </span>
            <a href="/auth/google/login?consent=1&next=/settings" className="ml-auto shrink-0 font-medium text-accent">
              Reconnect
            </a>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-5xl px-4 pt-6 pb-16 sm:px-6">{children}</main>
    </div>
  );
}
