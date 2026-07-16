import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  betaApplicationSensitiveEnvironmentName,
  forbiddenWorkflowOnlyEnvironmentNames,
  publicDemoReadableProductionEnvironmentNames,
  publicDemoSensitiveProductionEnvironmentNames,
  requiredReadableProductionEnvironmentNames,
  requiredSensitiveProductionEnvironmentNames,
  validatePulledVercelEnvironmentContract,
  validateVercelEnvironmentContract
} from "@/lib/vercel-environment-contract";

const scratchDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(scratchDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Vercel public demo environment metadata contract", () => {
  it("accepts exactly the production-only public demo runtime contract", () => {
    expect(validateVercelEnvironmentContract(publicDemoMetadata(), {
      profile: "public-demo"
    })).toEqual({
      readableSettings: publicDemoReadableProductionEnvironmentNames.length,
      sensitiveSettings: publicDemoSensitiveProductionEnvironmentNames.length
    });
  });

  it.each(publicDemoSensitiveProductionEnvironmentNames)(
    "requires public demo credential %s to be Sensitive",
    (key) => {
      expect(() => validateVercelEnvironmentContract(publicDemoMetadata({
        [key]: { type: "encrypted" }
      }), { profile: "public-demo" })).toThrow(new RegExp(`${key}.*sensitive`, "i"));
    }
  );

  it.each(publicDemoReadableProductionEnvironmentNames)(
    "keeps public demo setting %s readable for exact-value validation",
    (key) => {
      expect(() => validateVercelEnvironmentContract(publicDemoMetadata({
        [key]: { type: "sensitive" }
      }), { profile: "public-demo" })).toThrow(new RegExp(`${key}.*readable`, "i"));
    }
  );

  it("rejects missing, duplicate, non-production, and unexpected public demo settings", () => {
    const missing = publicDemoMetadata();
    missing.envs = missing.envs.filter((entry) => entry.key !== "AI_API_KEY");
    expect(() => validateVercelEnvironmentContract(missing, { profile: "public-demo" }))
      .toThrow(/missing.*AI_API_KEY/i);

    const duplicate = publicDemoMetadata();
    duplicate.envs.push({ ...duplicate.envs[0] });
    expect(() => validateVercelEnvironmentContract(duplicate, { profile: "public-demo" }))
      .toThrow(/duplicate/i);

    expect(() => validateVercelEnvironmentContract(publicDemoMetadata({
      CRON_SECRET: { target: ["production", "preview"] }
    }), { profile: "public-demo" })).toThrow(/CRON_SECRET.*production only/i);

    const unexpected = publicDemoMetadata() as { envs: Array<Record<string, unknown>> };
    unexpected.envs.push({ key: "RESEND_API_KEY", type: "sensitive", target: ["production"] });
    expect(() => validateVercelEnvironmentContract(unexpected, { profile: "public-demo" }))
      .toThrow(/unexpected setting RESEND_API_KEY/i);
  });

  it("validates public demo metadata without reading or printing Sensitive values", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "kinresolve-public-demo-vercel-env-"));
    scratchDirectories.push(directory);
    const metadataPath = path.join(directory, "metadata.json");
    const pulledEnvironmentPath = path.join(directory, "production.env");
    const marker = "sensitive-value-that-must-never-print";
    await writeFile(metadataPath, JSON.stringify(publicDemoMetadata({
      AI_API_KEY: { value: marker }
    })), "utf8");
    await writeFile(
      pulledEnvironmentPath,
      publicDemoReadableProductionEnvironmentNames.map((name) => `${name}=readable`).join("\n"),
      "utf8"
    );

    const result = spawnSync(process.execPath, [
      "--experimental-strip-types",
      path.join(process.cwd(), "scripts", "validate-vercel-environment.mjs"),
      metadataPath,
      pulledEnvironmentPath
    ], {
      encoding: "utf8",
      cwd: process.cwd(),
      env: { ...process.env, EXPECTED_VERCEL_ENVIRONMENT_PROFILE: "public-demo" }
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/verified.*readable.*sensitive/i);
    expect(`${result.stdout}${result.stderr}`).not.toContain(marker);
  });
});

