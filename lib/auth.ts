import { createHmac, timingSafeEqual } from "node:crypto";
import { AUTH_SECRET } from "./auth-secret";

export const SESSION_COOKIE_NAME = "omniai_session";
const SESSION_VALUE = "authenticated";

function sign(value: string): string {
  return createHmac("sha256", AUTH_SECRET).update(value).digest("hex");
}

export function createSessionToken(): string {
  return `${SESSION_VALUE}.${sign(SESSION_VALUE)}`;
}

export function isValidSessionToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const dot = token.lastIndexOf(".");
  if (dot === -1) return false;
  const value = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  const expected = sign(value);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function isAccessPasswordConfigured(): boolean {
  return Boolean(process.env.OMNIAI_PASSWORD);
}

export function checkAccessPassword(candidate: string): boolean {
  const expected = process.env.OMNIAI_PASSWORD;
  if (!expected) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
