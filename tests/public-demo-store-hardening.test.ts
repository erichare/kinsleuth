import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("public demo lifecycle hardening", () => {
  it("serializes global AI admission before counting concurrent and daily usage", async () => {
    const reserve = await functionSource(
      "lib/public-demo-session-store.ts",
      "export async function reservePublicDemoAiAttempt",
      "export async function completePublicDemoAiAttempt"
    );

    expect(reserve).toContain("lockCapacity(client)");
    expect(reserve.indexOf("lockCapacity(client)")).toBeLessThan(reserve.indexOf("count(*) FILTER"));
  });

  it("prevents a successful reset while a provider attempt still leases the generation", async () => {
    const reset = await functionSource(
      "lib/public-demo-session-store.ts",
      "export async function resetPublicDemoSession",
      "export async function endPublicDemoSession"
    );

    expect(reset).toMatch(/public_demo_ai_attempts[\s\S]*state = 'running'[\s\S]*lease_expires_at/);
    expect(reset).toMatch(/AI.*in progress|active AI/i);
  });

  it("deletes cleaned lifecycle metadata after 30 days", async () => {
    const cleanup = await functionSource(
      "lib/public-demo-session-store.ts",
      "export async function cleanupPublicDemoSessions",
      "async function activateProvisionedSession"
    );

    expect(cleanup).toMatch(/DELETE FROM public\.public_demo_sessions[\s\S]*interval '30 days'/);
  });

  it("does not consume a new-session network bucket when capacity is already full", async () => {
    const start = await functionSource(
      "lib/public-demo-session-store.ts",
      "export async function startPublicDemoSession",
      "export async function resetPublicDemoSession"
    );

    expect(start.indexOf("decidePublicDemoAdmission")).toBeLessThan(
      start.indexOf("consumePublicDemoNetworkRateLimit")
    );
  });
});

async function functionSource(relativePath: string, start: string, end: string): Promise<string> {
  const contents = await readFile(path.join(process.cwd(), relativePath), "utf8");
  return contents.slice(contents.indexOf(start), contents.indexOf(end));
}
