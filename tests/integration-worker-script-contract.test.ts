import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("long-running integration worker maintenance contract", () => {
  it("uses the interval scheduler and never logs a caught maintenance error", async () => {
    const source = await readFile(path.join(process.cwd(), "scripts", "worker.ts"), "utf8");

    expect(source).toContain("createIntegrationWorkerMaintenanceScheduler(configuration)");
    expect(source).toContain("await runMaintenanceIfDue()");
    expect(source).toContain(
      "Kin Resolve integration worker maintenance encountered an operational failure."
    );
    expect(source).not.toMatch(/catch\s*\((?:error|cause)\)[\s\S]*?worker maintenance/);
  });
});
