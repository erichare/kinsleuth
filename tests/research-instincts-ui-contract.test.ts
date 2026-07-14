import { readFile } from "node:fs/promises";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import ChallengePage, { metadata } from "@/app/challenge/page";
import { ResearchInstinctsChallenge } from "@/components/research-instincts-challenge";

import {
  EXPECTED_IMMERSIVE_RECORDS,
  IMMERSIVE_CHALLENGE_REGIONS
} from "./research-instincts-immersive-contract";

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
  it("server-renders the immersive record inspector and six-record navigation", () => {
    const html = renderToStaticMarkup(createElement(ResearchInstinctsChallenge));
    const navigation = html.match(/<nav\b[^>]*aria-label="Case records"[^>]*>([\s\S]*?)<\/nav>/)?.[1];

    expect(html).toContain('data-challenge-region="record-inspector"');
    expect(navigation, "Case records navigation").toBeDefined();
    expect(navigation?.match(/<button\b/g) ?? [], "record navigation controls").toHaveLength(6);
    for (const { catalogId } of EXPECTED_IMMERSIVE_RECORDS) {
      expect(navigation, `navigation includes ${catalogId}`).toContain(catalogId);
    }

    expect(html).toMatch(/<figure\b/);
    expect(html).toContain(`src="${EXPECTED_IMMERSIVE_RECORDS[0].assetPath}"`);
  });

  it("exposes deterministic zoom, transcript, notebook, and conclusion regions", () => {
    const firstRender = renderToStaticMarkup(createElement(ResearchInstinctsChallenge));
    const secondRender = renderToStaticMarkup(createElement(ResearchInstinctsChallenge));

    expect(secondRender).toBe(firstRender);
    for (const region of IMMERSIVE_CHALLENGE_REGIONS) {
      expect(firstRender, region).toContain(`data-challenge-region="${region}"`);
    }
    for (const accessibleName of ["Zoom out", "Zoom in", "Reset zoom"]) {
      expect(firstRender, accessibleName).toMatch(
        new RegExp(`<button\\b[^>]*aria-label="${accessibleName}"[^>]*>`)
      );
    }
    expect(firstRender).toMatch(/<h[2-6]\b[^>]*>Transcript<\/h[2-6]>/i);
    expect(firstRender).toMatch(/<h[2-6]\b[^>]*>Clue notebook<\/h[2-6]>/i);
  });

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
      path.join(process.cwd(), "site/shared/research-instincts-challenge.tsx"),
      "utf8"
    );

    expect(source).toContain("resetConfirmRef.current?.focus()");
    expect(source).toContain("resetTriggerRef.current?.focus()");
  });

  it("requests case-heading focus on every navigation and reset", async () => {
    const source = await readFile(
      path.join(process.cwd(), "site/shared/research-instincts-challenge.tsx"),
      "utf8"
    );

    expect(source).toContain("[activeCase.id, focusCaseRequest]");
    expect(source.match(/setFocusCaseRequest\(\(request\) => request \+ 1\)/g)).toHaveLength(2);
  });

  it("keeps the revealed answer key at full visual emphasis", async () => {
    const css = await readFile(path.join(process.cwd(), "site/app/globals.css"), "utf8");

    expect(css).toMatch(
      /\.challenge-option:has\(input:disabled:not\(:checked\)\):has\(\.challenge-option-feedback\)\s*\{[^}]*opacity:\s*1;/s
    );
  });
});
