import { access } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  demoArchiveMediaForEvidence,
  demoArchiveMediaForRecord,
  demoArchiveMediaForSource
} from "@/lib/demo-archive-media";
import { demoCases } from "@/lib/demo-data";

describe("demo archive media", () => {
  it("maps every demo-case evidence item to an existing public asset", async () => {
    const evidence = demoCases.flatMap((researchCase) => researchCase.evidence);

    expect(evidence).toHaveLength(22);

    for (const item of evidence) {
      const media = demoArchiveMediaForEvidence(item.id);

      expect(media, item.id).toBeDefined();
      expect(media?.src, item.id).toMatch(/^\/assets\/challenge\/.+\.webp$/);
      await expect(
        access(path.join(process.cwd(), "public", media!.src.slice(1)))
      ).resolves.toBeUndefined();
    }
  });

  it("reuses the same challenge-record metadata for record and source lookups", () => {
    const byRecord = demoArchiveMediaForRecord("blue-tin-nora-journal-1922");
    const bySource = demoArchiveMediaForSource("src-fictional-nora-tin-journal");

    expect(bySource).toBe(byRecord);
    expect(byRecord).toMatchObject({
      catalogId: "KR-DEMO-C08-R6",
      src: "/assets/challenge/kr-demo-c08-r6-nora-journal.webp"
    });
    expect(demoArchiveMediaForEvidence("unknown-evidence")).toBeUndefined();
    expect(demoArchiveMediaForRecord("unknown-record")).toBeUndefined();
    expect(demoArchiveMediaForSource("src-fictional-lantern-bay-birth")).toBeUndefined();
  });
});
