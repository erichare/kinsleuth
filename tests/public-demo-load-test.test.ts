import { describe, expect, it, vi } from "vitest";

import {
  runPublicDemoLoadTest,
  safePublicDemoLoadFailure
} from "@/scripts/public-demo-load-test.mjs";

const environment = {
  PUBLIC_DEMO_ORIGIN: "https://kinresolve-demo-candidate.vercel.app",
  KINRESOLVE_DEMO_CANARY_SECRET: "c".repeat(43),
  VERCEL_AUTOMATION_BYPASS_SECRET: "v".repeat(43)
};

describe("public demo 25-session load gate", () => {
  it("proves unique simultaneous sessions and always ends all 25", async () => {
    let starts = 0;
    let ends = 0;
    const fetchImplementation = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const headers = new Headers(init?.headers);
      expect(headers.get("x-kinresolve-demo-canary")).toBe("c".repeat(43));
      expect(headers.get("x-vercel-protection-bypass")).toBe("v".repeat(43));
      expect(headers.has("x-forwarded-for")).toBe(false);
      if (init?.method === "POST" && url.pathname === "/api/demo/sessions") {
        starts += 1;
        if (starts === 26) {
          return jsonResponse({
            error: "The public demo is at capacity. Please try again shortly.",
            maximumActiveSessions: 25,
            familyUrl: "/family",
            challengeUrl: "/challenge"
          }, 429, { "retry-after": "300" });
        }
        return jsonResponse(
          { workspaceUrl: "/app/cases/case-mercer-march-identity?guide=1" },
          201,
          { "set-cookie": `__Host-kinresolve-demo=${token(starts)}; Path=/; Secure; HttpOnly` }
        );
      }
      if (init?.method === "POST" && url.pathname === "/api/demo/session/end") {
        ends += 1;
        return jsonResponse({ ended: true });
      }
      if (url.pathname === "/api/demo/session") {
        return jsonResponse({ session: { status: "active" } });
      }
      if (`${url.pathname}${url.search}` === "/app/cases/case-mercer-march-identity?guide=1") {
        return new Response("<h2>Do these signatures point to the same fictional person?</h2>", {
          headers: { "content-type": "text/html" },
          status: 200
        });
      }
      return new Response(null, { status: 404 });
    });

    await expect(runPublicDemoLoadTest(environment, fetchImplementation)).resolves.toMatchObject({
      sessionCount: 25,
      p95Milliseconds: expect.any(Number)
    });
    expect(starts).toBe(26);
    expect(ends).toBe(25);
  });

  it("ends every successfully created session after a partial start failure", async () => {
    let starts = 0;
    let ends = 0;
    const fetchImplementation = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (init?.method === "POST" && url.pathname === "/api/demo/sessions") {
        starts += 1;
        if (starts === 25) return jsonResponse({ error: "capacity" }, 429);
        return jsonResponse({}, 201, {
          "set-cookie": `__Host-kinresolve-demo=${token(starts)}; Path=/; Secure; HttpOnly`
        });
      }
      if (init?.method === "POST" && url.pathname === "/api/demo/session/end") {
        ends += 1;
        return jsonResponse({ ended: true });
      }
      return new Response(null, { status: 404 });
    });

    const failure = await rejectedValue(runPublicDemoLoadTest(environment, fetchImplementation));
    expect(failure).toBeInstanceOf(Error);
    expect(safePublicDemoLoadFailure(failure)).toBe(
      "Public demo 25-session load gate failed. stage=start-response status=429 "
      + "attempted=25 succeeded=24 failed=1 cleanupFailed=0"
    );
    expect(ends).toBe(24);
  });

  it("refuses canonical or unprotected origins for the disruptive load gate", async () => {
    const canonicalFailure = await rejectedValue(runPublicDemoLoadTest({
      ...environment,
      PUBLIC_DEMO_ORIGIN: "https://demo.kinresolve.com"
    }, vi.fn()));
    const credentialFailure = await rejectedValue(runPublicDemoLoadTest({
      ...environment,
      VERCEL_AUTOMATION_BYPASS_SECRET: ""
    }, vi.fn()));

    expect(safePublicDemoLoadFailure(canonicalFailure)).toBe(
      "Public demo 25-session load gate failed. stage=configuration"
    );
    expect(safePublicDemoLoadFailure(credentialFailure)).toBe(
      "Public demo 25-session load gate failed. stage=configuration"
    );
  });

  it.each([
    [{ capacityStatus: 200 }, "capacity-response status=200 cleanupFailed=0"],
    [{ sessionStatus: 503 }, "session-read-response status=503 attempted=50 succeeded=25 failed=25 cleanupFailed=0"],
    [{ guidedStatus: 503 }, "guided-read-response status=503 attempted=50 succeeded=25 failed=25 cleanupFailed=0"],
    [{ cleanupFailures: 1 }, "cleanup attempted=25 succeeded=24 failed=1 cleanupFailed=1"]
  ] as const)("reports a fixed safe sub-stage for %j", async (options, expected) => {
    const { fetchImplementation } = createLoadFetch(options);
    const failure = await rejectedValue(runPublicDemoLoadTest(environment, fetchImplementation));

    expect(safePublicDemoLoadFailure(failure)).toBe(
      `Public demo 25-session load gate failed. stage=${expected}`
    );
  });

  it("preserves the primary failure when cleanup also fails", async () => {
    const { fetchImplementation } = createLoadFetch({
      cleanupFailures: 1,
      startFailureAt: 25
    });
    const failure = await rejectedValue(runPublicDemoLoadTest(environment, fetchImplementation));

    expect(safePublicDemoLoadFailure(failure)).toBe(
      "Public demo 25-session load gate failed. stage=start-response status=429 "
      + "attempted=25 succeeded=24 failed=1 cleanupFailed=1"
    );
  });

  it("never formats arbitrary error content or unsafe diagnostic properties", () => {
    const sentinels = [
      "https://private-candidate.vercel.app",
      "super-secret-credential",
      "__Host-kinresolve-demo=raw-cookie",
      "203.0.113.42",
      "visitor response body",
      "visitor prompt"
    ];
    const failure = Object.assign(new Error(sentinels.join(" ")), {
      cause: sentinels[1],
      stack: sentinels[2],
      origin: sentinels[0],
      cookie: sentinels[2],
      body: sentinels[4],
      prompt: sentinels[5]
    });

    const diagnostic = safePublicDemoLoadFailure(failure);
    expect(diagnostic).toBe("Public demo 25-session load gate failed. stage=unknown");
    for (const sentinel of sentinels) expect(diagnostic).not.toContain(sentinel);
  });

  it("reads each allowlisted property once and fails closed on hostile getters", () => {
    let stageReads = 0;
    const statefulStage = Object.defineProperty({}, "stage", {
      get() {
        stageReads += 1;
        return stageReads === 1 ? "cleanup" : "super-secret-credential\nforged=true";
      }
    });
    const throwingProperties = new Proxy({}, {
      get() {
        throw new Error("super-secret-credential");
      }
    });

    expect(safePublicDemoLoadFailure(statefulStage)).toBe(
      "Public demo 25-session load gate failed. stage=cleanup"
    );
    expect(stageReads).toBe(1);
    expect(safePublicDemoLoadFailure(throwingProperties)).toBe(
      "Public demo 25-session load gate failed. stage=unknown"
    );
  });
});

