import { TICK_LABEL, type Tick as TickState } from "@mail-tracker/shared";
import {
  ArrowClockwise,
  ArrowDown,
  ArrowRight,
  ChartBar,
  ChatCircle,
  CursorClick,
  Eye,
  LockKey,
  PaperPlaneTilt,
  ShieldCheck,
  WarningCircle,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { Reveal } from "../components/Reveal";
import { ThemeToggle } from "../components/ThemeToggle";
import { Tick } from "../components/Tick";

const SIGN_IN = "/auth/google/login?next=/";

const ALL_TICKS: TickState[] = ["pending", "sent", "delivered", "opened", "bounced"];

const STEPS = [
  {
    title: "Send like you always do",
    body: "The extension attaches an invisible pixel when you compose in Gmail. Recipients never see a thing.",
  },
  {
    title: "We watch for the signal",
    body: "Opens, replies and bounces sync through Gmail push and your own Cloudflare Worker — even with the tab closed.",
  },
  {
    title: "The tick turns blue",
    body: "See the open count, the exact time, and a desktop notification the moment someone reads your mail.",
  },
];

export function Landing() {
  return (
    <div className="relative min-h-dvh overflow-x-clip bg-bg">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[52rem] overflow-hidden" aria-hidden>
        <div className="hero-grid absolute inset-0" />
      </div>

      <Header />
      <main>
        <Hero />
        <Features />
        <HowItWorks />
        <PrivacyCta />
      </main>
      <Footer />
    </div>
  );
}

function Header() {
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/90 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-5 sm:px-8">
        <Wordmark />
        <nav className="hidden items-center gap-6 text-[13px] text-muted md:flex">
          <a href="#features" className="nav-link hover:text-fg">
            Features
          </a>
          <a href="#how" className="nav-link hover:text-fg">
            How it works
          </a>
          <a href="#privacy" className="nav-link hover:text-fg">
            Privacy
          </a>
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          <ThemeToggle />
          <a
            href={SIGN_IN}
            className="press btn-primary ml-1 flex h-9 items-center rounded-md px-3 text-sm font-medium"
          >
            Sign in
          </a>
        </div>
      </div>
    </header>
  );
}

function Wordmark() {
  return (
    <a href="/" className="group flex shrink-0 items-center gap-2.5 text-sm font-medium tracking-[-0.01em]">
      <span className="grid size-7 place-items-center rounded-md border border-line bg-surface transition-transform duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:-rotate-6">
        <Tick tick="opened" className="h-3 w-4" />
      </span>
      Mail Tracker
    </a>
  );
}

function Hero() {
  return (
    <section className="relative mx-auto max-w-6xl px-5 pb-20 pt-14 sm:px-8 sm:pt-20 lg:pb-28 lg:pt-24">
      <div className="grid items-center gap-14 lg:grid-cols-[1.03fr_0.97fr] lg:gap-10">
        <div>
          <p
            className="hero-rise inline-flex items-center gap-2 rounded-[4px] bg-fg px-2 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-bg"
            style={{ animationDelay: "0ms" }}
          >
            <span className="relative flex size-1.5">
              <span className="soft-pulse absolute inline-flex size-full rounded-full bg-accent opacity-60" />
              <span className="relative inline-flex size-1.5 rounded-full bg-accent" />
            </span>
            Read receipts for Gmail
          </p>

          <h1
            className="hero-rise mt-6 text-[40px] font-medium leading-[1.04] tracking-[-0.04em] text-balance sm:text-[52px] lg:text-[56px]"
            style={{ animationDelay: "70ms" }}
          >
            Know when your email is{" "}
            <span className="relative whitespace-nowrap text-accent">
              read
              <svg
                viewBox="0 0 120 9"
                preserveAspectRatio="none"
                aria-hidden
                className="absolute -bottom-1.5 left-0 h-2 w-full overflow-visible"
              >
                <path
                  d="M2 6C24 3 62 1.8 118 3.6"
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                  pathLength="1"
                  className="underline-draw"
                />
              </svg>
            </span>
            .
          </h1>

          <p
            className="hero-rise mt-6 max-w-[34rem] text-[15px] leading-relaxed text-muted text-pretty"
            style={{ animationDelay: "140ms" }}
          >
            WhatsApp-style ticks inside Gmail. Delivery, every open, every reply and bounce — tracked by your own
            Cloudflare Worker, not ours.
          </p>

          <div className="hero-rise mt-8 flex flex-wrap items-center gap-2.5" style={{ animationDelay: "210ms" }}>
            <a
              href={SIGN_IN}
              className="press btn-primary flex h-10 items-center gap-2.5 rounded-md px-3.5 text-sm font-medium"
            >
              <GoogleMark />
              Continue with Google
            </a>
            <a
              href="#how"
              className="press btn-secondary group flex h-10 items-center gap-2 rounded-md px-3.5 text-sm font-medium"
            >
              See how it works
              <ArrowDown
                size={14}
                weight="bold"
                className="text-muted transition-transform duration-200 group-hover:translate-y-0.5"
              />
            </a>
          </div>

          <div
            className="hero-rise mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[10px] uppercase tracking-[0.08em] text-faint"
            style={{ animationDelay: "280ms" }}
          >
            <span className="flex items-center gap-1.5">
              <ShieldCheck size={13} className="text-ok" />
              Self-hosted and private
            </span>
            <span className="flex items-center gap-1.5">
              <LockKey size={13} />
              Approved Google accounts only
            </span>
          </div>
        </div>

        <div
          className="hero-rise relative w-full lg:flex lg:items-center lg:self-stretch lg:border-l lg:border-line lg:pl-10"
          style={{ animationDelay: "160ms" }}
        >
          <LiveReceipt />
        </div>
      </div>
    </section>
  );
}

