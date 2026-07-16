import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { workspaceOptionsForSession } from "@/lib/auth-session";

describe("public demo generation fencing", () => {
  it("projects a generation fence for guests without changing member archive options", () => {
    expect(workspaceOptionsForSession({
      kind: "member",
      userId: "user-1",
      email: "member@example.test",
      name: "Member",
      role: "owner",
      archiveId: "archive-member"
    })).toEqual({ archiveId: "archive-member" });

    expect(workspaceOptionsForSession({
      kind: "demo-guest",
      sessionId: "11111111-1111-4111-8111-111111111111",
      archiveId: "archive-demo-a",
      generation: 4,
      expiresAt: "2026-07-17T12:00:00.000Z"
    })).toEqual({
      archiveId: "archive-demo-a",
      demoGuestFence: {
        sessionId: "11111111-1111-4111-8111-111111111111",
        generation: 4
      }
    });
  });

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

  it("passes the authenticated fence through every guest-readable workspace route", async () => {
    const routes = await Promise.all([
      source("app/api/cases/route.ts"),
      source("app/api/dna/matches/route.ts"),
      source("app/api/people/route.ts"),
      source("app/api/publishing/readiness/route.ts"),
      source("app/api/reports/quality/route.ts"),
      source("app/api/sources/route.ts")
    ]);

    for (const route of routes) {
      expect(route).toContain("workspaceOptionsForSession(authorization)");
    }
  });

  it("passes the authenticated fence through every guest-visible workspace page", async () => {
    const pages = await Promise.all([
      source("app/app/page.tsx"),
      source("app/app/cases/page.tsx"),
      source("app/app/cases/[id]/page.tsx"),
      source("app/app/dna/page.tsx"),
      source("app/app/people/page.tsx"),
      source("app/app/people/[id]/page.tsx"),
      source("app/app/reports/page.tsx"),
      source("app/app/sources/page.tsx")
    ]);

    for (const page of pages) {
      expect(page).toContain("workspaceOptionsForSession(session)");
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

  it("persists the AI attempt generation and keeps the lease beyond the provider timeout", async () => {
    const migration = await source("db/migrations/018_public_demo.sql");
    const store = await source("lib/public-demo-session-store.ts");
    const reserve = store.slice(
      store.indexOf("export async function reservePublicDemoAiAttempt"),
      store.indexOf("export async function completePublicDemoAiAttempt")
    );
    const complete = store.slice(
      store.indexOf("export async function completePublicDemoAiAttempt"),
      store.indexOf("export async function readPublicDemoDiagnostics")
    );

    expect(migration).toMatch(/CREATE TABLE public\.public_demo_ai_attempts[\s\S]*archive_id text NOT NULL[\s\S]*generation integer NOT NULL/);
    expect(reserve).toMatch(/INSERT INTO public\.public_demo_ai_attempts[\s\S]*archive_id[\s\S]*generation/);
    expect(reserve).toMatch(/interval '30 seconds'/);
    expect(complete).toContain("archiveId: string");
    expect(complete).toContain("generation: number");
    expect(complete).toMatch(/archive_id = \$[0-9]+/);
    expect(complete).toMatch(/generation = \$[0-9]+/);
  });
});

function source(relativePath: string): Promise<string> {
  return readFile(path.join(process.cwd(), relativePath), "utf8");
}
