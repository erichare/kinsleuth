import path from "node:path";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

type Readiness = (
  environment?: Readonly<Record<string, string | undefined>>,
  fetchImplementation?: typeof fetch
) => Promise<Readonly<{ runId: number; runAttempt: number; gate: "success" }>>;

const sha = "a".repeat(40);
const token = "ghs_opaque.token-with-punctuation_xxxxxxxxx";
const environment = {
  GH_TOKEN: token,
  GITHUB_API_URL: "https://api.github.com",
  GITHUB_REPOSITORY: "kinresolve/kinresolve",
  PRODUCT_CI_WORKFLOW_ID: "7654321",
  RELEASE_COMMIT: sha
};

describe("public demo GitHub release readiness", () => {
  it("gates the protected release before demo credentials are available", () => {
    const workflow = readFileSync(path.join(
      process.cwd(),
      ".github/workflows/public-demo-release.yml"
    ), "utf8");
    const gate = workflow.indexOf("scripts/public-demo-github-readiness.mjs");
    const releaseJob = workflow.indexOf("\n  release:");

    expect(workflow).toContain("security-events: read");
    expect(workflow).toContain("PRODUCT_CI_WORKFLOW_ID: ${{ vars.PRODUCT_CI_WORKFLOW_ID }}");
    expect(workflow).toContain("RELEASE_COMMIT: ${{ inputs.release_commit }}");
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(releaseJob);
  });

  it("requires the exact successful main CI gate and zero open high or critical code alerts", async () => {
    const validate = await loadValidator();
    const fetchImplementation = responses();

    await expect(validate(environment, fetchImplementation)).resolves.toEqual({
      runId: 44,
      runAttempt: 2,
      gate: "success"
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(5);
    const urls = fetchImplementation.mock.calls.map(([input]) => String(input));
    expect(urls).toContain(
      "https://api.github.com/repos/kinresolve/kinresolve/actions/workflows/7654321"
    );
    expect(urls.some((url) => url.includes(`head_sha=${sha}`))).toBe(true);
    expect(urls).toContain(
      "https://api.github.com/repos/kinresolve/kinresolve/actions/runs/44/attempts/2/jobs?per_page=100"
    );
    expect(urls.some((url) => url.includes("severity=high"))).toBe(true);
    expect(urls.some((url) => url.includes("severity=critical"))).toBe(true);
    for (const [, init] of fetchImplementation.mock.calls) {
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${token}`);
    }
  });

  it("fails closed for the wrong workflow, missing gate, or an open security alert", async () => {
    const validate = await loadValidator();

    await expect(validate(environment, responses({ workflowName: "Wrong CI" })))
      .rejects.toThrow(/readiness/i);
    await expect(validate(environment, responses({ gateConclusion: "failure" })))
      .rejects.toThrow(/readiness/i);
    await expect(validate(environment, responses({ alerts: [{ number: 9 }] })))
      .rejects.toThrow(/security alert/i);
  });

  it("rejects whitespace-bearing tokens before making a request", async () => {
    const validate = await loadValidator();
    const fetchImplementation = vi.fn<typeof fetch>();

    await expect(validate({
      ...environment,
      GH_TOKEN: "ghs_invalid token_with_enough_length"
    }, fetchImplementation)).rejects.toThrow(/readiness/i);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});

async function loadValidator(): Promise<Readiness> {
  const loaded = await import(pathToFileURL(path.join(
    process.cwd(),
    "scripts/public-demo-github-readiness.mjs"
  )).href) as { validatePublicDemoGithubReadiness?: Readiness };
  if (typeof loaded.validatePublicDemoGithubReadiness !== "function") {
    throw new Error("The public demo GitHub readiness validator is unavailable.");
  }
  return loaded.validatePublicDemoGithubReadiness;
}

function responses(options: {
  workflowName?: string;
  gateConclusion?: string;
  alerts?: Array<Record<string, unknown>>;
} = {}) {
  return vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/actions/workflows/7654321")) {
      return json({
        id: 7654321,
        name: options.workflowName ?? "Product CI",
        path: ".github/workflows/ci.yml",
        state: "active"
      });
    }
    if (url.pathname.endsWith("/actions/workflows/7654321/runs")) {
      return json({
        total_count: 1,
        workflow_runs: [{
          id: 44,
          run_attempt: 2,
          workflow_id: 7654321,
          name: "Product CI",
          path: ".github/workflows/ci.yml",
          event: "push",
          head_branch: "main",
          head_sha: sha,
          status: "completed",
          conclusion: "success",
          head_repository: { full_name: "kinresolve/kinresolve" }
        }]
      });
    }
    if (url.pathname.endsWith("/actions/runs/44/attempts/2/jobs")) {
      return json({
        total_count: 1,
        jobs: [{
          id: 55,
          run_id: 44,
          run_attempt: 2,
          name: "Product release contract",
          head_sha: sha,
          status: "completed",
          conclusion: options.gateConclusion ?? "success"
        }]
      });
    }
    if (url.pathname.endsWith("/code-scanning/alerts")) {
      return json(options.alerts ?? []);
    }
    return json({}, 404);
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status
  });
}
