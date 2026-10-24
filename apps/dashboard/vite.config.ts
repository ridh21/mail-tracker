import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const worker = process.env.WORKER_URL ?? "http://localhost:8787";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Same-origin in dev so the session cookie just works.
    proxy: {
      "/api": { target: worker, ws: true },
      "/auth": worker,
      "/o": worker,
      "/c": worker,
    },
  },
});
