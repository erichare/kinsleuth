import { describe, expect, it, vi } from "vitest";

import { probeVercelCandidateProtection } from "@/lib/vercel-candidate-protection-probe";

const deployment = {
  id: "dpl_candidate1234567890abcdef",
  url: "kinresolve-candidate-a1b2c3-team.vercel.app",
  readyState: "READY",
  target: "production",
  projectId: "prj_kinresolve",
  ownerId: "team_kinresolve",
  aliases: ["kinresolve-git-main-team.vercel.app"],
  meta: {}
};

describe("generated candidate protection probe", () => {
  it("proves unauthenticated denial on the primary URL and every generated alias", async () => {
    const fetchImplementation = vi.fn(async (_url: RequestInfo | URL) => (
      new Response("denied", { status: 401 })
    ));
    await expect(probeVercelCandidateProtection(deployment, {
      expectedProjectId: "prj_kinresolve",
      expectedOrgId: "team_kinresolve",
      fetch: fetchImplementation
    })).resolves.toEqual({ protectedOriginCount: 2 });
    expect(fetchImplementation.mock.calls.map(([url]) => String(url))).toEqual([
      "https://kinresolve-candidate-a1b2c3-team.vercel.app/api/health",
      "https://kinresolve-git-main-team.vercel.app/api/health"
    ]);
  });

  it("refuses to probe a candidate until Vercel reports runtime readiness", async () => {
    const fetchImplementation = vi.fn(async () => new Response("denied", { status: 401 }));

    await expect(probeVercelCandidateProtection({
      ...deployment,
      readyState: "INITIALIZING",
      readySubstate: "STAGED",
      errorCode: null,
      errorMessage: null
    }, {
      expectedProjectId: "prj_kinresolve",
      expectedOrgId: "team_kinresolve",
      fetch: fetchImplementation
    })).rejects.toThrow(/READY/i);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("fails closed when any alias is public or a custom alias is attached", async () => {
    const fetchImplementation = vi.fn(async (url: RequestInfo | URL) => new Response(
      String(url).includes("git-main") ? JSON.stringify({ database: "reachable" }) : "denied",
      {
        status: String(url).includes("git-main") ? 200 : 401,
        headers: { "content-type": "application/json" }
      }
    ));
    await expect(probeVercelCandidateProtection(deployment, {
      expectedProjectId: "prj_kinresolve",
      expectedOrgId: "team_kinresolve",
      fetch: fetchImplementation
    })).rejects.toThrow(/protection|unauthenticated|deny/i);
    await expect(probeVercelCandidateProtection({
      ...deployment,
      aliases: ["public-demo.example.com"]
    }, {
      expectedProjectId: "prj_kinresolve",
      expectedOrgId: "team_kinresolve",
      fetch: fetchImplementation
    })).rejects.toThrow(/alias|generated|deployment/i);
  });
});
