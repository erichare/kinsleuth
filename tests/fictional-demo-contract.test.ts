import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const retiredBinaryHashes = [
  "3509a06a85731eb16cd6b02af0d616093000d5bcab0d728628516280c3ee91ed",
  "15f26af199460c21602feffd03d5e4558b177adb9609f8401a903f6d2884a3a1",
  "f1a1549aa8e0661763670bc7155eb45280f21911ef59cdad371e1a987ee1e9aa",
  "d715e1268d7552daff529b78ae26f6615a10e25c065026701ec1ba11f460ff5c",
  "b5b6287d60c381e5fb1fc2376604ae7b8fa2e21156f54e638c94148dc13671e5",
  "3e5b490a081d6c9702001b6452359d6227cd9056f58b027e72e1aaeb10c629d5",
  "572e0d56d6319d045b74de0dbf3396200ecad781f63966d5061a33afa1df8ce4",
  "72fd5bd220d8468c3e5392c9d2d2c6dc696114fee6355986739bbcbd78839071",
  "f6f4743025fb69a347bd4d3dc3fbfbabbdbe3d14f5e434ef4d20bdb1c1108cdb",
  "8a44a106edf44b21a44ff0f7a14239e73ef7952ad755d5dc258a0393af18482e",
  "6d4492f709b7ceef7564324d99897e0c4780685bec7b72dd902f47a447bc3f31",
  "d0ab01ca42d9c0d454eb1472b03ed11740dfa3a58ea77cf82d699e2f8f0161fa",
  "c0d1b8cb85d6346f957768f74f16c25e99ce9418806bb5e0ad665382f9ddaeb6"
] as const;

describe("fictional demo boundary", () => {
  it("keeps retired real-family identifiers out of tracked paths and text", () => {
    const output = execFileSync(process.execPath, ["scripts/verify-fictional-demo.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8"
    });

    expect(output).toMatch(/Verified fictional demo boundary/);
  });

  it("keeps the complete retired binary inventory in the verifier", async () => {
    const source = await readFile("scripts/verify-fictional-demo.mjs", "utf8");
    const inventory = source.match(/const retiredBinaryHashes = new Set\(\[([\s\S]*?)\]\);/)?.[1] ?? "";
    const actual = [...inventory.matchAll(/"([a-f0-9]{64})"/g)].map((match) => match[1]);

    expect(new Set(actual)).toEqual(new Set(retiredBinaryHashes));
    expect(source).toContain('replace(/\\p{M}+/gu, "")');
    expect(source).toContain('toString("utf16le")');
  });
});
