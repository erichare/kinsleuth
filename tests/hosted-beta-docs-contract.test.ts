import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const cohortOneManifest = [
  ["KINRESOLVE_DNA_ENABLED", "false"],
  ["KINRESOLVE_EXTERNAL_AI_ENABLED", "false"],
  ["KINRESOLVE_PUBLIC_ARCHIVE_ENABLED", "false"],
  ["KINRESOLVE_PUBLIC_PUBLISHING_ENABLED", "false"],
  ["KINRESOLVE_EVIDENCE_BINARY_UPLOADS_ENABLED", "false"],
  ["KINRESOLVE_PACKAGE_MEDIA_ENABLED", "false"],
  ["KINRESOLVE_PLAIN_GEDCOM_ENABLED", "true"]
] as const;

describe("hosted private-beta documentation contract", () => {
  it("documents the exact seven-flag cohort-one manifest without changing self-hosted defaults", async () => {
    const [environment, contract] = await Promise.all([
      readFile(".env.example", "utf8"),
      readFile("docs/hosted-beta-contract.md", "utf8")
    ]);

    for (const [name, value] of cohortOneManifest) {
      expect(environment, name).toMatch(new RegExp(`^# ${name}=${value}$`, "m"));
      expect(contract, name).toContain(`\`${name}\` | \`${value}\``);
    }

    expect(environment).toMatch(/commented.*self-hosted defaults/i);
    expect(environment).toMatch(/uncomment all seven.*hosted/i);
  });

  it("states the admitted GEDCOM, source, analysis, and disabled-feature boundaries", async () => {
    const [environment, contract, readme] = await Promise.all([
      readFile(".env.example", "utf8"),
      readFile("docs/hosted-beta-contract.md", "utf8"),
      readFile("README.md", "utf8")
    ]);
    const documentation = `${contract}\n${readme}`;

    expect(environment).toMatch(/10 MiB \(10,485,760 bytes\).*40,000 people/i);
    expect(documentation).toMatch(/plain GEDCOM[^\n]*10 MiB[^\n]*40,000 people/i);
    expect(documentation).toMatch(/source[^\n]*transcript-only/i);
    expect(documentation).toMatch(/deterministic local analysis[^\n]*no external provider/i);
    expect(documentation).toMatch(/DNA[^\n]*disabled/i);
    expect(documentation).toMatch(/public publishing[^\n]*disabled/i);
    expect(documentation).toMatch(/public archive[^\n]*disabled/i);
    expect(documentation).toMatch(/package media[^\n]*disabled/i);
  });

  it("documents disabled self-registration outside the seven capability flags", async () => {
    const [environment, contract, readme] = await Promise.all([
      readFile(".env.example", "utf8"),
      readFile("docs/hosted-beta-contract.md", "utf8"),
      readFile("README.md", "utf8")
    ]);

    expect(environment).toMatch(/^# KINSLEUTH_ALLOW_SIGNUPS=false$/m);
    expect(contract).toMatch(/`KINSLEUTH_ALLOW_SIGNUPS`[^\n]*`false`[^\n]*hosted/i);
    expect(readme).toMatch(/`KINSLEUTH_ALLOW_SIGNUPS`[^\n]*hosted[^\n]*`false`/i);
  });

  it("labels the hosted product as proposed, pending approval, and not live", async () => {
    const [contract, readme] = await Promise.all([
      readFile("docs/hosted-beta-contract.md", "utf8"),
      readFile("README.md", "utf8")
    ]);

    expect(contract).toMatch(/Status:\*\* Proposed; owner and counsel sign-off pending/);
    expect(contract).toMatch(/app\.kinresolve\.com` \(not live yet\)/);
    expect(readme).toMatch(/hosted private beta[^\n]*proposed[^\n]*not live/i);
    expect(readme).toMatch(/owner and counsel approval[^\n]*pending/i);
  });
});
