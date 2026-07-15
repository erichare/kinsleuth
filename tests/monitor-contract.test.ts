import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const script = path.join(process.cwd(), "scripts", "validate-monitor-contract.mjs");
const contractPath = path.join(process.cwd(), "config", "production-monitors.json");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    force: true,
    recursive: true
  })));
});

describe("production monitor contract", () => {
  it("validates the checked-in privacy-safe monitor set", () => {
    const result = run(contractPath);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/verified 8 privacy-safe production monitor contracts/i);
  });

  it.each([
    ["an absolute target URL", (document: MonitorDocument) => { document.monitors[0]!.path = "https://private.invalid/api/health"; }],
    ["a credential value", (document: MonitorDocument) => { document.monitors[0]!.bodyContract = "Bearer PRIVATE_TOKEN"; }],
    ["an unexpected field", (document: MonitorDocument) => { (document.monitors[0] as Record<string, unknown>).secret = "PRIVATE"; }],
    ["an unreviewed monitor", (document: MonitorDocument) => { document.monitors.push({ ...document.monitors[0]!, id: "extra" }); }]
  ])("rejects %s", async (_label, mutate) => {
    const document = JSON.parse(await (await import("node:fs/promises")).readFile(contractPath, "utf8"));
    mutate(document);
    const directory = await mkdtemp(path.join(tmpdir(), "kinresolve-monitor-contract-"));
    temporaryDirectories.push(directory);
    const fixture = path.join(directory, "contract.json");
    await writeFile(fixture, `${JSON.stringify(document)}\n`, { mode: 0o600 });
    const result = run(fixture);
    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).not.toContain("PRIVATE_TOKEN");
  });
});

type MonitorDocument = {
  monitors: Array<Record<string, unknown> & { id: string; path: string; bodyContract: string }>;
};

function run(filePath: string) {
  return spawnSync(process.execPath, [script, filePath], { encoding: "utf8" });
}