describe("Vercel hosted environment metadata contract", () => {
  it("accepts production-only readable settings and unreadable Sensitive credentials", () => {
    expect(validateVercelEnvironmentContract(metadata())).toEqual({
      readableSettings: requiredReadableProductionEnvironmentNames.length,
      sensitiveSettings: requiredSensitiveProductionEnvironmentNames.length
    });
  });

  it.each(requiredSensitiveProductionEnvironmentNames)("requires %s to use the Sensitive type", (key) => {
    expect(() => validateVercelEnvironmentContract(metadata({ [key]: { type: "encrypted" } })))
      .toThrow(new RegExp(`${key}.*sensitive`, "i"));
  });

  it.each(requiredReadableProductionEnvironmentNames)("requires %s to remain readable", (key) => {
    expect(() => validateVercelEnvironmentContract(metadata({ [key]: { type: "sensitive" } })))
      .toThrow(new RegExp(`${key}.*readable`, "i"));
  });

  it("requires the application HMAC only for an independently enabled intake release", () => {
    expect(() => validateVercelEnvironmentContract(metadata(), {
      expectedBetaApplicationsEnabled: true
    })).toThrow(new RegExp(`missing.*${betaApplicationSensitiveEnvironmentName}`, "i"));

    const enabled = metadata({}, true);
    expect(validateVercelEnvironmentContract(enabled, {
      expectedBetaApplicationsEnabled: true
    })).toEqual({
      readableSettings: requiredReadableProductionEnvironmentNames.length,
      sensitiveSettings: requiredSensitiveProductionEnvironmentNames.length + 1
    });
    expect(() => validateVercelEnvironmentContract(metadata({
      [betaApplicationSensitiveEnvironmentName]: { type: "encrypted" }
    }, true), { expectedBetaApplicationsEnabled: true })).toThrow(
      new RegExp(`${betaApplicationSensitiveEnvironmentName}.*sensitive`, "i")
    );
  });

  it("allows app-off releases while protecting a pre-provisioned application HMAC", () => {
    expect(validateVercelEnvironmentContract(metadata())).toMatchObject({
      sensitiveSettings: requiredSensitiveProductionEnvironmentNames.length
    });
    expect(() => validateVercelEnvironmentContract(metadata({
      [betaApplicationSensitiveEnvironmentName]: { type: "encrypted" }
    }, true))).toThrow(new RegExp(`${betaApplicationSensitiveEnvironmentName}.*sensitive`, "i"));
    expect(validateVercelEnvironmentContract(metadata({}, true))).toMatchObject({
      sensitiveSettings: requiredSensitiveProductionEnvironmentNames.length + 1
    });
  });

  it.each(forbiddenWorkflowOnlyEnvironmentNames)(
    "rejects workflow-only %s from Vercel environment metadata",
    (key) => {
      const input = metadata() as { envs: Array<Record<string, unknown>> };
      input.envs.push({ key, type: "sensitive", target: ["production"] });
      expect(() => validateVercelEnvironmentContract(input)).toThrow(
        new RegExp(`forbidden workflow-only setting ${key}`, "i")
      );
    }
  );

  it.each(forbiddenWorkflowOnlyEnvironmentNames)(
    "rejects workflow-only %s from the pulled deployment environment",
    (key) => {
      expect(() => validatePulledVercelEnvironmentContract(`${key}=control-plane-secret\n`)).toThrow(
        new RegExp(`forbidden workflow-only setting ${key}`, "i")
      );
    }
  );

  it("allows the legitimate runtime credentials and parses multiline pulled values without exposing them", () => {
    const marker = "runtime-secret-that-must-not-print";
    const contents = [
      "# Pulled by Vercel CLI",
      ...requiredSensitiveProductionEnvironmentNames.map((name) => `${name}=${marker}`),
      "export MULTILINE_RUNTIME_VALUE=\"first line",
      "second line\" # comment",
      ""
    ].join("\n");

    expect(validatePulledVercelEnvironmentContract(contents)).toEqual({
      settings: requiredSensitiveProductionEnvironmentNames.length + 1
    });
  });

  it("fails closed on malformed or duplicate pulled environment assignments", () => {
    expect(() => validatePulledVercelEnvironmentContract("not an assignment\n")).toThrow(/could not be parsed/i);
    expect(() => validatePulledVercelEnvironmentContract("AUTH_SECRET=one\nAUTH_SECRET=two\n"))
      .toThrow(/duplicate AUTH_SECRET/i);
    expect(() => validatePulledVercelEnvironmentContract("AUTH_SECRET='unterminated\n"))
      .toThrow(/could not be parsed/i);
  });

  it("rejects missing, duplicate, preview-shared, branch-scoped, and custom-environment settings", () => {
    const missing = metadata();
    missing.envs = missing.envs.filter((entry) => entry.key !== "AUTH_SECRET");
    expect(() => validateVercelEnvironmentContract(missing)).toThrow(/missing.*AUTH_SECRET/i);

    const duplicate = metadata();
    duplicate.envs.push({ ...duplicate.envs[0] });
    expect(() => validateVercelEnvironmentContract(duplicate)).toThrow(/duplicate/i);

    expect(() => validateVercelEnvironmentContract(metadata({
      DATABASE_URL: { target: ["production", "preview"] }
    }))).toThrow(/DATABASE_URL.*production only/i);
    expect(() => validateVercelEnvironmentContract(metadata({
      DATABASE_URL: { gitBranch: "main" }
    }))).toThrow(/DATABASE_URL.*branch/i);
    expect(() => validateVercelEnvironmentContract(metadata({
      DATABASE_URL: { customEnvironmentIds: ["env_staging"] }
    }))).toThrow(/DATABASE_URL.*custom environment/i);
  });

  it("accepts array and envs response shapes but rejects malformed metadata", () => {
    expect(() => validateVercelEnvironmentContract(metadata().envs)).not.toThrow();
    expect(() => validateVercelEnvironmentContract({ envs: "not-an-array" })).toThrow(/metadata/i);
    expect(() => validateVercelEnvironmentContract({ envs: [{ key: "AUTH_SECRET" }] })).toThrow(/metadata/i);
  });

  it("fails closed when Vercel reports another metadata page", () => {
    expect(() => validateVercelEnvironmentContract({
      ...metadata(),
      pagination: { count: 100, next: 1234567890, prev: null }
    })).toThrow(/pagination|complete|unpaginated/i);
    expect(() => validateVercelEnvironmentContract({
      ...metadata(),
      pagination: { count: requiredReadableProductionEnvironmentNames.length +
        requiredSensitiveProductionEnvironmentNames.length + 1, next: null, prev: null }
    })).toThrow(/pagination|complete|unpaginated/i);
  });

  it("never includes environment values in validation errors", () => {
    const marker = "secret-value-that-must-never-leak";
    const input = metadata({ AUTH_SECRET: { type: "encrypted", value: marker } });
    try {
      validateVercelEnvironmentContract(input);
      throw new Error("Expected validation to fail.");
    } catch (error) {
      expect(String(error)).not.toContain(marker);
    }
  });

  it("validates a metadata file without printing values", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "kinresolve-vercel-env-"));
    scratchDirectories.push(directory);
    const filePath = path.join(directory, "metadata.json");
    const pulledEnvironmentPath = path.join(directory, "production.env");
    const marker = "secret-value-that-must-never-print";
    await writeFile(filePath, JSON.stringify(metadata({ AUTH_SECRET: { value: marker } })), "utf8");
    await writeFile(pulledEnvironmentPath, `AUTH_SECRET=${marker}\n`, "utf8");

    const result = spawnSync(process.execPath, [
      "--experimental-strip-types",
      path.join(process.cwd(), "scripts", "validate-vercel-environment.mjs"),
      filePath,
      pulledEnvironmentPath
    ], { encoding: "utf8", cwd: process.cwd() });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/verified.*readable.*sensitive/i);
    expect(`${result.stdout}${result.stderr}`).not.toContain(marker);
  });

  it("rejects a forbidden pulled setting without printing its value", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "kinresolve-vercel-env-forbidden-"));
    scratchDirectories.push(directory);
    const metadataPath = path.join(directory, "metadata.json");
    const pulledEnvironmentPath = path.join(directory, "production.env");
    const marker = "forbidden-secret-value-that-must-never-print";
    await writeFile(metadataPath, JSON.stringify(metadata()), "utf8");
    await writeFile(pulledEnvironmentPath, `MIGRATION_DATABASE_URL=${marker}\n`, "utf8");

    const result = spawnSync(process.execPath, [
      "--experimental-strip-types",
      path.join(process.cwd(), "scripts", "validate-vercel-environment.mjs"),
      metadataPath,
      pulledEnvironmentPath
    ], { encoding: "utf8", cwd: process.cwd() });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/forbidden workflow-only setting MIGRATION_DATABASE_URL/i);
    expect(`${result.stdout}${result.stderr}`).not.toContain(marker);
  });
});

