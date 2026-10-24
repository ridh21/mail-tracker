import type { RealtimeEvent } from "@mail-tracker/shared";
import type { QueryClient } from "@tanstack/react-query";
import { api } from "./api";

/** Keeps a realtime socket open while signed in and refreshes the affected queries on events. */
export function startRealtime(client: QueryClient, onEvent?: (e: RealtimeEvent) => void): () => void {
  let ws: WebSocket | null = null;
  let stopped = false;
  let attempt = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let keepalive: ReturnType<typeof setInterval> | undefined;

  async function open() {
    if (stopped) return;
    try {
      const { ticket } = await api<{ ticket: string }>("/api/realtime/ticket", { method: "POST" });
      const url = new URL("/api/realtime", location.href);
      url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
      url.searchParams.set("ticket", ticket);
      ws = new WebSocket(url);
    } catch {
      return schedule();
    }
    ws.onopen = () => {
      attempt = 0;
      keepalive = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send("ping"), 25_000);
    };
    ws.onmessage = (e) => {
      if (e.data === "pong") return;
      const event = JSON.parse(String(e.data)) as RealtimeEvent;
      onEvent?.(event);
      void client.invalidateQueries({ queryKey: ["messages"] });
      void client.invalidateQueries({ queryKey: ["stats"] });
      if (event.type === "open" || event.type === "message" || event.type === "revoke") {
        void client.invalidateQueries({ queryKey: ["message", event.message.id] });
      } else if (event.type === "reply") {
        void client.invalidateQueries({ queryKey: ["message"] });
      } else {
        void client.invalidateQueries({ queryKey: ["me"] });
      }
    };
    ws.onclose = () => {
      clearInterval(keepalive);
      ws = null;
      schedule();
    };
  }

  function schedule() {
    if (stopped) return;
    clearTimeout(retry);
    retry = setTimeout(() => void open(), Math.min(30_000, 1000 * 2 ** attempt++));
  }

  void open();
  return () => {
    stopped = true;
    clearTimeout(retry);
    clearInterval(keepalive);
    ws?.close();
  };
}
