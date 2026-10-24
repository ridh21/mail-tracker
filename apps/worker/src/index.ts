import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { api } from "./api";
import { authRoutes } from "./auth";
import { runCron } from "./cron";
import type { AppEnv, HonoEnv } from "./env";
import { trackRoutes } from "./track";
import { webhooks } from "./webhooks";

export { UserHub } from "./hub";

const app = new Hono<HonoEnv>();

// Not on the realtime route: a 101 WebSocket response has immutable headers.
app.use("/api/*", (c, next) => (c.req.path === "/api/realtime" ? next() : secureHeaders()(c, next)));
app.use("/auth/*", secureHeaders({ xFrameOptions: "DENY" }));

app.route("/", trackRoutes);
app.route("/auth", authRoutes);
app.route("/api", api);
app.route("/webhooks", webhooks);

app.notFound((c) =>
  c.req.path.startsWith("/api/") ? c.json({ error: "not found" }, 404) : c.env.ASSETS.fetch(c.req.raw),
);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "internal error" }, 500);
});

export default {
  fetch: app.fetch,
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(runCron(env));
  },
} satisfies ExportedHandler<AppEnv>;
