import { TICK_LABEL, type Tick as TickState } from "@mail-tracker/shared";

const CHECK = "M1 6.2 4.2 9.4 11.4 2";
const SECOND = "M7.4 8.6 8.2 9.4 15.4 2";

/** WhatsApp-style receipt: clock → ✓ → ✓✓ → blue ✓✓, or ✕ when bounced. */
export function Tick({ tick, className = "" }: { tick: TickState; className?: string }) {
  const color =
    tick === "opened" ? "var(--tick-blue)" : tick === "bounced" ? "var(--danger)" : "var(--tick-grey)";
  return (
    <svg
      viewBox="0 0 16 11"
      width="16"
      height="11"
      role="img"
      aria-label={TICK_LABEL[tick]}
      className={`shrink-0 ${className}`}
      fill="none"
      stroke={color}
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {tick === "pending" && (
        <>
          <circle cx="8" cy="5.7" r="4.4" strokeWidth="1.4" />
          <path d="M8 3.4v2.5l1.7 1" strokeWidth="1.4" />
        </>
      )}
      {tick === "sent" && <path d={CHECK} />}
      {(tick === "delivered" || tick === "opened") && <path d={`${CHECK}${SECOND}`} />}
      {tick === "bounced" && <path d="M4.5 2.2l7 7M11.5 2.2l-7 7" />}
      {tick === "untracked" && <path d={CHECK} strokeDasharray="2 2" />}
    </svg>
  );
}
