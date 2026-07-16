import { pathToFileURL } from "node:url";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

type Check = (
  environment?: Readonly<Record<string, string | undefined>>,
  fetchImplementation?: typeof fetch
) => Promise<Readonly<{ workflowId: string; state: "disabled_manually" }>>;

const opaqueToken = "ghs_opaque.token-with-punctuation_xxxxxxxxx";

const environment = {
  GH_TOKEN: opaqueToken,
  GITHUB_API_URL: "https://api.github.com",
  GITHUB_REPOSITORY: "kinresolve/kinresolve",
  KINRESOLVE_STAGING_DEMO_WORKFLOW_ID: "12345678"
};

describe("legacy staging demo retirement preflight", () => {
  it("requires the exact workflow to be manually disabled with no active runs", async () => {
    const check = await loadCheck();
    const fetchImplementation = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/actions/workflows/12345678")) {
        return json({
          id: 12345678,
          name: "Operate Kin Resolve synthetic staging demo session",
          path: ".github/workflows/staging-demo-session.yml",
          state: "disabled_manually"
        });
      }
      return json({ total_count: 0, workflow_runs: [] });
    });

    await expect(check(environment, fetchImplementation)).resolves.toEqual({
      workflowId: "12345678",
      state: "disabled_manually"
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(6);
    for (const [, init] of fetchImplementation.mock.calls) {
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${opaqueToken}`);
    }
  });

  it("rejects whitespace-bearing tokens before making a request", async () => {
    const check = await loadCheck();
    const fetchImplementation = vi.fn<typeof fetch>();

    await expect(check({
      ...environment,
      GH_TOKEN: "ghs_invalid token_with_enough_length"
    }, fetchImplementation)).rejects.toThrow(/retirement/i);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("fails closed for the wrong workflow, enabled state, or any active run", async () => {
    const check = await loadCheck();
    const response = (workflow: Record<string, unknown>, active = false) => vi.fn(
      async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/actions/workflows/12345678")) return json(workflow);
        return json(active
          ? { total_count: 1, workflow_runs: [{ id: 9, status: "queued" }] }
          : { total_count: 0, workflow_runs: [] });
      }
    );

    await expect(check(environment, response({
      id: 12345678,
      name: "Wrong workflow",
      path: ".github/workflows/staging-demo-session.yml",
      state: "disabled_manually"
    }))).rejects.toThrow(/retirement/i);
    await expect(check(environment, response({
      id: 12345678,
      name: "Operate Kin Resolve synthetic staging demo session",
      path: ".github/workflows/staging-demo-session.yml",
      state: "active"
    }))).rejects.toThrow(/retirement/i);
    await expect(check(environment, response({
      id: 12345678,
      name: "Operate Kin Resolve synthetic staging demo session",
      path: ".github/workflows/staging-demo-session.yml",
      state: "disabled_manually"
    }, true))).rejects.toThrow(/active/i);
  });
});

async function loadCheck(): Promise<Check> {
  const moduleUrl = pathToFileURL(path.join(
    process.cwd(),
    "scripts/validate-legacy-demo-retirement.mjs"
  )).href;
  const loaded = await import(moduleUrl) as { validateLegacyDemoRetirement?: Check };
  if (typeof loaded.validateLegacyDemoRetirement !== "function") {
    throw new Error("The legacy demo retirement preflight is unavailable.");
  }
  return loaded.validateLegacyDemoRetirement;
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status
  });
}