type LoadFetchOptions = Readonly<{
  capacityStatus?: number;
  cleanupFailures?: number;
  guidedStatus?: number;
  sessionStatus?: number;
  startFailureAt?: number;
}>;

function createLoadFetch(options: LoadFetchOptions = {}) {
  let starts = 0;
  let ends = 0;
  const fetchImplementation = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (init?.method === "POST" && url.pathname === "/api/demo/sessions") {
      starts += 1;
      if (starts === options.startFailureAt) return jsonResponse({ error: "capacity" }, 429);
      if (starts === 26) {
        const status = options.capacityStatus ?? 429;
        return jsonResponse({
          error: "The public demo is at capacity. Please try again shortly.",
          maximumActiveSessions: 25,
          familyUrl: "/family",
          challengeUrl: "/challenge"
        }, status, status === 429 ? { "retry-after": "300" } : {});
      }
      return jsonResponse(
        { workspaceUrl: "/app/cases/case-mercer-march-identity?guide=1" },
        201,
        { "set-cookie": `__Host-kinresolve-demo=${token(starts)}; Path=/; Secure; HttpOnly` }
      );
    }
    if (init?.method === "POST" && url.pathname === "/api/demo/session/end") {
      ends += 1;
      return jsonResponse({ ended: true }, ends <= (options.cleanupFailures ?? 0) ? 503 : 200);
    }
    if (url.pathname === "/api/demo/session") {
      return jsonResponse({ session: { status: "active" } }, options.sessionStatus ?? 200);
    }
    if (`${url.pathname}${url.search}` === "/app/cases/case-mercer-march-identity?guide=1") {
      return new Response("<h2>Do these signatures point to the same fictional person?</h2>", {
        headers: { "content-type": "text/html" },
        status: options.guidedStatus ?? 200
      });
    }
    return new Response(null, { status: 404 });
  });
  return { fetchImplementation };
}

async function rejectedValue(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("Expected the public demo load test to reject.");
}

function token(index: number): string {
  return `${String(index).padStart(2, "0")}${"x".repeat(41)}`;
}

function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json", ...headers },
    status
  });
}
