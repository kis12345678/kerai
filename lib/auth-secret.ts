import { randomBytes } from "node:crypto";

declare global {
  var __omniaiAuthSecret: string | undefined;
}

// Ephemeral, process-local — regenerated on server restart, which simply forces re-login.
export const AUTH_SECRET =
  globalThis.__omniaiAuthSecret ?? (globalThis.__omniaiAuthSecret = randomBytes(32).toString("base64"));
