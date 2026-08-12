import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { createSessionToken, SESSION_COOKIE_NAME } from "@/lib/auth";

function req(
  host: string,
  path: string,
  cookie?: string,
  extraHeaders?: Record<string, string>
): NextRequest {
  const headers: Record<string, string> = { host, ...extraHeaders };
  if (cookie) headers.cookie = cookie;
  // Only a bare IPv6 literal needs URL brackets; "[::1]:3000" and "localhost:3000" are
  // already valid authority forms.
  const urlHost = host.startsWith("[") || !host.startsWith("::") ? host : `[${host}]`;
  return new NextRequest(`http://${urlHost}${path}`, { headers });
}

describe("proxy (auth gate)", () => {
  it("lets loopback traffic through without any session", () => {
    expect(proxy(req("localhost", "/dashboard")).status).toBe(200); // NextResponse.next() is a 200
    expect(proxy(req("127.0.0.1", "/dashboard")).status).toBe(200);
    expect(proxy(req("::1", "/dashboard")).status).toBe(200);
    expect(proxy(req("app.localhost", "/dashboard")).status).toBe(200); // *.localhost is loopback too
    // Host headers carry ports in practice (the desktop app loads http://localhost:3000) —
    // and the IPv6 literal arrives bracketed.
    expect(proxy(req("localhost:3000", "/dashboard")).status).toBe(200);
    expect(proxy(req("[::1]:3000", "/dashboard")).status).toBe(200);
  });

  it("redirects remote page requests to /login when there is no session", () => {
    const res = proxy(req("openai.kerai.in", "/dashboard"));
    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/login");
    expect(location).toContain(encodeURIComponent("/dashboard")); // next target preserved
  });

  it("rejects remote API requests with 401 when there is no session", () => {
    const res = proxy(req("openai.kerai.in", "/api/chat"));
    expect(res.status).toBe(401);
  });

  it("lets a valid session cookie through on remote requests", () => {
    const res = proxy(req("openai.kerai.in", "/dashboard", `${SESSION_COOKIE_NAME}=${createSessionToken()}`));
    expect(res.status).toBe(200);
  });

  it("rejects a tampered session cookie", () => {
    const res = proxy(req("openai.kerai.in", "/dashboard", `${SESSION_COOKIE_NAME}=authenticated.deadbeef`));
    expect(res.status).toBe(307);
  });

  it("does not trust a spoofed x-forwarded-host when the Host header disagrees", () => {
    // Next's own nextUrl.hostname normalizes to the server name, so the gate judges the
    // forwarded candidates — but requires them ALL to be loopback. Forging just one header
    // (xfh: localhost) must not open the gate.
    const res = proxy(req("evil.example.com", "/dashboard", undefined, { "x-forwarded-host": "localhost" }));
    expect(res.status).toBe(307);
  });

  it("keeps /login and the login API reachable without a session", () => {
    expect(proxy(req("openai.kerai.in", "/login")).status).toBe(200);
    expect(proxy(req("openai.kerai.in", "/api/login")).status).toBe(200);
  });

  it("exempts device-authenticated endpoints from the session gate", () => {
    expect(proxy(req("openai.kerai.in", "/api/android-agent/poll")).status).toBe(200);
    expect(proxy(req("openai.kerai.in", "/api/android-agent/result")).status).toBe(200);
    expect(proxy(req("openai.kerai.in", "/api/voice/turn")).status).toBe(200);
    expect(proxy(req("openai.kerai.in", "/api/voice/text")).status).toBe(200);
  });

  it("still gates device management, which is dashboard-only", () => {
    const res = proxy(req("openai.kerai.in", "/api/android-agent/devices"));
    expect(res.status).toBe(401);
  });
});