type Override = Partial<{
  type: string;
  target: string[];
  gitBranch: string;
  customEnvironmentIds: string[];
  value: string;
}>;

function metadata(overrides: Record<string, Override> = {}, includeBetaApplicationSecret = false) {
  return {
    envs: [
      ...requiredSensitiveProductionEnvironmentNames.map((key) => ({
        key,
        type: "sensitive",
        target: ["production"],
        ...overrides[key]
      })),
      ...(includeBetaApplicationSecret ? [{
        key: betaApplicationSensitiveEnvironmentName,
        type: "sensitive",
        target: ["production"],
        ...overrides[betaApplicationSensitiveEnvironmentName]
      }] : []),
      ...requiredReadableProductionEnvironmentNames.map((key) => ({
        key,
        type: "encrypted",
        target: ["production"],
        ...overrides[key]
      }))
    ]
  };
}

function publicDemoMetadata(overrides: Record<string, Override> = {}) {
  return {
    envs: [
      ...publicDemoSensitiveProductionEnvironmentNames.map((key) => ({
        key,
        type: "sensitive",
        target: ["production"],
        ...overrides[key]
      })),
      ...publicDemoReadableProductionEnvironmentNames.map((key) => ({
        key,
        type: "encrypted",
        target: ["production"],
        ...overrides[key]
      }))
    ]
  };
}
