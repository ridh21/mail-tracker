import { createRequire } from "node:module";
import { loadEnv } from "vite";
import { defineConfig } from "wxt";

const require = createRequire(import.meta.url);

export default defineConfig({
  manifest: ({ mode }) => {
    const env = loadEnv(mode, process.cwd(), "WXT_");
    const api = new URL(env.WXT_API_URL || "http://localhost:8787");
    return {
      // Public key that pins the extension ID to cijkjhifndknmohbpoohohhialjdkoji for
      // every unpacked build, so ALLOWED_EXTENSION_IDS can be set before anyone loads
      // it (scripts/setup.mjs does). This is not a secret; the private half is not
      // needed to load or update an unpacked extension.
      key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqwlFEkxO+Rfnjh74ak5sCUec+ehoWXNXtSCm0tZ6tolXZniy14+r7iUUwDivTYntJUdp+TG0f8EyB9YdckEwLM1IlanOoZHb1hvTU1aoRHga+dKVnOFcnnE3xkWvKzjL9WwrE6klWJfNJmIyqxSkkgSl/XD+xhpPX3zWrzfd0UNwj+1/MKmVDKWh9UAq7Evp/Cw2W2m6M8gy/U+ukWBsucM+1y6AD6MS8Orlj/J17KmDokn+ujEtg9XnUQ32jmFGsmKxIc/46/8YVi48Ld4X4y1iI0lf6DcJCRbG7eH8UOzqdXIsH40PMd8KmZH5D9sUrfn+67MJ0Djy0PWaaO3nCwIDAQAB",
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
