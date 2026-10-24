import { z } from "zod";

/** 16 random bytes, base64url encoded (no padding). */
export const TRACKING_ID_RE = /^[A-Za-z0-9_-]{22}$/;
/** Gmail API message / thread ids are lowercase hex. */
export const GMAIL_ID_RE = /^[0-9a-f]{10,24}$/;

export const trackingId = z.string().regex(TRACKING_ID_RE);
export const gmailId = z.string().regex(GMAIL_ID_RE);

const email = z.string().trim().toLowerCase().max(320);

export const trackedLink = z.object({
  idx: z.number().int().min(0).max(199),
  url: z.url({ protocol: /^https?$/ }).max(4096),
});

export const registerMessageInput = z.object({
  trackingId,
  subject: z.string().max(998).default(""),
  to: z.array(email).max(500).default([]),
  cc: z.array(email).max(500).default([]),
  bcc: z.array(email).max(500).default([]),
  isReply: z.boolean().default(false),
  /** Known up front for replies; new threads only get one after sending. */
  threadId: gmailId.optional(),
  links: z.array(trackedLink).max(200).default([]),
  composedAt: z.number().int().positive().optional(),
});
export type RegisterMessageInput = z.infer<typeof registerMessageInput>;

export const linkSentInput = z.object({
  gmailMessageId: gmailId,
  threadId: gmailId,
  sentAt: z.number().int().positive().optional(),
});
export type LinkSentInput = z.infer<typeof linkSentInput>;

export const viewPingInput = z.object({
  threadId: gmailId,
});

export const statusQueryInput = z.object({
  threadIds: z.array(gmailId).min(1).max(100),
});

export const settingsSchema = z.object({
  trackByDefault: z.boolean().default(true),
  linkTracking: z.boolean().default(false),
  notifyOnOpen: z.boolean().default(true),
  notifyOnReply: z.boolean().default(true),
});
export type Settings = z.infer<typeof settingsSchema>;
export const settingsPatch = settingsSchema.partial();
