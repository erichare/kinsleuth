import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { researchInstinctsCases } from "@/lib/research-instincts";

import {
  EXPECTED_ALL_IMMERSIVE_RECORDS,
  EXPECTED_IMMERSIVE_CASES
} from "./research-instincts-all-cases-contract";

const ASSET_ROOTS = ["site/public", "public"] as const;
const MIN_ASSET_BYTES = 32 * 1024;
const MAX_ASSET_BYTES = 512 * 1024;
const MAX_CASE_BYTES = 3 * 1024 * 1024;

describe("all-case immersive archive contract", () => {
  it("turns all five cases into six-record investigations with distinct research skills", () => {
    expect(EXPECTED_IMMERSIVE_CASES).toHaveLength(5);
    expect(researchInstinctsCases).toHaveLength(5);

    for (const expectedCase of EXPECTED_IMMERSIVE_CASES) {
      const challengeCase = researchInstinctsCases.find(({ id }) => id === expectedCase.caseId);
      const records = challengeCase?.records ?? [];

      expect(challengeCase, expectedCase.caseId).toBeDefined();
      expect((challengeCase as { skill?: string })?.skill, `${expectedCase.caseId} skill`).toMatch(
        expectedCase.skillPattern
      );
      expect(records, `${expectedCase.caseId} records`).toHaveLength(6);
      expect(records.map(({ catalogId }) => catalogId)).toEqual(
        expectedCase.records.map(({ catalogId }) => catalogId)
      );
      expect(records.map(({ image }) => image.src)).toEqual(
        expectedCase.records.map(({ assetPath }) => assetPath)
      );

      records.forEach((record, index) => {
        expect(record.title, record.catalogId).toMatch(expectedCase.records[index].titlePattern);
      });
    }
  });

  it("requires cross-record reasoning and preserves limitations in every case notebook", () => {
    for (const challengeCase of researchInstinctsCases) {
      const records = challengeCase.records ?? [];
      const clues = challengeCase.notebookClues ?? [];
      const recordsById = new Map(records.map((record) => [record.id, record]));
      const cluesById = new Map(clues.map((clue) => [clue.id, clue]));

      expect(records).toHaveLength(6);
      expect(clues.length, `${challengeCase.id} notebook clues`).toBeGreaterThanOrEqual(6);
      expect(
        clues.some((clue) => clue.recordIds.length >= 2),
        `${challengeCase.id} contains a cross-record clue`
      ).toBe(true);
      expect(
        clues.some((clue) => /cannot|conflict|limit|not proof|provisional|uncertain|later|snapshot/i.test(clue.label)),
        `${challengeCase.id} contains a limitation clue`
      ).toBe(true);
      expect(
        records.some((record) => /catalog|circular|directory|index|matrix|reference|register|chart/i.test(
          `${record.kind} ${record.title}`
        )),
        `${challengeCase.id} contains an in-case lookup source`
      ).toBe(true);

      for (const record of records) {
        expect(record.metadata.some(({ label }) => /research limit/i.test(label)), `${record.catalogId} limit`).toBe(
          true
        );
        expect(record.clueIds.length, `${record.catalogId} clues`).toBeGreaterThan(0);
        for (const clueId of record.clueIds) {
          const clue = cluesById.get(clueId);
          expect(clue, `${record.catalogId}/${clueId}`).toBeDefined();
          expect(clue?.recordIds).toContain(record.id);
        }
      }

      for (const clue of clues) {
        for (const recordId of clue.recordIds) {
          expect(recordsById.get(recordId), `${challengeCase.id}/${clue.id}/${recordId}`).toBeDefined();
          expect(recordsById.get(recordId)?.clueIds).toContain(clue.id);
        }
      }
    }
  });

  it("ships every synthetic record as a byte-identical, bounded WebP in both public trees", () => {
    expect(EXPECTED_ALL_IMMERSIVE_RECORDS).toHaveLength(30);

    for (const expectedCase of EXPECTED_IMMERSIVE_CASES) {
      let caseBytes = 0;

      for (const record of expectedCase.records) {
        const assets = ASSET_ROOTS.map((root) =>
          path.join(process.cwd(), root, record.assetPath.replace(/^\//, ""))
        );
        for (const asset of assets) expect(existsSync(asset), asset).toBe(true);
        if (!assets.every(existsSync)) continue;

        const [siteBytes, appBytes] = assets.map((asset) => readFileSync(asset));
        expect(siteBytes.equals(appBytes), `${record.catalogId} mirrors`).toBe(true);
        expect(siteBytes.subarray(0, 4).toString("ascii"), record.catalogId).toBe("RIFF");
        expect(siteBytes.subarray(8, 12).toString("ascii"), record.catalogId).toBe("WEBP");
        expect(statSync(assets[0]).size, `${record.catalogId} useful image size`).toBeGreaterThanOrEqual(
          MIN_ASSET_BYTES
        );
        expect(statSync(assets[0]).size, `${record.catalogId} size`).toBeLessThanOrEqual(MAX_ASSET_BYTES);
        caseBytes += statSync(assets[0]).size;
      }

      expect(caseBytes, `${expectedCase.caseId} payload`).toBeLessThanOrEqual(MAX_CASE_BYTES);
    }
  });

  it("describes the public challenge as five immersive investigations rather than compact follow-ups", () => {
    const publicCopy = [
      "app/challenge/page.tsx",
      "site/app/challenge/page.tsx",
      "README.md",
      "app/stories/page.tsx",
      "site/app/product/page.tsx"
    ].map((relativePath) => readFileSync(path.join(process.cwd(), relativePath), "utf8")).join("\n");

    expect(publicCopy).toMatch(/five immersive|five document-based|thirty synthetic records/i);
    expect(publicCopy).not.toMatch(/four compact|four shorter follow-ups/i);
  });
});
