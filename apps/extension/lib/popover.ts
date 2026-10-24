import { TICK_LABEL, type OpenEvent, type ThreadStatus } from "@mail-tracker/shared";
import { send } from "./protocol";
import { ago, tickIcon } from "./ticks";

const SOURCE_LABEL: Record<OpenEvent["source"], string> = {
  gmail: "Gmail",
  yahoo: "Yahoo Mail",
  outlook: "Outlook",
  apple_mpp: "Apple Mail (auto)",
  scanner: "Security scanner",
  direct: "Mail app",
};

export const POPOVER_CSS = `
.mt-tick, .inboxsdk__button_icon.mt-tick { display: inline-flex !important; align-items: center; width: 16px !important; height: 16px !important; margin-right: 4px; flex: none; }
.mt-tick img, img.mt-tick { width: 16px !important; height: 11px !important; display: block !important; opacity: 1 !important; visibility: visible !important; }
.mt-pop { position: fixed; z-index: 2147483000; width: 296px; padding: 12px 14px; border-radius: 12px;
  background: #fff; color: #1f1f1f; font: 13px/1.45 "Google Sans Text", "Google Sans", Roboto, system-ui, sans-serif;
  box-shadow: 0 0 0 1px rgb(0 0 0 / 0.06), 0 2px 4px rgb(0 0 0 / 0.06), 0 12px 32px rgb(0 0 0 / 0.14);
  opacity: 0; transform: translateY(-4px) scale(0.98); transform-origin: top left;
  transition: opacity 140ms cubic-bezier(0.23, 1, 0.32, 1), transform 140ms cubic-bezier(0.23, 1, 0.32, 1);
  pointer-events: none; }
.mt-pop[data-open] { opacity: 1; transform: none; }
.mt-pop h4 { margin: 0 0 2px; font: 500 14px/1.3 "Google Sans", Roboto, system-ui, sans-serif; display: flex; gap: 6px; align-items: center; }
.mt-pop .mt-sub { color: #5f6368; font-size: 12px; margin-bottom: 8px; font-variant-numeric: tabular-nums; }
.mt-pop ol { list-style: none; margin: 0; padding: 0; border-top: 1px solid #f1f3f4; }
.mt-pop li { display: flex; justify-content: space-between; gap: 12px; padding: 5px 0; font-variant-numeric: tabular-nums; }
.mt-pop li + li { border-top: 1px solid #f8f9fa; }
.mt-pop li span:last-child { color: #5f6368; white-space: nowrap; }
.mt-pop .mt-muted { color: #80868b; font-size: 12px; padding-top: 6px; }
@media (prefers-reduced-motion: reduce) { .mt-pop { transition: opacity 100ms linear; transform: none; } }
`;

let current: HTMLElement | null = null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatTime(ts: number) {
  const d = new Date(ts);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Shows the open timeline next to `anchor` until `hoverEnd` resolves. */
export async function showPopover(anchor: HTMLElement, status: ThreadStatus, hoverEnd: Promise<void>) {
  current?.remove();
  const pop = el("div", "mt-pop");
  current = pop;

  const latest = [...status.messages].reverse().find((m) => m.trackingId);
  const title = el("h4");
  const icon = el("img", "mt-tick");
  icon.src = tickIcon(status.tick);
  title.append(icon, TICK_LABEL[status.tick]);

  const parts: string[] = [];
  if (status.openCount) parts.push(`${status.openCount} open${status.openCount > 1 ? "s" : ""}`);
  if (status.replyCount) parts.push(`${status.replyCount} repl${status.replyCount > 1 ? "ies" : "y"}`);
  if (latest?.sentAt) parts.push(`sent ${ago(latest.sentAt)}`);
  const sub = el("div", "mt-sub", parts.join(" · ") || "Waiting for the first open");
  const list = el("ol");
  pop.append(title, sub, list);

  const rect = anchor.getBoundingClientRect();
  pop.style.left = `${Math.min(rect.left, window.innerWidth - 312)}px`;
  pop.style.top = `${rect.bottom + 6 + 240 > window.innerHeight ? rect.top - 246 : rect.bottom + 6}px`;
  document.body.append(pop);
  requestAnimationFrame(() => pop.setAttribute("data-open", ""));

  void hoverEnd.then(() => {
    pop.removeAttribute("data-open");
    setTimeout(() => pop.remove(), 160);
    if (current === pop) current = null;
  });

  if (!latest) return;
  const detail = await send({ type: "detail", messageId: latest.id }).catch(() => null);
  if (!pop.isConnected || !detail) return;

  const opens = detail.events.filter((e) => e.counted).slice(0, 6);
  for (const e of opens) {
    const row = el("li");
    const where = e.kind === "click" ? "Clicked a link" : SOURCE_LABEL[e.source];
    row.append(el("span", undefined, e.city ? `${where} · ${e.city}` : where), el("span", undefined, formatTime(e.at)));
    list.append(row);
  }
  const ignored = detail.events.filter((e) => !e.counted && e.reason !== "self_view" && e.reason !== "just_sent").length;
  if (!opens.length) list.append(el("div", "mt-muted", "No opens yet."));
  if (ignored) list.append(el("div", "mt-muted", `${ignored} automated fetch${ignored > 1 ? "es" : ""} ignored`));
}
