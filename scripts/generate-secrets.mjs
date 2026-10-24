// Prints freshly generated secrets for the worker. Pipe each into `wrangler secret put`.
import { randomBytes } from "node:crypto";

const b64 = (n) => randomBytes(n).toString("base64");
console.log(`TOKEN_ENCRYPTION_KEY=${b64(32)}`);
console.log(`SESSION_SECRET=${b64(32)}`);
