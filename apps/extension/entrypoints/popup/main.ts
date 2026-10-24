import type { Settings } from "@mail-tracker/shared";
import { send, type AuthState } from "@/lib/protocol";

const app = document.getElementById("app")!;

const LOGO = `<svg width="28" height="20" viewBox="0 0 16 11" aria-hidden="true"><path d="M1 6.2 4.2 9.4 11.4 2M7.4 8.6 8.2 9.4 15.4 2" fill="none" stroke="#34b7f1" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const TOGGLES: { key: keyof Settings; label: string; hint: string }[] = [
  { key: "trackByDefault", label: "Track new emails", hint: "Toggle per email from the compose toolbar" },
  { key: "notifyOnOpen", label: "Notify on open", hint: "Desktop notification when someone opens" },
  { key: "notifyOnReply", label: "Notify on reply", hint: "Desktop notification for replies" },
  { key: "linkTracking", label: "Track link clicks", hint: "Rewrites links; can affect deliverability" },
];

function escape(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function render(state: AuthState, error?: string) {
  if (!state.connected) {
    app.innerHTML = `
      <header>${LOGO}<div><h1>Mail Tracker</h1><div class="sub">Not connected</div></div></header>
      <p>Connect your Google account to see when your emails are delivered, opened and replied to.</p>
      <div class="actions"><button class="primary" id="connect">Connect</button></div>
      ${error ? `<div class="error">${escape(error)}</div>` : ""}`;
    document.getElementById("connect")!.addEventListener("click", async (e) => {
      const btn = e.currentTarget as HTMLButtonElement;
      btn.disabled = true;
      btn.textContent = "Connecting…";
      try {
        render(await send({ type: "auth.connect" }));
      } catch (err) {
        render(state, err instanceof Error ? err.message : String(err));
      }
    });
    return;
  }

  app.innerHTML = `
    <header>${LOGO}<div style="min-width:0"><h1>Mail Tracker</h1><div class="sub">${escape(state.email ?? "")}</div></div></header>
    <div class="rows">
      ${TOGGLES.map(
        (t) => `<label class="row"><span>${t.label}<small>${t.hint}</small></span>
          <input type="checkbox" data-key="${t.key}" ${state.settings[t.key] ? "checked" : ""} /></label>`,
      ).join("")}
    </div>
    <div class="actions">
      <a class="btn primary" href="${escape(state.apiUrl)}/" target="_blank" rel="noopener">Open dashboard</a>
      <button class="ghost" id="disconnect">Disconnect</button>
    </div>
    ${error ? `<div class="error">${escape(error)}</div>` : ""}`;

  for (const input of app.querySelectorAll<HTMLInputElement>("input[data-key]")) {
    input.addEventListener("change", async () => {
      const key = input.dataset.key as keyof Settings;
      try {
        render(await send({ type: "settings.update", patch: { [key]: input.checked } }));
      } catch (err) {
        input.checked = !input.checked;
        render(state, err instanceof Error ? err.message : String(err));
      }
    });
  }
  document.getElementById("disconnect")!.addEventListener("click", async () => render(await send({ type: "auth.disconnect" })));
}

send({ type: "auth.state" }).then((s) => render(s));
