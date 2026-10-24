# Security policy

## Supported versions

Security fixes are applied to `main` and the latest release. This project is early-stage (v0.1); there are no long-term support branches yet.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Use GitHub's private vulnerability reporting:

1. Open the repository's **Security** tab.
2. Click **Report a vulnerability**.
3. Include the affected area, a reproduction, the impact, and any relevant logs with secrets redacted.

If private reporting is unavailable, contact the maintainer through their GitHub profile. Please allow a few days for a first response. Once a fix is ready, we will coordinate disclosure.

## In scope

- Authentication and session handling (OAuth, cookies, bearer tokens, CSRF).
- Google token encryption and secret handling.
- Pub/Sub webhook verification and replay handling.
- Click-link signature bypass or open redirects.
- SQL injection, stored/reflected XSS, and authorization gaps between users.
- Extension token leakage or cross-extension connection.
- Exposure of personal data (emails, IP-derived hashes, locations, user agents).
- Denial-of-service vectors that are cheap to trigger and materially affect a self-hosted instance.

## Out of scope

- Recipients blocking tracking pixels or plain-text emails not being tracked.
- Email deliverability or spam-filter decisions.
- Vulnerabilities in Google, Cloudflare, InboxSDK, or Chrome itself.
- Misconfiguration of your own deployment, including leaving `ALLOWED_EMAILS` empty on a public instance.
- Social engineering and physical access.
- Reports that require access to the maintainer's Cloudflare or Google account.

## Deployment hardening checklist

- Set `ALLOWED_EMAILS` and `ALLOWED_EXTENSION_IDS` before sharing a deployment URL.
- Keep `PUBLIC_URL` exact; it is part of OAuth redirects and webhook audience validation.
- Store secrets with `wrangler secret put`; never commit `.dev.vars`, `.env`, keys, or exported D1 data.
- Enable 2FA on Cloudflare and Google accounts and limit who can deploy.
- Keep dependencies and the Wrangler version up to date.
- Review `wrangler tail` logs for unexpected traffic, but redact secrets before sharing them.
- Back up D1 if the data matters; deleting the database is currently the only way to erase all data.

## If a secret was exposed

Rotate first, then clean up:

1. **`GOOGLE_CLIENT_SECRET`** — create a new client secret in Google Cloud, update the Worker secret, and delete the old one.
2. **`TOKEN_ENCRYPTION_KEY`** — generate a new key and update the Worker secret. Existing encrypted Google tokens become unreadable, so users must reconnect.
3. **`SESSION_SECRET`** — generate a new key and update the Worker secret. This signs everyone out and invalidates outstanding OAuth state and realtime tickets.
4. **Cloudflare API tokens** — revoke them in the Cloudflare dashboard and issue replacements with the narrowest scope possible.
5. **Google account or OAuth client** — revoke suspicious sessions and review the OAuth consent screen and authorized redirect URIs.

Removing a secret from git history does not make the old value safe. Assume any secret that reached a remote is compromised.
