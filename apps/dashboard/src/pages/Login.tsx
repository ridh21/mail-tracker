import { Tick } from "../components/Tick";
import { ThemeToggle } from "../components/ThemeToggle";
import { Link } from "../lib/router";

export function Login() {
  const next = location.pathname + location.search;
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex h-16 max-w-5xl items-center px-4 sm:px-6">
          <Link href="/" className="group flex items-center gap-2.5 text-sm font-medium">
            <span className="grid size-7 place-items-center rounded-md border border-line bg-surface transition-transform duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:-rotate-6">
              <Tick tick="opened" className="h-3 w-4" />
            </span>
            Mail Tracker
          </Link>
          <ThemeToggle className="ml-auto" />
        </div>
      </header>

      <main className="grid flex-1 place-items-center px-4 py-16">
        <div className="enter w-full max-w-sm rounded-xl border border-line bg-surface p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_24px_48px_-32px_rgba(0,0,0,0.18)] sm:p-7">
          <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-faint">Private instance</p>
          <div className="mt-4 flex items-center gap-1.5" aria-hidden>
            <Tick tick="sent" />
            <Tick tick="delivered" />
            <Tick tick="opened" />
          </div>
          <h1 className="mt-5 text-[26px] font-medium leading-[1.1] tracking-[-0.03em] text-balance">
            Know when your email is read.
          </h1>
          <p className="mt-2.5 text-sm leading-relaxed text-muted text-pretty">
            Read receipts for Gmail: delivered, opened, how often and when, and every reply in the thread.
          </p>
          <a
            href={`/auth/google/login?next=${encodeURIComponent(next)}`}
            className="press btn-primary mt-6 flex h-10 items-center justify-center gap-2.5 rounded-md text-sm font-medium"
          >
            <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
              <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
              <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
            </svg>
            Continue with Google
          </a>
          <p className="mt-5 border-t border-line pt-4 text-[11px] leading-relaxed text-faint">
            Gmail read-only access is used to detect replies and bounces. Nothing is sent on your behalf. Only approved
            Google accounts can sign in.
          </p>
        </div>
      </main>
    </div>
  );
}
