import { describe, expect, it, vi } from "vitest";

import { runPublicDemoMonitor } from "@/scripts/public-demo-monitor.mjs";

const canonicalEnvironment = {
  PUBLIC_DEMO_ORIGIN: "https://demo.kinresolve.com"
};

describe("public demo monitor", () => {
  it("checks the landing, JSON health, and family body contracts without credentials", async () => {
    const fetchImplementation = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) =>
      shallowResponse(input)
    );

    await expect(runPublicDemoMonitor(
      "shallow",
      canonicalEnvironment,
      fetchImplementation
    )).resolves.toEqual({ mode: "shallow", shallowProbeCount: 3 });

    expect(fetchImplementation.mock.calls.map(([input]) => new URL(String(input)).pathname)).toEqual([
      "/",
      "/api/health",
      "/family"
    ]);
    for (const [, init] of fetchImplementation.mock.calls) {
      expect(init).toMatchObject({ cache: "no-store", redirect: "manual" });
    }
  });

  it("proves two fixed-input sessions stay isolated through a reset and stale request", async () => {
    const requests: Array<{ pathname: string; init?: RequestInit }> = [];
    let starts = 0;
    const fetchImplementation = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const pathname = new URL(String(input)).pathname;
      requests.push({ pathname, init });
      const cookie = new Headers(init?.headers).get("cookie");
      if (init?.method !== "POST") {
        if (pathname === "/api/demo/session") {
          const outcome = cookie?.includes("b".repeat(43)) ? "inconclusive" : "found";
          return jsonResponse({ progress: { guidedOutcome: outcome } });
        }
        return shallowResponse(input);
      }
      if (pathname === "/api/demo/sessions") {
        starts += 1;
        const token = starts === 1 ? "a".repeat(43) : "b".repeat(43);
        return jsonResponse(
          { workspaceUrl: "/app/cases/case-mercer-march-identity?guide=1" },
          { "set-cookie": `__Host-kinresolve-demo=${token}; Path=/; Secure; HttpOnly; SameSite=Lax` },
          201
        );
      }
      if (pathname === "/api/demo/cases/case-mercer-march-identity/guide") {
        if (cookie?.includes("a".repeat(43)) && starts > 2) {
          return jsonResponse({ error: "Demo session required" }, {}, 401);
        }
        return jsonResponse({ completed: true });
      }
      if (pathname === "/api/demo/session/reset") {
        starts += 1;
        return jsonResponse(
          { workspaceUrl: "/app/cases/case-mercer-march-identity?guide=1" },
          { "set-cookie": `__Host-kinresolve-demo=${"c".repeat(43)}; Path=/; Secure; HttpOnly; SameSite=Lax` }
        );
      }
      if (pathname === "/api/demo/session/end") return new Response(null, { status: 204 });
      return new Response(null, { status: 404 });
    });

    await expect(runPublicDemoMonitor("full", {
      ...canonicalEnvironment,
      KINRESOLVE_DEMO_CANARY_SECRET: "c".repeat(43)
    }, fetchImplementation)).resolves.toEqual({ mode: "full", shallowProbeCount: 3 });

    expect(requests.map(({ pathname }) => pathname)).toEqual([
      "/",
      "/api/health",
      "/family",
      "/api/demo/sessions",
      "/api/demo/sessions",
      "/api/demo/cases/case-mercer-march-identity/guide",
      "/api/demo/cases/case-mercer-march-identity/guide",
      "/api/demo/session",
      "/api/demo/session",
      "/api/demo/session/reset",
      "/api/demo/cases/case-mercer-march-identity/guide",
      "/api/demo/session",
      "/api/demo/session/end",
      "/api/demo/session/end"
    ]);
    const start = requests[3]?.init;
    const secondStart = requests[4]?.init;
    const firstGuide = requests[5]?.init;
    const secondGuide = requests[6]?.init;
    const staleGuide = requests[10]?.init;
    const firstEnded = requests[12]?.init;
    const secondEnded = requests[13]?.init;
    expect(start?.body).toBe(JSON.stringify({
      noticeVersion: "public-demo-2026-07-16"
    }));
    expect(secondStart?.body).toBe(start?.body);
    expect(firstGuide?.body).toBe(JSON.stringify({
      command: "record_outcome",
      outcome: "found"
    }));
    expect(secondGuide?.body).toBe(JSON.stringify({
      command: "record_outcome",
      outcome: "inconclusive"
    }));
    expect(new Headers(firstGuide?.headers).get("cookie")).toBe(
      `__Host-kinresolve-demo=${"a".repeat(43)}`
    );
    expect(new Headers(secondGuide?.headers).get("cookie")).toBe(
      `__Host-kinresolve-demo=${"b".repeat(43)}`
    );
    expect(new Headers(staleGuide?.headers).get("cookie")).toBe(
      `__Host-kinresolve-demo=${"a".repeat(43)}`
    );
    expect(new Headers(firstEnded?.headers).get("cookie")).toBe(
      `__Host-kinresolve-demo=${"c".repeat(43)}`
    );
    expect(new Headers(secondEnded?.headers).get("cookie")).toBe(
      `__Host-kinresolve-demo=${"b".repeat(43)}`
    );
  });

  it("still ends the disposable session when the guided command fails", async () => {
    const paths: string[] = [];
    const fetchImplementation = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const pathname = new URL(String(input)).pathname;
      paths.push(pathname);
      if (init?.method !== "POST") return shallowResponse(input);
      if (pathname === "/api/demo/sessions") {
        return jsonResponse(
          { workspaceUrl: "/app/cases/case-mercer-march-identity?guide=1" },
          { "set-cookie": `__Host-kinresolve-demo=${"b".repeat(43)}; Path=/; Secure; HttpOnly` },
          201
        );
      }
      if (pathname === "/api/demo/session/end") return new Response(null, { status: 204 });
      return jsonResponse({ error: "contained" }, {}, 500);
    });

    await expect(runPublicDemoMonitor("full", {
      ...canonicalEnvironment,
      KINRESOLVE_DEMO_CANARY_SECRET: "c".repeat(43)
    }, fetchImplementation)).rejects.toThrow(/status contract/i);
    expect(paths.at(-1)).toBe("/api/demo/session/end");
  });

  it("allows a protected generated candidate only with a bypass credential", async () => {
    const fetchImplementation = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) =>
      shallowResponse(input)
    );
    await expect(runPublicDemoMonitor("shallow", {
      PUBLIC_DEMO_ORIGIN: "https://candidate-team.vercel.app"
    }, fetchImplementation)).rejects.toThrow(/approved demo origin/i);

    await expect(runPublicDemoMonitor("shallow", {
      PUBLIC_DEMO_ORIGIN: "https://candidate-team.vercel.app",
      VERCEL_AUTOMATION_BYPASS_SECRET: "v".repeat(43)
    }, fetchImplementation)).resolves.toMatchObject({ mode: "shallow" });
    for (const [input, init] of fetchImplementation.mock.calls.slice(-3)) {
      expect(new URL(String(input)).origin).toBe("https://candidate-team.vercel.app");
      const headers = new Headers(init?.headers);
      expect(headers.get("origin")).toBe("https://demo.kinresolve.com");
      expect(headers.get("x-vercel-protection-bypass")).toBe("v".repeat(43));
    }
  });

  it("fails when a successful response serves the wrong body", async () => {
    const fetchImplementation = vi.fn(async () => new Response("generic page", {
      headers: { "content-type": "text/html" },
      status: 200
    }));
    await expect(runPublicDemoMonitor(
      "shallow",
      canonicalEnvironment,
      fetchImplementation
    )).rejects.toThrow(/body contract/i);
  });
});

function shallowResponse(input: RequestInfo | URL): Response {
  const pathname = new URL(String(input)).pathname;
  if (pathname === "/") return htmlResponse("<h1>Start guided demo</h1>");
  if (pathname === "/family") return htmlResponse("<h1>Hartwell–Mercer Family Archive</h1>");
  if (pathname === "/api/health") return jsonResponse({ status: "ok" });
  return new Response(null, { status: 404 });
}

function htmlResponse(body: string): Response {
  return new Response(body, { headers: { "content-type": "text/html; charset=utf-8" }, status: 200 });
}

function jsonResponse(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
  status = 200
): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
    status
  });
}
