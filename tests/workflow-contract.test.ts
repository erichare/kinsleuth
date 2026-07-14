import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import packageJson from "../package.json";

async function workflow(name: string): Promise<string> {
  return readFile(path.join(process.cwd(), ".github", "workflows", name), "utf8");
}

const databaseImage =
  "pgvector/pgvector:0.8.1-pg16@sha256:33198da2828a14c30348d2ccb4750833d5ed9a44c88d840a0e523d7417120337";

describe("product CI workflow contract", () => {
  it("runs for every product pull request and main push with an immutable database service", async () => {
    const contents = await workflow("ci.yml");

    expect(contents).toMatch(/pull_request:/);
    expect(contents).toMatch(/push:\s*\n\s*branches:\s*\[main\]/);
    expect(contents).not.toMatch(/^\s*paths:/m);
    expect(contents).not.toMatch(/^\s*paths-ignore:/m);
    expect(contents).not.toMatch(/continue-on-error/);
    expect(contents.match(new RegExp(databaseImage, "g"))).toHaveLength(3);
  });

  it("exposes every release signal and one fail-closed aggregate gate", async () => {
    const contents = await workflow("ci.yml");

    for (const job of ["static", "database", "release-upgrade", "large-import", "release-contract"]) {
      expect(contents, job).toMatch(new RegExp(`^  ${job}:`, "m"));
    }
    expect(contents).toMatch(/^  gate:/m);
    expect(contents).toMatch(/if:\s*always\(\)/);
    expect(contents).toMatch(/STATIC_RESULT.*DATABASE_RESULT.*UPGRADE_RESULT.*LARGE_IMPORT_RESULT.*RELEASE_CONTRACT_RESULT/s);
    expect(contents).toMatch(/test\s+"\$STATIC_RESULT"\s+=\s+"success"/);
    for (const result of [
      "DATABASE_RESULT",
      "UPGRADE_RESULT",
      "LARGE_IMPORT_RESULT",
      "RELEASE_CONTRACT_RESULT"
    ]) {
      expect(contents, result).toMatch(new RegExp(`test\\s+"\\$${result}"\\s+=\\s+"success"`));
    }
  });

  it("keeps package database commands exhaustive and explicit", () => {
    expect(packageJson.scripts["test:db"]).not.toMatch(/tests\//);
    expect(packageJson.scripts["test:db"]).toContain("vitest run");
    expect(packageJson.scripts["test:db"]).toContain("--no-file-parallelism");
    expect(packageJson.scripts["test:release-upgrade"]).toContain("require-release-upgrade-database.mjs");
    expect(packageJson.scripts["test:db:large"]).toContain("require-test-database.mjs");
    expect(packageJson.scripts["test:db:large"]).toContain("RUN_LARGE_GEDCOM_TEST=true");
  });
});

describe("stable release workflow contract", () => {
  it("proves release provenance before running tag-controlled code or exposing secrets", async () => {
    const contents = await workflow("vercel-release.yml");
    const provenance = contents.indexOf("Verify release provenance before running repository code");

    expect(provenance).toBeGreaterThan(0);
    expect(provenance).toBeLessThan(contents.indexOf("npm ci"));
    expect(provenance).toBeLessThan(contents.indexOf("vercel@56.1.0 pull"));
    expect(contents).toContain("refs/tags/${RELEASE_TAG}^{commit}");
    expect(contents).toContain("HEAD^{commit}");
    expect(contents).toContain("git merge-base --is-ancestor");
  });

  it("validates actual production values and the released revision", async () => {
    const contents = await workflow("vercel-release.yml");

    expect(contents).toContain("scripts/validate-release-contract.mjs");
    expect(contents).toContain(".vercel/.env.production.local");
    expect(contents).toMatch(/fetch-depth:\s*0/);
    expect(contents).toMatch(/origin\/main/);
    expect(contents.indexOf("vercel@56.1.0 pull")).toBeLessThan(
      contents.indexOf("scripts/validate-release-contract.mjs")
    );
    expect(contents.indexOf("scripts/validate-release-contract.mjs")).toBeLessThan(
      contents.indexOf("vercel@56.1.0 build")
    );
    expect(contents).toContain("TEST_RELEASE_UPGRADE_DATABASE_URL");
  });

  it("uses environment authentication and smokes the deployment it created", async () => {
    const contents = await workflow("vercel-release.yml");
    const jobConfiguration = contents.slice(0, contents.indexOf("    steps:"));

    expect(contents).not.toContain("--token");
    expect(jobConfiguration).not.toContain("VERCEL_TOKEN");
    expect(contents).toContain("VERCEL_TOKEN: ${{ secrets.VERCEL_TOKEN }}");
    expect(contents).not.toContain("KINSLEUTH_APP_PASSWORD");
    expect(contents).not.toContain("kinsleuth.vercel.app");
    expect(contents).not.toMatch(/^\s*PRODUCTION_URL:/m);
    expect(contents).toContain("steps.deploy.outputs.url");
    expect(contents).toContain(databaseImage);
    expect(contents).toContain("scripts/validate-deployment-redirect.mjs");
  });
});
