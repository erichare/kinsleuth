import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { getPool } from "./db";

// Session lifetime: 30 days hard expiry, refreshed at most once a day. The
// proxy validates sessions but cannot forward refresh Set-Cookie headers, so
// refreshes happen on route-handler traffic; sessions still hard-expire.
const sessionExpirySeconds = 60 * 60 * 24 * 30;
const sessionUpdateAgeSeconds = 60 * 60 * 24;

// Lazy singleton: getPool() requires DATABASE_URL, which is absent during
// `next build`, so the instance must not be constructed at module load.
function buildAuth() {
  return betterAuth({
    // better-auth wraps a node-postgres Pool in its own Kysely dialect.
    database: getPool(),
    secret: process.env.AUTH_SECRET,
    baseURL: process.env.APP_BASE_URL,
    emailAndPassword: {
      enabled: true,
      // Verification needs an outbound mail dependency self-hosters would have
      // to configure; deliberately deferred (see docs/auth.md phasing).
      requireEmailVerification: false,
      minPasswordLength: 10,
      maxPasswordLength: 128
    },
    session: {
      expiresIn: sessionExpirySeconds,
      updateAge: sessionUpdateAgeSeconds
    },
    // Better Auth skips origin validation by default in NODE_ENV=test.
    // Opt in explicitly so the same CSRF boundary is enforced and exercised
    // in every environment.
    advanced: {
      disableOriginCheck: false
    },
    // nextCookies must be last so Set-Cookie survives server-action calls.
    plugins: [nextCookies()]
  });
}

let instance: ReturnType<typeof buildAuth> | undefined;

export function getAuth(): ReturnType<typeof buildAuth> {
  if (!instance) {
    instance = buildAuth();
  }
  return instance;
}
