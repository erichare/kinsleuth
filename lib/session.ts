// Session issuance and verification moved to better-auth (lib/auth.ts); this
// module keeps the redirect-safety helper shared by the login flow.

// Only allow same-origin absolute paths. A second "/" or "\" would make the
// browser treat the value as protocol-relative (it normalizes "\" to "/"),
// turning the login redirect into an open redirect.
export function safeInternalPath(next: string | undefined, fallback = "/app"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return fallback;
  }
  return next;
}
