import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isValidSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { isLoopbackHost } from "@/lib/loopback";

// Logging in and the login API are the way in. The paths below carry their own authentication
// (per-device bearer tokens / satellite secret) checked inside their handlers — the session gate
// must not lock out the Android companion or the voice firmware.
const PUBLIC_PATHS = ["/login", "/api/login"];
const SELF_AUTHENTICATED_PATHS = [
  "/api/android-agent/poll",
  "/api/android-agent/result",
  "/api/voice/",
];

// The whole app is designed to run on this machine, so local access stays password-free — the
// gate exists to protect the hostname once the server is exposed via a tunnel (cloudflared etc.).
// With no OMNIAI_PASSWORD set, remote logins are refused (see app/api/login), so an exposed but
// unconfigured server is locked rather than open.
//
// Which host to judge: Next normalizes `nextUrl.hostname` to the server's own name ("localhost"
// even when a tunnel forwards the public hostname), so the real client-facing host is in the
// `x-forwarded-host` / `host` headers. Every candidate must be loopback for the exemption to
// apply — if any one says "remote", the gate applies. That also means a spoofed
// `X-Forwarded-Host: localhost` can't bypass it unless the real Host header agrees. The origin
// must still never be exposed directly on the network, and DNS rebinding is not a vector here
// (the attacker's Host header would be their own domain, not a loopback name).
export function proxy(request: NextRequest) {
  const hostCandidates = [
    request.headers.get("x-forwarded-host"),
    request.headers.get("host"),
    request.nextUrl.hostname,
  ].filter((h): h is string => Boolean(h));

  if (hostCandidates.every((h) => isLoopbackHost(h))) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }
  if (SELF_AUTHENTICATED_PATHS.some((p) => pathname === p || pathname.startsWith(p))) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (isValidSessionToken(token)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // manifest.webmanifest and icon.svg must stay unauthenticated like favicon.ico — browsers
  // fetch a PWA's manifest (to decide whether to offer "install") before the user has ever
  // logged in, and neither file contains anything sensitive (just name/icons/theme color).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest).*)"],
};
