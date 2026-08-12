import { NextResponse } from "next/server";
import {
  checkAccessPassword,
  createSessionToken,
  isAccessPasswordConfigured,
  SESSION_COOKIE_NAME,
} from "@/lib/auth";

// --- Brute-force throttle ---------------------------------------------------------------
// The tunnel password is the only barrier between the public hostname and a shell on this
// machine, so failed attempts get a simple in-memory backoff: after a burst of failures the
// endpoint refuses briefly. Per-process and per-IP — plenty for a single-user app.
const MAX_FAILURES = 5;
const WINDOW_MS = 10 * 60_000; // a "burst" is measured over this window
const COOLDOWN_MS = 60_000; // how long a throttled client must wait
const failures = new Map<string, { count: number; firstAt: number }>();

function clientKey(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function recordFailure(key: string): void {
  const now = Date.now();
  const entry = failures.get(key);
  if (!entry || now - entry.firstAt > WINDOW_MS) {
    failures.set(key, { count: 1, firstAt: now });
  } else {
    entry.count += 1;
  }
}

function isThrottled(key: string): boolean {
  const entry = failures.get(key);
  if (!entry) return false;
  if (Date.now() - entry.firstAt > WINDOW_MS) {
    failures.delete(key); // window elapsed — the burst is forgotten
    return false;
  }
  return entry.count >= MAX_FAILURES;
}

export async function POST(req: Request) {
  const key = clientKey(req);
  if (isThrottled(key)) {
    return NextResponse.json(
      { error: `Too many failed attempts — try again in ${Math.ceil(COOLDOWN_MS / 1000)}s.` },
      { status: 429 }
    );
  }

  // Fails closed for remote access: with no OMNIAI_PASSWORD set, nobody can log in, so an
  // exposed-but-unconfigured server is locked rather than open. Localhost never reaches here
  // (the proxy exempts loopback), so this only affects tunneled access.
  if (!isAccessPasswordConfigured()) {
    return NextResponse.json(
      { error: "OMNIAI_PASSWORD is not set on the server — set it in .env.local to enable remote access." },
      { status: 503 }
    );
  }

  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  if (!password || !checkAccessPassword(password)) {
    recordFailure(key);
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  failures.delete(key); // successful login clears the client's failure history
  const isHttps = req.headers.get("x-forwarded-proto") === "https";
  const res = NextResponse.json({ success: true });
  res.cookies.set(SESSION_COOKIE_NAME, createSessionToken(), {
    httpOnly: true,
    secure: isHttps,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ success: true });
  res.cookies.delete(SESSION_COOKIE_NAME);
  return res;
}
