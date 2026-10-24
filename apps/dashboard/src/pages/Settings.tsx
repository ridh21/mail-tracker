import type { Me, Settings } from "@mail-tracker/shared";
import { ArrowsClockwise, CheckCircle, Desktop, PuzzlePiece, WarningCircle } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { endpoints } from "../lib/api";
import { ago } from "../lib/format";

const TOGGLES: { key: keyof Settings; label: string; hint: string }[] = [
  { key: "trackByDefault", label: "Track new emails by default", hint: "You can switch it per email from the compose toolbar." },
  { key: "notifyOnOpen", label: "Notify me on opens", hint: "Desktop notification from the extension." },
  { key: "notifyOnReply", label: "Notify me on replies", hint: "Desktop notification from the extension." },
  {
    key: "linkTracking",
    label: "Track link clicks",
    hint: "Links are routed through your tracker. Clicks are a stronger signal than opens, but rewritten links can hurt deliverability.",
  },
];

export function SettingsPage({ me }: { me: Me }) {
  const qc = useQueryClient();
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: endpoints.sessions });

  const update = useMutation({
    mutationFn: endpoints.updateSettings,
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: ["me"] });
      const prev = qc.getQueryData<Me>(["me"]);
      if (prev) qc.setQueryData<Me>(["me"], { ...prev, settings: { ...prev.settings, ...patch } });
      return { prev };
    },
    onError: (_e, _p, ctx) => ctx?.prev && qc.setQueryData(["me"], ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
  const resync = useMutation({ mutationFn: endpoints.resync, onSuccess: (data) => qc.setQueryData(["me"], data) });
  const revoke = useMutation({
    mutationFn: endpoints.revokeSession,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sessions"] }),
  });
  const logout = useMutation({ mutationFn: endpoints.logout, onSuccess: () => location.assign("/") });

  const healthy = me.gmailStatus === "ok";

  return (
    <div className="enter max-w-2xl space-y-10">
      <h1 className="text-lg font-semibold tracking-[-0.01em]">Settings</h1>
      <section>
        <h2 className="mb-3 text-[13px] font-medium text-muted">Gmail connection</h2>
        <div className="flex items-center gap-3 rounded-xl bg-surface px-4 py-3.5 smooth-shadow-ring-sm">
          {healthy ? (
            <CheckCircle size={20} weight="fill" className="shrink-0 text-ok" />
          ) : (
            <WarningCircle size={20} weight="fill" className="shrink-0 text-danger" />
          )}
          <div className="min-w-0 flex-1 text-sm">
            <div className="font-medium">{me.email}</div>
            <div className="text-muted">
              {healthy
                ? me.watchExpiresAt
                  ? `Live reply sync on · renews automatically`
                  : "Connected · live sync not configured, replies sync hourly"
                : me.gmailStatus === "reauth_required"
                  ? "Access expired, reconnect to keep syncing replies"
                  : "Couldn't start live sync. Check the Pub/Sub topic settings"}
            </div>
            {resync.isError && <div className="mt-1 text-danger">{resync.error.message}</div>}
          </div>
          {me.gmailStatus === "reauth_required" ? (
            <a href="/auth/google/login?consent=1&next=/settings" className="press btn-primary rounded-md px-3 py-1.5 text-sm font-medium">
              Reconnect
            </a>
          ) : (
            <button
              onClick={() => resync.mutate()}
              disabled={resync.isPending}
              className="press flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-50"
            >
              <ArrowsClockwise size={14} className={resync.isPending ? "animate-spin" : ""} />
              Sync now
            </button>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-[13px] font-medium text-muted">Tracking</h2>
        <div className="divide-y divide-line rounded-xl bg-surface smooth-shadow-ring-sm">
          {TOGGLES.map((t) => (
            <label key={t.key} className="flex cursor-pointer items-start justify-between gap-6 px-4 py-3.5">
              <span className="text-sm">
                <span className="font-medium">{t.label}</span>
                <span className="mt-0.5 block text-muted text-pretty">{t.hint}</span>
              </span>
              <Switch checked={me.settings[t.key]} onChange={(v) => update.mutate({ [t.key]: v })} />
            </label>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-[13px] font-medium text-muted">Signed-in devices</h2>
        <ul className="divide-y divide-line rounded-xl bg-surface smooth-shadow-ring-sm">
          {(sessions.data ?? []).map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-4 py-3 text-sm">
              {s.kind === "extension" ? <PuzzlePiece size={18} className="shrink-0 text-muted" /> : <Desktop size={18} className="shrink-0 text-muted" />}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{s.kind === "extension" ? "Gmail extension" : "Dashboard"}</div>
                <div className="truncate text-muted">
                  {s.current ? "This browser" : `Active ${ago(s.last_used_at)}`} · {s.label ?? "Unknown device"}
                </div>
              </div>
              {!s.current && (
                <button onClick={() => revoke.mutate(s.id)} className="press rounded-md px-2.5 py-1 text-sm text-muted hover:bg-surface-2 hover:text-danger">
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <button onClick={() => logout.mutate()} className="press rounded-lg px-3 py-1.5 text-sm font-medium text-muted hover:bg-surface-2 hover:text-fg">
        Sign out
      </button>
    </div>
  );
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <span className="relative mt-0.5 inline-flex shrink-0">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span className="h-5 w-8 rounded-full bg-line transition-colors duration-150 peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent/40" />
      <span className="pointer-events-none absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow-sm transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] peer-checked:translate-x-3" />
    </span>
  );
}
