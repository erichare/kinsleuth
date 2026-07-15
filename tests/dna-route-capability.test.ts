import { beforeEach, describe, expect, it, vi } from "vitest";

const workspaceMocks = vi.hoisted(() => ({
  deleteDnaMatch: vi.fn(),
  updateDnaMatch: vi.fn()
}));
const authMocks = vi.hoisted(() => ({
  getSessionContext: vi.fn()
}));

vi.mock("@/lib/workspace-store", () => workspaceMocks);
vi.mock("@/lib/auth-session", () => authMocks);

import { DELETE } from "@/app/api/dna/[id]/route";

const ownerSession = {
  userId: "owner-private-beta",
  email: "owner@example.test",
  name: "Owner",
  role: "owner" as const,
  archiveId: "archive-private-beta"
};

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
  authMocks.getSessionContext.mockResolvedValue(ownerSession);
  stubHostedPrivateBeta();
});

describe("DNA route capability boundary", () => {
  it("blocks direct DNA deletion before the store when DNA is disabled", async () => {
    const response = await DELETE(
      new Request("https://app.kinresolve.com/api/dna/dna-legacy", { method: "DELETE" }),
      { params: Promise.resolve({ id: "dna-legacy" }) }
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Not found" });
    expect(workspaceMocks.deleteDnaMatch).not.toHaveBeenCalled();
  });

  it("preserves DNA deletion for self-hosted deployments", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("KINRESOLVE_DEPLOYMENT_MODE", "self-hosted");
    vi.stubEnv("KINRESOLVE_DATASET_MODE", "demo");
    workspaceMocks.deleteDnaMatch.mockResolvedValue({ deleted: "dna-self-hosted" });

    const response = await DELETE(
      new Request("https://self-hosted.example/api/dna/dna-self-hosted", { method: "DELETE" }),
      { params: Promise.resolve({ id: "dna-self-hosted" }) }
    );

    expect(response.status).toBe(200);
    expect(workspaceMocks.deleteDnaMatch).toHaveBeenCalledWith("dna-self-hosted");
  });
});

function stubHostedPrivateBeta(): void {
  const environment = {
    KINRESOLVE_DEPLOYMENT_MODE: "hosted",
    KINRESOLVE_DATASET_MODE: "pilot",
    KINRESOLVE_DNA_ENABLED: "false",
    KINRESOLVE_EXTERNAL_AI_ENABLED: "false",
    KINRESOLVE_PUBLIC_ARCHIVE_ENABLED: "false",
    KINRESOLVE_PUBLIC_PUBLISHING_ENABLED: "false",
    KINRESOLVE_EVIDENCE_BINARY_UPLOADS_ENABLED: "false",
    KINRESOLVE_PACKAGE_MEDIA_ENABLED: "false",
    KINRESOLVE_PLAIN_GEDCOM_ENABLED: "true"
  } as const;
  for (const [name, value] of Object.entries(environment)) {
    vi.stubEnv(name, value);
  }
}
