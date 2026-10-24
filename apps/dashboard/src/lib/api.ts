import type { Me, MessageSummary, OpenEvent, Settings, TimelineItem } from "@mail-tracker/shared";

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: { "content-type": "application/json", "x-requested-with": "mail-tracker", ...init.headers },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`);
  }
  return (res.status === 204 ? null : await res.json()) as T;
}

export type ListItem = MessageSummary & { replyCount: number };

export interface MessagePage {
  items: ListItem[];
  nextBefore: number | null;
}

export interface MessageDetail {
  message: MessageSummary;
  events: OpenEvent[];
  timeline: TimelineItem[];
}

export interface Stats {
  days: number;
  sent: number;
  opened: number;
  replied: number;
  bounced: number;
  avgTimeToOpenMs: number | null;
  daily: { date: number; opens: number }[];
  heatmap: { dow: number; hour: number; opens: number }[];
  sources: { source: string; counted: number; n: number }[];
}

export interface SessionInfo {
  id: string;
  kind: "web" | "extension";
  label: string | null;
  created_at: number;
  last_used_at: number;
  current: boolean;
}

export type Filter = "all" | "opened" | "unopened" | "bounced";

export const endpoints = {
  me: () => api<Me>("/api/me"),
  messages: (q: string, filter: Filter, before?: number) => {
    const params = new URLSearchParams({ limit: "50" });
    if (q) params.set("q", q);
    if (filter !== "all") params.set("filter", filter);
    if (before) params.set("before", String(before));
    return api<MessagePage>(`/api/messages?${params}`);
  },
  message: (id: string) => api<MessageDetail>(`/api/messages/${encodeURIComponent(id)}`),
  stats: (days: number) => api<Stats>(`/api/stats?days=${days}&tzOffset=${new Date().getTimezoneOffset()}`),
  sessions: () => api<SessionInfo[]>("/api/sessions"),
  revokeSession: (id: string) => api<null>(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }),
  updateSettings: (patch: Partial<Settings>) =>
    api<Settings>("/api/settings", { method: "PATCH", body: JSON.stringify(patch) }),
  resync: () => api<Me>("/api/gmail/resync", { method: "POST" }),
  logout: () => api<{ ok: true }>("/auth/logout", { method: "POST" }),
};
