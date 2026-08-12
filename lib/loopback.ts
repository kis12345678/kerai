/**
 * Whether a hostname is this machine's own loopback.
 *
 * Shared by the auth gate (proxy.ts — loopback is exempt from the password) and the sidebar
 * (shell.tsx — the Log out button only appears when reached remotely). Deliberately free of
 * node/server imports so it can be bundled into client components.
 */

/** Strips an optional ":port" suffix. Host headers arrive as "localhost:3000", "[::1]:3000",
 * or bare "openai.kerai.in" — never as URLs. A trailing ":digits" is a port; a bare IPv6
 * literal like "::1" has colons but no trailing digits, so it is left untouched. */
function hostnameOf(host: string): string {
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end === -1 ? host : host.slice(1, end);
  }
  const colon = host.indexOf(":");
  return colon !== -1 && /^\d+$/.test(host.slice(colon + 1)) ? host.slice(0, colon) : host;
}

export function isLoopbackHost(host: string): boolean {
  const h = hostnameOf(host).toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1" || h.endsWith(".localhost");
}
