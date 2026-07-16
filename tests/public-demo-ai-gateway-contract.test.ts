import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { validatePublicDemoAiGatewayContract } from "@/lib/public-demo-ai-gateway-contract";

const apiKeyId = "A".repeat(44);
const teamId = `team_${"T".repeat(24)}`;
const expectations = { apiKeyId, monthlyBudgetUsd: 50, teamId } as const;
const scratchDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(scratchDirectories.splice(0).map((directory) => (
    rm(directory, { force: true, recursive: true })
  )));
});

describe("public demo AI Gateway key contract", () => {
  it("accepts only the active dedicated key with its exact $50 monthly hard budget", () => {
    expect(validatePublicDemoAiGatewayContract(metadata(), expectations)).toEqual({
      currentSpendUsd: 0,
      monthlyBudgetUsd: 50
    });
  });

  it.each([
    ["identity", { name: "another-key" }],
    ["purpose", { purpose: "generic" }],
    ["team", { teamId: "team_wrongteam1" }],
    ["project scope", { projectId: "prj_demo" }],
    ["expiry", { expiresAt: "2026-08-01T00:00:00.000Z" }],
    ["leak", { leakedAt: "2026-07-16T00:00:00.000Z" }]
  ])("rejects a mismatched key %s", (_label, override) => {
    expect(() => validatePublicDemoAiGatewayContract(metadata({ key: override }), expectations))
      .toThrow(/identity|safety/i);
  });

  it.each([
    ["limit", { limitAmount: 51 }],
    ["refresh", { refreshPeriod: "yearly" }],
    ["BYOK exclusion", { includeByokInQuota: true }],
    ["inactive", { active: false }],
    ["archived", { archived: true }]
  ])("rejects an invalid hard-budget %s state", (_label, override) => {
    expect(() => validatePublicDemoAiGatewayContract(metadata({ quota: override }), expectations))
      .toThrow(/hard-budget/i);
  });

  it.each([
    ["negative", { currentSpend: -1 }],
    ["exhausted", { currentSpend: 50 }],
    ["non-finite", { currentSpend: Number.POSITIVE_INFINITY }],
    ["uncapped BYOK", { currentByokSpend: 0.01 }]
  ])("rejects %s spend", (_label, override) => {
    expect(() => validatePublicDemoAiGatewayContract(metadata({ quota: override }), expectations))
      .toThrow(/spend state/i);
  });

  it("rejects missing, duplicate, and paginated key metadata", () => {
    expect(() => validatePublicDemoAiGatewayContract({
      apiKeys: [],
      pagination: { count: 0, next: null, prev: null }
    }, expectations)).toThrow(/exactly once/i);

    const duplicate = metadata();
    duplicate.apiKeys.push({ ...duplicate.apiKeys[0] });
    duplicate.pagination.count = 2;
    expect(() => validatePublicDemoAiGatewayContract(duplicate, expectations))
      .toThrow(/exactly once/i);

    expect(() => validatePublicDemoAiGatewayContract({
      ...metadata(),
      pagination: { count: 1, next: 123, prev: null }
    }, expectations)).toThrow(/complete|unpaginated/i);
  });

  it("validates the metadata file without printing partial keys or provider details", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "kinresolve-ai-gateway-"));
    scratchDirectories.push(directory);
    const metadataPath = path.join(directory, "keys.json");
    const marker = "partial-key-material-that-must-never-print";
    await writeFile(metadataPath, JSON.stringify(metadata({ key: { partialKey: marker } })), "utf8");

    const result = spawnSync(process.execPath, [
      "--experimental-strip-types",
      path.join(process.cwd(), "scripts", "validate-public-demo-ai-gateway-key.mjs"),
      metadataPath
    ], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        EXPECTED_AI_GATEWAY_API_KEY_ID: apiKeyId,
        EXPECTED_AI_GATEWAY_MONTHLY_BUDGET_USD: "50",
        EXPECTED_AI_GATEWAY_TEAM_ID: teamId
      }
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("$50 monthly hard budget");
    expect(`${result.stdout}${result.stderr}`).not.toContain(marker);
  });
});

type MetadataOverrides = Readonly<{
  key?: Record<string, unknown>;
  quota?: Record<string, unknown>;
}>;

function metadata(overrides: MetadataOverrides = {}) {
  return {
    apiKeys: [{
      id: apiKeyId,
      name: "kinresolve-demo-production",
      partialKey: "vck_redacted",
      purpose: "ai-gateway",
      teamId,
      projectId: null,
      expiresAt: null,
      leakedAt: null,
      leakedUrl: null,
      quota: {
        quotaEntityId: `api_key_id_${apiKeyId}`,
        limitAmount: 50,
        currentSpend: 0,
        currentByokSpend: 0,
        includeByokInQuota: false,
        refreshPeriod: "monthly",
        active: true,
        archived: false,
        ...overrides.quota
      },
      ...overrides.key
    }],
    pagination: { count: 1, next: null, prev: null }
  };
}
