import { readFile } from "node:fs/promises";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import ChallengePage, { metadata } from "@/app/challenge/page";
import { ResearchInstinctsChallenge } from "@/components/research-instincts-challenge";

describe("public research instincts route", () => {
  it("is explicitly excluded from search indexing", () => {
    expect(metadata).toMatchObject({
      robots: expect.objectContaining({ index: false })
    });
  });

  it("renders the static challenge inside a public, clearly fictional page", async () => {
    const page = await ChallengePage();
    const html = renderToStaticMarkup(page);

    expect(html).toMatch(/test your genealogical skills/i);
    expect(html).toMatch(/fictional/i);
    expect(html).toMatch(/Hartwell[–-]Mercer/i);
    expect(html).toContain('href="/"');
    expect(html).not.toMatch(/sign in to continue|private workspace required/i);
  });
});

describe("research instincts accessible interaction contract", () => {
  it("server-renders one case as three labelled question groups", () => {
    const html = renderToStaticMarkup(createElement(ResearchInstinctsChallenge));
    const fieldsets = [...html.matchAll(/<fieldset\b[\s\S]*?<\/fieldset>/g)].map((match) => match[0]);

    expect(fieldsets).toHaveLength(3);
    for (const fieldset of fieldsets) {
      expect(fieldset).toMatch(/<legend\b/);
      expect(fieldset).toMatch(/<input\b/);
      expect(fieldset).toMatch(/<label\b/);
    }
    expect(html).toContain('type="radio"');
    expect(html).toContain('type="checkbox"');
  });

  it("announces progress and results without relying on color", () => {
    const html = renderToStaticMarkup(createElement(ResearchInstinctsChallenge));

    expect(html).toMatch(/role="progressbar"/);
    expect(html).toMatch(/aria-valuemin="0"/);
    expect(html).toMatch(/aria-valuemax="5"/);
    expect(html).toMatch(/aria-valuenow="[0-5]"/);
    expect(html).toMatch(/aria-live="polite"/);
  });

  it("moves keyboard focus into reset confirmation and restores it on cancel", async () => {
    const source = await readFile(
      path.join(process.cwd(), "components/research-instincts-challenge.tsx"),
      "utf8"
    );

    expect(source).toContain("resetConfirmRef.current?.focus()");
    expect(source).toContain("resetTriggerRef.current?.focus()");
  });
});
