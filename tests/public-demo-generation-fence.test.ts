import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("public demo generation fencing", () => {
  it("checks session, archive, and generation under the workspace transaction lock", async () => {
    const workspace = await source("lib/workspace-store.ts");

    expect(workspace).toContain("demoGuestFence");
    expect(workspace).toMatch(
      /public_demo_sessions[\s\S]*session\.id = \$2::uuid[\s\S]*session\.archive_id = \$1[\s\S]*session\.generation = \$3[\s\S]*FOR SHARE/
    );
  });

  it("passes the authenticated fence through every dedicated mutation and AI read", async () => {
    const guide = await source("app/api/demo/cases/[caseId]/guide/route.ts");
    const sample = await source("app/api/demo/sample-import/route.ts");
    const ai = await source("app/api/demo/ai/route.ts");

    for (const route of [guide, sample, ai]) {
      expect(route).toContain("demoGuestFence");
      expect(route).toContain("generation:");
      expect(route).toContain("sessionId:");
    }
  });

  it("binds an AI reservation to the exact active archive generation", async () => {
    const store = await source("lib/public-demo-session-store.ts");
    const reserve = store.slice(
      store.indexOf("export async function reservePublicDemoAiAttempt"),
      store.indexOf("export async function completePublicDemoAiAttempt")
    );

    expect(reserve).toContain("archiveId: string");
    expect(reserve).toContain("generation: number");
    expect(reserve).toMatch(/archive_id = \$[0-9]+/);
    expect(reserve).toMatch(/generation = \$[0-9]+/);
  });
});

function source(relativePath: string): Promise<string> {
  return readFile(path.join(process.cwd(), relativePath), "utf8");
}
