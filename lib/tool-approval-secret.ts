import { randomBytes } from "node:crypto";

declare global {
  var __omniaiToolApprovalSecret: string | undefined;
}

export const TOOL_APPROVAL_SECRET =
  globalThis.__omniaiToolApprovalSecret ??
  (globalThis.__omniaiToolApprovalSecret = randomBytes(32).toString("base64"));
