import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("public demo guided case journey", () => {
  it("replaces generic case mutations with the dedicated fixed-input journey for guests", async () => {
    const page = await source("app/app/cases/[id]/page.tsx");
    const journey = await source("components/demo-guided-case-journey.tsx");

    expect(page).toContain('session.kind === "demo-guest"');
    expect(page).toContain("DemoGuidedCaseJourney");
    expect(journey).toContain("/api/demo/cases/");
    expect(journey).toContain('command: "record_outcome"');
    expect(journey).not.toMatch(/<textarea|contentEditable|type=["']text["']/i);
  });

  it("shows both fictional signature records and only fixed research outcomes", async () => {
    const journey = await source("components/demo-guided-case-journey.tsx");

    expect(journey).toContain("Fictional 1907 passenger-list signature");
    expect(journey).toContain("Fictional 1909 marriage signature");
    expect(journey).toContain('value: "found"');
    expect(journey).toContain('value: "not_found"');
    expect(journey).toContain('value: "inconclusive"');
  });

  it("unlocks the three curated AI questions only after the outcome", async () => {
    const journey = await source("components/demo-guided-case-journey.tsx");

    expect(journey).toContain("/api/demo/ai");
    expect(journey).toContain("case_next_steps");
    expect(journey).toContain("evidence_gaps");
    expect(journey).toContain("dna_cluster_summary");
    expect(journey).toMatch(/outcomeCompleted[\s\S]*curated AI/i);
  });

  it("has a narrow-viewport layout contract for the complete core task", async () => {
    const styles = await source("app/globals.css");

    expect(styles).toContain(".demo-guided-journey");
    expect(styles).toMatch(/@media \(max-width: 520px\)[\s\S]*\.demo-signature-grid/);
  });

  it("uses a minmax column on the guided journey grid root", async () => {
    const styles = await source("app/globals.css");
    const rule = styles.match(/\.demo-guided-journey\s*\{([^{}]*)\}/)?.[1] ?? "";

    expect(rule).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s*;/);
  });

  it("uses a minmax single column for outcomes below 760px", async () => {
    const styles = await source("app/globals.css");
    const start = styles.indexOf("@media (max-width: 760px)");
    const end = styles.indexOf("@media (max-width: 520px)", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const media = styles.slice(start, end);
    const rule = media.match(/\.demo-outcome-options\s*\{([^{}]*)\}/)?.[1] ?? "";

    expect(rule).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s*;/);
    expect(rule).not.toMatch(/grid-template-columns:\s*1fr\s*;/);
  });

  it("uses a minmax single column for signatures below 520px", async () => {
    const styles = await source("app/globals.css");
    const start = styles.indexOf("@media (max-width: 520px)");
    const end = styles.indexOf("/* Private guided research loop", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const media = styles.slice(start, end);
    const rule = media.match(/\.demo-signature-grid\s*\{([^{}]*)\}/)?.[1] ?? "";

    expect(rule).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s*;/);
    expect(rule).not.toMatch(/grid-template-columns:\s*1fr\s*;/);
  });

  it("uses a minmax column for the curated AI grid", async () => {
    const styles = await source("app/globals.css");
    const rule = styles.match(/\.demo-curated-ai\s*\{([^{}]*)\}/)?.[1] ?? "";

    expect(rule).toMatch(/display:\s*grid\s*;/);
    expect(rule).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s*;/);
  });

  it("uses a minmax column for the AI result grid", async () => {
    const styles = await source("app/globals.css");
    const rule = [...styles.matchAll(/(?:^|\n)\.demo-ai-result\s*\{([^{}]*)\}/g)]
      .map((match) => match[1] ?? "")
      .find((body) => /display:\s*grid\s*;/.test(body)) ?? "";

    expect(rule).toMatch(/display:\s*grid\s*;/);
    expect(rule).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s*;/);
  });

  it("wraps bounded AI result text at any character when necessary", async () => {
    const styles = await source("app/globals.css");
    const rule = [...styles.matchAll(/(?:^|\n)\.demo-ai-result\s*\{([^{}]*)\}/g)]
      .map((match) => match[1] ?? "")
      .find((body) => /display:\s*grid\s*;/.test(body)) ?? "";

    expect(rule).toMatch(/overflow-wrap:\s*anywhere\s*;/);
  });

  it("gives the next-assignment paragraph AA text contrast on its accent background", async () => {
    const styles = await source("app/globals.css");
    const mutedRule = styles.match(
      /[^{}]*\.demo-next-assignment p[^{}]*\{[^{}]*color:\s*var\(--muted\)/
    );
    const darkerOverride = styles.match(
      /\.demo-next-assignment\s*>\s*p\s*\{[^{}]*color:\s*(?:var\(--(?:ink|accent-strong|accent-deep)\)|#(?:0d1a16|003d34|002b25))[^{}]*\}/i
    );

    expect(mutedRule?.index).toBeTypeOf("number");
    expect(darkerOverride?.index).toBeTypeOf("number");
    expect(darkerOverride?.index).toBeGreaterThan(mutedRule?.index ?? Number.MAX_SAFE_INTEGER);
  });
});

function source(relativePath: string): Promise<string> {
  return readFile(path.join(root, relativePath), "utf8");
}
