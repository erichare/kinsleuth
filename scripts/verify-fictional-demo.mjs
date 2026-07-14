#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";

// Opaque hashes keep retired real-family identifiers out of the repository
// while preventing those identifiers from returning in tracked paths or text.
const retiredTokenHashes = new Set([
  "cfae1e8baa71958f6a0a4c54ba2fbd227611cab4d4bfa1dc976e2fa753051277",
  "e231c63489d815a0ba6c86208a41979154f9eb69f693b92a045dba1d593d30b2",
  "fad68de0366cdcbbba040891fd694529cce0a154f4e55bdc8d334c4df2b5735c",
  "fccaeb43cd77bcce1c24fddc1350d6aeec8151f40887b55ecff94b82a5bd0433",
  "f59a9f36d8ebd94fd2e2574d7db879f7bf586294db4cbabdefe5fd7b1be11739",
  "a2470c9d137c1c5d3567d1180a64cb43a9269c4d6f1ff13ac8cdbaf6fc5df3b7",
  "6e7c631674e245c4dbf3140092e9f8f384aa581b1ad50ebffbc0c847ec2eef34"
]);

// Exact content hashes prevent retired screenshots and previews from being
// reintroduced without storing any of their private text in this repository.
const retiredBinaryHashes = new Set([
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
]);

function tokenHash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function matchingHashes(value) {
  const normalized = value.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[’']/g, "");
  const matches = new Set();
  for (const token of normalized.match(/[a-z]+/g) ?? []) {
    const hash = tokenHash(token);
    if (retiredTokenHashes.has(hash)) matches.add(hash);
  }
  return [...matches];
}

function decodeText(contents) {
  if (contents.length >= 2 && contents[0] === 0xff && contents[1] === 0xfe) {
    return contents.subarray(2).toString("utf16le");
  }
  if (contents.length >= 2 && contents[0] === 0xfe && contents[1] === 0xff) {
    const body = Buffer.from(contents.subarray(2));
    for (let index = 0; index + 1 < body.length; index += 2) {
      [body[index], body[index + 1]] = [body[index + 1], body[index]];
    }
    return body.toString("utf16le");
  }
  return contents.includes(0) ? null : contents.toString("utf8");
}

const tracked = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" }
)
  .split("\0")
  .filter(Boolean);
const violations = [];

for (const file of tracked) {
  for (const hash of matchingHashes(file)) {
    violations.push(`${file} (path token ${hash.slice(0, 12)})`);
  }

  const contents = await readFile(file);
  const contentHash = createHash("sha256").update(contents).digest("hex");
  if (retiredBinaryHashes.has(contentHash)) {
    violations.push(`${file} (retired binary ${contentHash.slice(0, 12)})`);
  }
  const decoded = decodeText(contents);
  if (decoded === null) continue;
  for (const hash of matchingHashes(decoded)) {
    violations.push(`${file} (text token ${hash.slice(0, 12)})`);
  }
}

if (violations.length > 0) {
  console.error("Retired real-family demo identifiers remain in tracked files:");
  for (const violation of [...new Set(violations)].sort()) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log(`Verified fictional demo boundary across ${tracked.length} repository files.`);
}
