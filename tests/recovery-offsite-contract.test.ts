import { pathToFileURL } from "node:url";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const moduleUrl = pathToFileURL(
  path.join(process.cwd(), "scripts", "recovery-offsite.mjs")
).href;

describe("offsite recovery storage contract", () => {
  it("accepts only enabled versioning and a sufficient default COMPLIANCE lock", () => {
    const result = evaluate(`
      const value = validateBucketProtection(
        { Status: "Enabled" },
        {
          ObjectLockEnabled: "Enabled",
          Rule: { DefaultRetention: { Mode: "COMPLIANCE", Days: 30 } }
        },
        30
      );
      process.stdout.write(JSON.stringify(value));
    `);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      versioning: "Enabled",
      objectLock: "Enabled",
      defaultRetention: { mode: "COMPLIANCE", unit: "days", value: 30 }
    });
  });

  it.each([
    ["suspended versioning", '{ Status: "Suspended" }', '{ ObjectLockEnabled: "Enabled", Rule: { DefaultRetention: { Mode: "COMPLIANCE", Days: 30 } } }', 30],
    ["missing object lock", '{ Status: "Enabled" }', '{}', 30],
    ["governance mode", '{ Status: "Enabled" }', '{ ObjectLockEnabled: "Enabled", Rule: { DefaultRetention: { Mode: "GOVERNANCE", Days: 30 } } }', 30],
    ["ambiguous period", '{ Status: "Enabled" }', '{ ObjectLockEnabled: "Enabled", Rule: { DefaultRetention: { Mode: "COMPLIANCE", Days: 30, Years: 1 } } }', 30],
    ["short default", '{ Status: "Enabled" }', '{ ObjectLockEnabled: "Enabled", Rule: { DefaultRetention: { Mode: "COMPLIANCE", Days: 29 } } }', 30]
  ])("rejects %s", (_label, versioning, lock, minimum) => {
    const result = evaluate(
      `validateBucketProtection(${versioning}, ${lock}, ${minimum});`
    );
    expect(result.status).toBe(1);
  });

  it("normalizes exact object-version COMPLIANCE retention without overstating it", () => {
    const result = evaluate(`
      const value = validateObjectRetention(
        { Retention: { Mode: "COMPLIANCE", RetainUntilDate: new Date("2026-08-20T00:00:00Z") } },
        30,
        new Date("2026-07-15T00:00:00Z")
      );
      process.stdout.write(JSON.stringify(value));
    `);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      mode: "COMPLIANCE",
      retainUntil: "2026-08-20T00:00:00.000Z",
      validatedMinimumDays: 30
    });
  });

  it.each([
    ["governance", "GOVERNANCE", "2026-08-20T00:00:00Z"],
    ["short", "COMPLIANCE", "2026-07-20T00:00:00Z"],
    ["missing", "COMPLIANCE", "invalid"]
  ])("rejects %s object retention", (_label, mode, retainUntil) => {
    const result = evaluate(`
      validateObjectRetention(
        { Retention: { Mode: ${JSON.stringify(mode)}, RetainUntilDate: ${JSON.stringify(retainUntil)} } },
        30,
        new Date("2026-07-15T00:00:00Z")
      );
    `);
    expect(result.status).toBe(1);
  });
});

function evaluate(source: string) {
  return spawnSync(process.execPath, [
    "--input-type=module",
    "--eval",
    `import { validateBucketProtection, validateObjectRetention } from ${JSON.stringify(moduleUrl)};\n${source}`
  ], {
    encoding: "utf8"
  });
}
