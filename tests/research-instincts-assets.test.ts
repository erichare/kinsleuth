import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { EXPECTED_IMMERSIVE_RECORDS } from "./research-instincts-immersive-contract";

const ASSET_ROOTS = ["site/public", "public"] as const;
const MIN_ASSET_BYTES = 32 * 1024;
const MAX_ASSET_BYTES = 512 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;

function absoluteAssetPath(root: (typeof ASSET_ROOTS)[number], publicPath: string) {
  return path.join(process.cwd(), root, publicPath.replace(/^\//, ""));
}

describe("immersive challenge asset contract", () => {
  it("ships all six exact synthetic records in both public asset trees", () => {
    expect(EXPECTED_IMMERSIVE_RECORDS).toHaveLength(6);

    for (const record of EXPECTED_IMMERSIVE_RECORDS) {
      for (const root of ASSET_ROOTS) {
        const asset = absoluteAssetPath(root, record.assetPath);
        expect(existsSync(asset), `${root}${record.assetPath}`).toBe(true);
      }
    }
  });

  it("keeps every mirrored WebP byte-identical and within an individual size budget", () => {
    for (const record of EXPECTED_IMMERSIVE_RECORDS) {
      const siteAsset = absoluteAssetPath("site/public", record.assetPath);
      const appAsset = absoluteAssetPath("public", record.assetPath);

      if (!existsSync(siteAsset) || !existsSync(appAsset)) continue;

      const siteBytes = readFileSync(siteAsset);
      const appBytes = readFileSync(appAsset);

      expect(siteBytes.equals(appBytes), `${record.catalogId} mirrors`).toBe(true);
      expect(siteBytes.byteLength, `${record.catalogId} minimum useful image size`).toBeGreaterThanOrEqual(
        MIN_ASSET_BYTES
      );
      expect(siteBytes.byteLength, `${record.catalogId} maximum image size`).toBeLessThanOrEqual(
        MAX_ASSET_BYTES
      );
      expect(siteBytes.subarray(0, 4).toString("ascii"), `${record.catalogId} RIFF header`).toBe("RIFF");
      expect(siteBytes.subarray(8, 12).toString("ascii"), `${record.catalogId} WebP header`).toBe("WEBP");
    }
  });

  it("keeps the six-record image payload within the total page budget", () => {
    const sizes = EXPECTED_IMMERSIVE_RECORDS.map((record) => {
      const asset = absoluteAssetPath("site/public", record.assetPath);
      return existsSync(asset) ? statSync(asset).size : 0;
    });

    expect(sizes.every((size) => size > 0), "all expected asset sizes are available").toBe(true);
    expect(sizes.reduce((total, size) => total + size, 0)).toBeLessThanOrEqual(MAX_TOTAL_BYTES);
  });
});
