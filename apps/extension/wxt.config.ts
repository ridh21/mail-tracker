import { createRequire } from "node:module";
import { loadEnv } from "vite";
import { defineConfig } from "wxt";

const require = createRequire(import.meta.url);

export default defineConfig({
  manifest: ({ mode }) => {
    const env = loadEnv(mode, process.cwd(), "WXT_");
    const api = new URL(env.WXT_API_URL || "http://localhost:8787");
    return {
      name: "Mail Tracker",
      description: "WhatsApp-style read receipts for Gmail: sent, delivered, opened and replied.",
      permissions: ["scripting", "storage", "identity", "notifications", "alarms"],
      host_permissions: ["https://mail.google.com/", `${api.origin}/*`],
      action: { default_title: "Mail Tracker" },
      // Gmail must be able to load our icons from the page.
      web_accessible_resources: [{ resources: ["ticks/*.svg", "icon/*.png"], matches: ["https://mail.google.com/*"] }],
    };
  },
  hooks: {
    // InboxSDK injects this into Gmail's main world via chrome.scripting.
    "build:publicAssets": (_wxt, assets) => {
      assets.push({ absoluteSrc: require.resolve("@inboxsdk/core/pageWorld.js"), relativeDest: "pageWorld.js" });
    },
  },
});