const STEP_AT = [0, 900, 1900, 3100] as const;
type ReceiptStep = 0 | 1 | 2 | 3;

const STEP_TICK: Record<ReceiptStep, TickState> = {
  0: "pending",
  1: "sent",
  2: "delivered",
  3: "opened",
};

const STEP_LABEL: Record<ReceiptStep, string> = {
  0: "Sending",
  1: "Sent",
  2: "Delivered",
  3: "Opened",
};

const ACTIVITY = [
  { at: 1, label: "Sent", time: "9:41" },
  { at: 2, label: "Delivered", time: "9:41" },
  { at: 3, label: "Opened", time: "9:43", extra: "3×" },
] as const;

/** Animated example thread: the receipt walks from sending to opened, once. */
function LiveReceipt() {
  const [step, setStep] = useState<ReceiptStep>(0);
  const [run, setRun] = useState(0);
  const [playing, setPlaying] = useState(false);
  const tiltRef = useTilt(2.5);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStep(3);
      setPlaying(false);
      return;
    }

    setStep(0);
    setPlaying(true);
    const timers = ([1, 2, 3] as const).map((next) =>
      window.setTimeout(() => setStep(next), 450 + STEP_AT[next]),
    );
    const done = window.setTimeout(() => setPlaying(false), 450 + STEP_AT[3] + 500);

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      window.clearTimeout(done);
    };
  }, [run]);

  return (
    <div className="relative mx-auto w-full max-w-[440px]">
      <div
        ref={tiltRef}
        className="receipt-card relative rounded-xl border border-line bg-surface p-2 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_20px_50px_-24px_rgba(0,0,0,0.22)]"
        aria-label="Example read receipt"
      >
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
          <div className="flex items-center gap-1.5 border-b border-line bg-surface px-4 py-2.5">
            <span className="size-2 rounded-full bg-line" aria-hidden />
            <span className="size-2 rounded-full bg-line" aria-hidden />
            <span className="size-2 rounded-full bg-line" aria-hidden />
            <span className="ml-2 font-mono text-[9px] uppercase tracking-[0.1em] text-muted">New message</span>
            <span className="ml-auto flex items-center gap-1 rounded-[4px] border border-line bg-bg px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.08em] text-faint">
              <Tick tick="opened" className="h-2.5 w-4" />
              Tracked
            </span>
          </div>

          <div className="px-4 py-3">
            <div className="flex items-baseline gap-3 border-b border-line pb-2 text-xs">
              <span className="w-10 shrink-0 font-mono text-[9px] uppercase tracking-[0.08em] text-faint">To</span>
              <span className="flex min-w-0 items-baseline gap-1.5 truncate">
                Maya Chen <span className="truncate text-faint">maya@studio.co</span>
              </span>
            </div>
            <div className="flex items-baseline gap-3 border-b border-line py-2 text-xs">
              <span className="w-10 shrink-0 font-mono text-[9px] uppercase tracking-[0.08em] text-faint">Subject</span>
              <span className="truncate font-medium">Coffee next week?</span>
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-muted">
              Hey Maya — are you free Thursday morning? I found a place that does a proper flat white.
            </p>

            <div className="mt-3.5 flex items-center gap-2">
              <span key={step} className="tick-pop grid w-5 place-items-center">
                <Tick tick={STEP_TICK[step]} className="h-3.5 w-5" />
              </span>
              <span className="text-xs font-medium">
                {step === 3 ? "Opened 3×" : STEP_LABEL[step]}
              </span>
              <span className="font-mono text-[10px] tabular-nums text-faint">{step >= 3 ? "9:43" : "9:41"}</span>
              <button
                type="button"
                onClick={() => setRun((value) => value + 1)}
                className="press ml-auto flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-[9px] uppercase tracking-[0.08em] text-faint hover:bg-bg hover:text-fg"
              >
                <ArrowClockwise size={12} className={playing ? "animate-spin" : ""} />
                Replay
              </button>
            </div>
          </div>

          <div className="border-t border-line bg-bg px-4 py-3">
            <div className="mb-2 flex items-center justify-between font-mono text-[9px] uppercase tracking-[0.12em] text-faint">
              <span>Activity</span>
              <span>Today</span>
            </div>
            <ol className="space-y-1.5">
              {ACTIVITY.map((row, index) => {
                const shown = step >= row.at;
                return (
                  <li
                    key={row.label}
                    aria-hidden={!shown}
                    className={`flex items-center gap-2 text-[11px] transition-[opacity,transform] duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] ${
                      shown ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
                    }`}
                    style={{ transitionDelay: shown ? `${index * 40}ms` : "0ms" }}
                  >
                    <span
                      className={`size-1.5 rounded-full ${row.at === 3 ? "bg-tick-blue" : "bg-tick-grey"}`}
                      aria-hidden
                    />
                    <span>{row.label}</span>
                    {"extra" in row && (
                      <span className="rounded-[3px] bg-tick-blue/[0.12] px-1.5 py-0.5 font-mono text-[9px] text-tick-blue">
                        {row.extra}
                      </span>
                    )}
                    <span className="ml-auto font-mono text-[10px] tabular-nums text-faint">{row.time}</span>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      </div>

      {step === 3 && (
        <div className="toast-in absolute -bottom-5 left-3 right-3 z-20 flex items-center gap-3 rounded-lg border border-line bg-surface p-3 shadow-[0_12px_36px_-12px_rgba(0,0,0,0.3)] sm:-top-16 sm:bottom-auto sm:left-auto sm:right-0 sm:w-64">
          <span className="grid size-8 shrink-0 place-items-center rounded-md border border-line bg-bg">
            <Tick tick="opened" className="h-3.5 w-5" />
          </span>
          <div className="min-w-0 text-xs">
            <div className="truncate font-medium">Maya opened your email</div>
            <div className="font-mono text-[9px] uppercase tracking-[0.06em] text-faint">Just now · 3 opens</div>
          </div>
          <span className="ml-auto size-1.5 shrink-0 rounded-full bg-ok" aria-hidden />
        </div>
      )}
    </div>
  );
}

function Features() {
  return (
    <section id="features" className="scroll-mt-20 border-y border-line bg-surface">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 lg:py-24">
        <Reveal>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">What you get</p>
          <h2 className="mt-4 max-w-2xl text-[30px] font-medium leading-[1.08] tracking-[-0.035em] text-balance sm:text-[38px]">
            The whole story, without leaving your inbox.
          </h2>
        </Reveal>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Reveal className="h-full lg:col-span-2">
            <article className="lift group flex h-full flex-col rounded-lg border border-line bg-bg p-5 sm:p-6">
              <div className="flex items-start justify-between gap-4">
                <IconChip icon={<Eye size={18} weight="duotone" />} />
                <span className="rounded-[4px] border border-line bg-surface px-2 py-1 font-mono text-[9px] uppercase tracking-[0.1em] text-faint">
                  Live states
                </span>
              </div>
              <h3 className="mt-4 text-[15px] font-medium">Every tick means something</h3>
              <p className="mt-1.5 max-w-md text-sm leading-relaxed text-muted">
                From sending to opened — the receipt in Gmail is never a guess. A bounce turns it red.
              </p>
              <div className="mt-6 flex flex-wrap items-end gap-1.5">
                {ALL_TICKS.map((tick) => (
                  <span
                    key={tick}
                    className="tick-chip flex flex-col items-center gap-1.5 rounded-lg px-2.5 py-2"
                  >
                    <Tick tick={tick} className="h-3.5 w-5" />
                    <span className="font-mono text-[9px] uppercase tracking-[0.04em] text-faint">{TICK_LABEL[tick]}</span>
                  </span>
                ))}
              </div>
            </article>
          </Reveal>

          <Reveal delay={60} className="h-full">
            <article className="lift group flex h-full flex-col rounded-lg border border-line bg-bg p-5 sm:p-6">
              <IconChip icon={<ChartBar size={18} weight="duotone" />} />
              <h3 className="mt-4 text-[15px] font-medium">Open counts, not guesses</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">
                Every re-open is counted and timestamped, so you know if it landed once or five times.
              </p>
              <div className="mt-auto pt-6">
                <div className="flex h-16 items-end gap-1.5" aria-hidden>
                  {[36, 54, 28, 72, 48, 90, 62].map((height, index) => (
                    <span
                      key={index}
                      className="flex-1 origin-bottom rounded-sm bg-accent/20 transition-transform duration-500 ease-[cubic-bezier(0.23,1,0.32,1)] group-hover:scale-y-110"
                      style={{ height: `${height}%`, transitionDelay: `${index * 20}ms` }}
                    />
                  ))}
                </div>
                <div className="mt-2 flex justify-between font-mono text-[9px] uppercase tracking-[0.06em] text-faint">
                  <span>Mon</span>
                  <span>Sun</span>
                </div>
              </div>
            </article>
          </Reveal>

          <Reveal className="h-full">
            <article className="lift group flex h-full flex-col rounded-lg border border-line bg-bg p-5 sm:p-6">
              <IconChip icon={<ChatCircle size={18} weight="duotone" />} />
              <h3 className="mt-4 text-[15px] font-medium">Replies arrive on their own</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">
                Gmail push sync picks up replies — yours and theirs — even when your browser is closed.
              </p>
              <div className="mt-auto space-y-1.5 pt-6" aria-hidden>
                <div className="ml-auto w-fit max-w-[88%] rounded-md rounded-br-sm border border-line bg-surface px-2.5 py-1.5 text-[11px]">
                  Thursday works — 9:30?
                </div>
                <div className="w-fit max-w-[88%] rounded-md rounded-bl-sm border border-accent/20 bg-accent/10 px-2.5 py-1.5 text-[11px] text-accent">
                  Perfect. See you then.
                </div>
              </div>
            </article>
          </Reveal>

          <Reveal delay={60} className="h-full">
            <article className="lift group flex h-full flex-col rounded-lg border border-line bg-bg p-5 sm:p-6">
              <IconChip icon={<WarningCircle size={18} weight="duotone" />} tone="danger" />
              <h3 className="mt-4 text-[15px] font-medium">Bounces, caught early</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">
                A rejected address turns the tick red and tells you why, before you wonder.
              </p>
              <div className="mt-auto pt-6">
                <div className="flex items-center gap-2 rounded-md border border-danger/20 bg-danger/[0.07] px-3 py-2 text-[11px] text-danger">
                  <WarningCircle size={13} weight="fill" className="shrink-0" />
                  550 5.1.1 — mailbox unavailable
                </div>
              </div>
            </article>
          </Reveal>

          <Reveal delay={120} className="h-full">
            <article className="lift group flex h-full flex-col rounded-lg border border-line bg-bg p-5 sm:p-6">
              <IconChip icon={<CursorClick size={18} weight="duotone" />} />
              <h3 className="mt-4 text-[15px] font-medium">Clicks, if you want them</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">
                Optional link tracking is a stronger signal than an open. Off by default, on per email.
              </p>
              <div className="mt-auto pt-6">
                <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface px-3 py-2 text-[11px]">
                  <span className="truncate font-mono text-[10px] text-muted">notion.so/coffee-spots</span>
                  <span className="flex shrink-0 items-center gap-1 font-medium text-accent">
                    <CursorClick size={12} />
                    12 clicks
                  </span>
                </div>
              </div>
            </article>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function IconChip({ icon, tone = "accent" }: { icon: React.ReactNode; tone?: "accent" | "danger" }) {
  return (
    <span className={`icon-chip lift-icon ${tone === "danger" ? "icon-chip-danger" : ""}`} aria-hidden>
      {icon}
    </span>
  );
}

function HowItWorks() {
  return (
    <section id="how" className="scroll-mt-20">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 lg:py-24">
        <Reveal>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">How it works</p>
          <h2 className="mt-4 max-w-2xl text-[30px] font-medium leading-[1.08] tracking-[-0.035em] text-balance sm:text-[38px]">
            Three steps. No new app to check.
          </h2>
          <p className="mt-4 max-w-xl text-sm leading-relaxed text-muted">
            The extension and the Worker do the quiet work. You keep sending mail exactly the way you do now.
          </p>
        </Reveal>

        <div className="relative mt-12">
          <div className="absolute left-[9%] right-[9%] top-4 hidden border-t border-dashed border-line md:block" aria-hidden />
          <ol className="grid gap-10 md:grid-cols-3 md:gap-8">
            {STEPS.map((step, index) => (
              <li key={step.title} className="relative">
                <span className="relative z-10 grid size-9 place-items-center rounded-full border border-line bg-surface font-mono text-[11px] tabular-nums text-accent">
                  {index + 1}
                </span>
                <h3 className="mt-4 text-[15px] font-medium">{step.title}</h3>
                <p className="mt-1.5 max-w-[28rem] text-sm leading-relaxed text-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

function PrivacyCta() {
  return (
    <section id="privacy" className="scroll-mt-20 mx-auto max-w-6xl px-5 pb-20 sm:px-8 lg:pb-24">
      <Reveal>
        <div className="relative overflow-hidden rounded-xl border border-white/10 bg-[#0a0a0a] px-6 py-12 text-white sm:px-12 sm:py-14">
          <div className="privacy-grid absolute inset-0 text-white opacity-[0.09]" aria-hidden />
          <Tick
            tick="opened"
            className="pointer-events-none absolute -bottom-12 -right-8 h-44 w-64 opacity-[0.07]"
          />
          <div className="relative max-w-2xl">
            <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-white/50">
              <LockKey size={13} />
              Private by design
            </p>
            <h2 className="mt-4 text-[30px] font-medium leading-[1.05] tracking-[-0.035em] text-balance sm:text-[38px]">
              Your mail. Your database. Your call.
            </h2>
            <p className="mt-4 max-w-xl text-sm leading-relaxed text-white/60">
              Mail Tracker runs entirely on your Cloudflare account. IPs are hashed daily, tokens are encrypted with
              AES-256-GCM, and tracking can be switched off for any email.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-4">
              <a
                href={SIGN_IN}
                className="press btn-primary group flex h-10 items-center gap-2.5 rounded-md px-3.5 text-sm font-medium"
              >
                <GoogleMark />
                Continue with Google
                <ArrowRight
                  size={14}
                  weight="bold"
                  className="transition-transform duration-200 group-hover:translate-x-0.5"
                />
              </a>
              <span className="font-mono text-[9px] uppercase tracking-[0.08em] text-white/40">
                Approved accounts only
              </span>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-5 py-8 sm:flex-row sm:items-center sm:px-8">
        <div className="flex items-center gap-2.5 text-sm font-medium">
          <Tick tick="opened" className="h-3 w-4" />
          Mail Tracker
        </div>
        <p className="font-mono text-[9px] uppercase tracking-[0.08em] text-faint sm:ml-2">
          Read receipts for Gmail · self-hosted on Cloudflare
        </p>
        <nav className="flex items-center gap-4 text-xs text-muted sm:ml-auto">
          <a href="#features" className="nav-link hover:text-fg">
            Features
          </a>
          <a href="#how" className="nav-link hover:text-fg">
            How it works
          </a>
          <a href={SIGN_IN} className="nav-link hover:text-fg">
            Sign in
          </a>
          <ThemeToggle className="ml-1" />
        </nav>
      </div>
    </footer>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"
      />
    </svg>
  );
}

/** Small pointer-driven tilt. Decorative, fine pointers only, no motion when reduced. */
function useTilt(max: number) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    let targetX = 0;
    let targetY = 0;
    let x = 0;
    let y = 0;

    const tick = () => {
      x += (targetX - x) * 0.14;
      y += (targetY - y) * 0.14;
      el.style.transform = `perspective(1100px) rotateX(${y.toFixed(3)}deg) rotateY(${x.toFixed(3)}deg)`;
      frame =
        Math.abs(targetX - x) > 0.01 || Math.abs(targetY - y) > 0.01 ? requestAnimationFrame(tick) : 0;
    };

    const start = () => {
      if (!frame) frame = requestAnimationFrame(tick);
    };

    const onMove = (event: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      targetX = ((event.clientX - rect.left) / rect.width - 0.5) * max * 2;
      targetY = -((event.clientY - rect.top) / rect.height - 0.5) * max * 2;
      start();
    };

    const onLeave = () => {
      targetX = 0;
      targetY = 0;
      start();
    };

    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      cancelAnimationFrame(frame);
      el.style.transform = "";
    };
  }, [max]);

  return ref;
}
