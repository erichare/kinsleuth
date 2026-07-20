import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  FIRST_CUTOVER_ACKNOWLEDGEMENT,
  LEGACY_COMPATIBILITY_EXPECTATIONS,
  PINNED_BASELINE_COMMIT,
  PINNED_BASELINE_TAG,
  loadReleasePolicy,
  validateFirstCutoverAcknowledgement,
  validateReleasePolicy
} from "@/lib/release-policy";

const repositoryRoot = process.cwd();
const baselineChecksum = "9023c8a546dcab04a1fb01ae37cd81c2819025e1251a3b9c95df08dea3617c40";

const expectedMigrations = [
  {
    file: "001_initial.sql",
    sha256: baselineChecksum,
    risk: "baseline",
    compatibility: "baseline",
    notes: "Pinned v0.17.4 schema baseline; no rollback target is implied."
  },
  {
    file: "002_search_unaccent.sql",
    sha256: "fddf9f9a8fc3a439debf91a1262c82bb128a4dcbcd7047cbabf4a6ecf4c1c550",
    risk: "moderate",
    compatibility: "expansion-compatible",
    notes: "Installs or relocates unaccent; requires extension privileges but does not rewrite application rows."
  },
  {
    file: "003_auth_accounts.sql",
    sha256: "9d57f0a55d5043da0154ec947bf411408d825f87034e38e4033b84c5c5bd5e1f",
    risk: "high",
    compatibility: "legacy-incompatible",
    notes: "Renames legacy users and adds Better Auth memberships; v0.17.4 cannot enforce the new account boundary."
  },
  {
    file: "004_archive_scoped_keys.sql",
    sha256: "cf1d852419e752c462236f417177bef0651ec74c035f7353dcbbc9b5a9227195",
    risk: "high",
    compatibility: "legacy-incompatible",
    notes: "Rebuilds archive-scoped primary and foreign keys under access-exclusive locks; legacy key assumptions are unsafe."
  },
  {
    file: "005_guided_research_loop.sql",
    sha256: "1007d571926d590e060181e022510721cf47a8f64b24118f22cd9a6f363096e3",
    risk: "high",
    compatibility: "legacy-incompatible",
    notes: "Adds guided-research state; v0.17.4 writers can omit or overwrite state the hosted release must preserve."
  },
  {
    file: "006_integration_sources.sql",
    sha256: "174b48b220087d9728857c011050d9492c43224e411d859aa8b5b20c0d696cab",
    risk: "high",
    compatibility: "legacy-incompatible",
    notes: "Adds integration, snapshot, backup, sync, and job state; v0.17.4 cannot preserve or safely delete referenced records."
  },
  {
    file: "007_integration_change_filters.sql",
    sha256: "33bf169884f07955e960f56f27a7991036a7417f6fe481c68b7f487fa66aec1d",
    risk: "low",
    compatibility: "expansion-compatible",
    notes: "Adds a review index only; no row shape or application contract changes."
  },
  {
    file: "008_integration_upload_intents.sql",
    sha256: "ef2a140e31cf26205a10f74d7378324d36b3a8035f9cefd905d3bc3da5baa4f4",
    risk: "moderate",
    compatibility: "expansion-compatible",
    notes: "Adds upload-intent persistence and a supporting uniqueness constraint; existing writers remain structurally valid."
  },
  {
    file: "009_integration_media_objects.sql",
    sha256: "da0cf4d2e645ad6afd1eca2cc0d4704438ba33703127c89b42a396ce63110a2d",
    risk: "moderate",
    compatibility: "expansion-compatible",
    notes: "Adds nullable rights fields and private media tables with provenance constraints; existing integration rows remain valid."
  },
  {
    file: "010_integration_media_write_claims.sql",
    sha256: "a6ad46c12e6679c30d9f581e76c358d181cca48e9bd2716ec1b1cf15c01652a7",
    risk: "moderate",
    compatibility: "expansion-compatible",
    notes: "Adds media write-claim ownership records; existing application tables are unchanged."
  },
  {
    file: "011_integration_change_search.sql",
    sha256: "da2f8e0b06f6df05fc6c0731305ac9981ad03318b63924ae18877d3774dda852",
    risk: "moderate",
    compatibility: "expansion-compatible",
    notes: "Adds pg_trgm, a defaulted search projection, and an index; existing integration writers remain valid."
  },
  {
    file: "012_archive_dataset_mode.sql",
    sha256: "c33c80290cc547a49f6bd81e4c7e40e5adbf69a10e282870f69e1d003334f54c",
    risk: "high",
    compatibility: "legacy-incompatible",
    notes: "Adds persisted dataset mode defaulted to pilot; v0.17.4 ignores the mode and can seed synthetic data into a pilot cell."
  },
  {
    file: "013_release_write_fence.sql",
    sha256: "b747527b637d3fee8a3e4fc9834360bb467c5acb88bb6b2de854e91918d7ed82",
    risk: "low",
    compatibility: "expansion-compatible",
    notes: "Adds the durable production release-fence state machine and explicitly denies its control table to public API roles; existing application tables and writers remain structurally valid."
  },
  {
    file: "014_beta_invitations.sql",
    sha256: "8f8cb6a692f5cf7dfe1582ef8668c4d1a0efa1e448963d5890de0e7b46d2a88a",
    risk: "high",
    compatibility: "expansion-compatible",
    notes: "Adds fail-closed private-beta invitation, exact legal acceptance, email-verification, immutable audit, operator-replay, and durable auth-limit state; existing tables and writers remain structurally valid."
  },
  {
    file: "015_beta_operations.sql",
    sha256: "92cf51032274239d63ea0b2aa821a66829e31e03d7242245dfd749d2ddbd3337",
    risk: "moderate",
    compatibility: "expansion-compatible",
    notes: "Adds privacy-safe worker heartbeat and immutable participant data-operation evidence tables with explicit API-role denial; existing application tables and writers remain structurally valid."
  },
  {
    file: "016_beta_api_tokens.sql",
    sha256: "5dcef9457a54e83ac677d5cd19652e3f946c8ca46096e97e8d311c24ec7b5b0f",
    risk: "high",
    compatibility: "expansion-compatible",
    notes: "Backfills non-PII UUIDs across archives, people, facts, sources, and cases; volatile defaults rewrite/lock them. Adds immutable-ID triggers/indexes, confidence guards, digest-only tokens, quotas, and security evidence."
  },
  {
    file: "017_beta_applications.sql",
    sha256: "0c879f0c5c321dc99487d4559045119152cb2ce572a35cc7d1639fa26d91c082",
    risk: "moderate",
    compatibility: "expansion-compatible",
    notes: "Adds a deployment-global minimal-PII beta application table with fixed fields, consent and delivery invariants, 90-day retention, HMAC identities, explicit API-role denial, and no changes to existing writers."
  },
  {
    file: "018_public_demo.sql",
    sha256: "6569df1039864d3009c669d0fba34df2933e93c744cb4306fba56869e0843d26",
    risk: "moderate",
    compatibility: "expansion-compatible",
    notes: "Adds bounded server-only public-demo capacity, digest-only guest sessions, archive generations, AI leases, and fixed-schema 30-day events without changing existing application tables or writers."
  },
  {
    file: "019_public_demo_stats.sql",
    sha256: "f72cfa0f99db27cf548ef4558a5167086e69502862ea7a4097458353f8b4d664",
    risk: "low",
    compatibility: "expansion-compatible",
    notes: "Adds a server-only singleton public-demo usage counter with explicit API-role denial; existing application tables and writers remain structurally valid."
  },
  {
    file: "021_public_demo_notice_versions.sql",
    sha256: "7d6c0a40cd72dc9c4850b6b619736336a755d90d9516967722764b31dfa135a0",
    risk: "low",
    compatibility: "expansion-compatible",
    notes: "Widens the public-demo session notice-version CHECK to accept both the 2026-07-16 and 2026-07-20 notices so existing rows stay valid while new sessions record the Plausible-naming notice; no other tables or writers change."
  }
] as const;

function policyFixture(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    baseline: {
      tag: "v0.17.4",
      commit: "6f544ea8a5e92fbb68230db1cce4cb9231a40247",
      migrationFile: "001_initial.sql",
      sha256: baselineChecksum
    },
    rollbackPolicy: "forward-only",
    firstCompatibleRollbackAnchor: null,
    legacyCompatibility: {
      tag: "v0.17.4",
      commit: "6f544ea8a5e92fbb68230db1cce4cb9231a40247",
      expectedResult: "incompatible-forward-only",
      requiredEvidence: structuredClone(LEGACY_COMPATIBILITY_EXPECTATIONS)
    },
    firstCutover: {
      acknowledgementVersion: "first-hosted-cutover-v1",
      requiredAcknowledgement: FIRST_CUTOVER_ACKNOWLEDGEMENT
    },
    migrations: structuredClone(expectedMigrations)
  };
}

function checksumFixture(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    files: Object.fromEntries(expectedMigrations.map((migration) => [migration.file, migration.sha256])),
    releaseAnchors: {
      "v0.17.4": { "001_initial.sql": baselineChecksum }
    }
  };
}

function validationInput(policy: unknown = policyFixture(), checksums: unknown = checksumFixture()) {
  return { policy, checksums };
}

describe("forward-only first-cutover release policy", () => {
  it("pins the checked-in baseline and reviewed migration policy without a fake approval", async () => {
    const policy = await loadReleasePolicy({ repositoryRoot });

    expect(PINNED_BASELINE_TAG).toBe("v0.17.4");
    expect(PINNED_BASELINE_COMMIT).toBe("6f544ea8a5e92fbb68230db1cce4cb9231a40247");
    expect(policy).toEqual(policyFixture());
    expect(policy.migrations).toEqual(expectedMigrations);
    expect(policy.rollbackPolicy).toBe("forward-only");
    expect(policy.firstCompatibleRollbackAnchor).toBeNull();
    expect(policy.legacyCompatibility.requiredEvidence).toEqual(LEGACY_COMPATIBILITY_EXPECTATIONS);
    expect(policy).not.toHaveProperty("owner");
    expect(policy).not.toHaveProperty("acknowledgedAt");
    expect(policy).not.toHaveProperty("approvedBy");
  });

  it("requires the exact pinned baseline, forward-only policy, and empty first rollback anchor", () => {
    for (const [field, value, expectedError] of [
      ["tag", "v0.17.5", /baseline tag.*v0\.17\.4/i],
      ["commit", "0123456789abcdef0123456789abcdef01234567", /baseline commit.*6f544e/i],
      ["migrationFile", "002_search_unaccent.sql", /baseline migration.*001_initial\.sql/i],
      ["sha256", "a".repeat(64), /baseline checksum/i]
    ] as const) {
      const policy = policyFixture();
      (policy.baseline as Record<string, unknown>)[field] = value;
      expect(() => validateReleasePolicy(validationInput(policy)), field).toThrow(expectedError);
    }

    const reversible = policyFixture();
    reversible.rollbackPolicy = "automatic-down-migration";
    expect(() => validateReleasePolicy(validationInput(reversible))).toThrow(/rollbackPolicy.*forward-only/i);

    const anchored = policyFixture();
    anchored.firstCompatibleRollbackAnchor = { tag: "v0.18.0", commit: "a".repeat(40) };
    expect(() => validateReleasePolicy(validationInput(anchored))).toThrow(/firstCompatibleRollbackAnchor.*null/i);

    const compatibleLegacy = policyFixture();
    (compatibleLegacy.legacyCompatibility as Record<string, unknown>).expectedResult = "compatible";
    expect(() => validateReleasePolicy(validationInput(compatibleLegacy))).toThrow(
      /legacyCompatibility expectedResult.*incompatible-forward-only/i
    );
  });

  it("pins every executable legacy incompatibility observation to its reviewed migration", () => {
    const policy = policyFixture();
    const evidence = (policy.legacyCompatibility as Record<string, unknown>).requiredEvidence as Array<Record<string, unknown>>;

    evidence.reverse();
    expect(() => validateReleasePolicy(validationInput(policy))).toThrow(/legacyCompatibility evidence 1 id.*auth-account-boundary/i);

    const remapped = policyFixture();
    const remappedEvidence = (remapped.legacyCompatibility as Record<string, unknown>).requiredEvidence as Array<Record<string, unknown>>;
    remappedEvidence[1].migrationFiles = ["006_integration_sources.sql"];
    expect(() => validateReleasePolicy(validationInput(remapped))).toThrow(/migrationFiles.*reviewed compatibility mapping/i);

    const reworded = policyFixture();
    const rewordedEvidence = (reworded.legacyCompatibility as Record<string, unknown>).requiredEvidence as Array<Record<string, unknown>>;
    rewordedEvidence[3].expectedObservation = "legacy-seeding-is-probably-safe";
    expect(() => validateReleasePolicy(validationInput(reworded))).toThrow(/expectedObservation.*reviewed/i);

    const reclassified = policyFixture();
    ((reclassified.migrations as Array<Record<string, unknown>>)[11]).compatibility = "expansion-compatible";
    expect(() => validateReleasePolicy(validationInput(reclassified))).toThrow(/must reference.*legacy-incompatible/i);
  });

  it("proves a filename bijection and exact checksum equality with checksums.json", () => {
    const missing = policyFixture();
    (missing.migrations as unknown[]).pop();
    expect(() => validateReleasePolicy(validationInput(missing))).toThrow(/missing.*021_public_demo_notice_versions\.sql/i);

    const duplicate = policyFixture();
    (duplicate.migrations as unknown[]).push(structuredClone((duplicate.migrations as unknown[])[0]));
    expect(() => validateReleasePolicy(validationInput(duplicate))).toThrow(/duplicate.*001_initial\.sql/i);

    const extra = policyFixture();
    (extra.migrations as unknown[]).push({
      file: "022_unreviewed.sql",
      sha256: "b".repeat(64),
      risk: "low",
      compatibility: "expansion-compatible",
      notes: "This unreviewed entry must not be accepted without a checksum manifest entry."
    });
    expect(() => validateReleasePolicy(validationInput(extra))).toThrow(/not recorded.*022_unreviewed\.sql/i);

    const mismatch = policyFixture();
    ((mismatch.migrations as Array<Record<string, unknown>>)[4]).sha256 = "c".repeat(64);
    expect(() => validateReleasePolicy(validationInput(mismatch))).toThrow(/checksum mismatch.*005_guided_research_loop\.sql/i);

    const unclassifiedChecksum = checksumFixture();
    (unclassifiedChecksum.files as Record<string, string>)["016_unreviewed.sql"] = "d".repeat(64);
    expect(() => validateReleasePolicy(validationInput(policyFixture(), unclassifiedChecksum))).toThrow(
      /missing policy entry.*016_unreviewed\.sql/i
    );
  });

  it("rejects unsafe or non-machine-readable migration entries and approval-shaped manifest fields", () => {
    for (const [field, value, expectedError] of [
      ["file", "../001_initial.sql", /invalid migration filename/i],
      ["sha256", "NOT-A-CHECKSUM", /invalid SHA-256/i],
      ["risk", "guess", /risk.*baseline, low, moderate, or high/i],
      ["compatibility", "probably", /compatibility.*baseline, expansion-compatible, or legacy-incompatible/i],
      ["notes", "unsafe\nsecond line", /notes.*single-line/i]
    ] as const) {
      const policy = policyFixture();
      ((policy.migrations as Array<Record<string, unknown>>)[0])[field] = value;
      expect(() => validateReleasePolicy(validationInput(policy)), field).toThrow(expectedError);
    }

    const topLevelApproval = policyFixture();
    topLevelApproval.approvedBy = "checked-in-owner";
    expect(() => validateReleasePolicy(validationInput(topLevelApproval))).toThrow(/unexpected.*approvedBy/i);

    const entryApproval = policyFixture();
    ((entryApproval.migrations as Array<Record<string, unknown>>)[0]).approvalTicket = "fake-ticket";
    expect(() => validateReleasePolicy(validationInput(entryApproval))).toThrow(/unexpected.*approvalTicket/i);
  });

  it("requires a safe runtime owner, strict timestamp, and exact first-cutover acknowledgement", () => {
    const policy = validateReleasePolicy(validationInput());
    expect(validateFirstCutoverAcknowledgement({
      policy,
      owner: "erichare",
      acknowledgedAt: "2026-07-15T04:30:00Z",
      acknowledgement: FIRST_CUTOVER_ACKNOWLEDGEMENT
    })).toEqual({
      owner: "erichare",
      acknowledgedAt: "2026-07-15T04:30:00Z",
      acknowledgementVersion: "first-hosted-cutover-v1"
    });

    for (const invalid of [
      { owner: "bad owner", acknowledgedAt: "2026-07-15T04:30:00Z", acknowledgement: FIRST_CUTOVER_ACKNOWLEDGEMENT },
      { owner: "erichare", acknowledgedAt: "2026-07-15", acknowledgement: FIRST_CUTOVER_ACKNOWLEDGEMENT },
      { owner: "erichare", acknowledgedAt: "2026-02-30T04:30:00Z", acknowledgement: FIRST_CUTOVER_ACKNOWLEDGEMENT },
      { owner: "erichare", acknowledgedAt: "2026-07-15T04:30:00Z", acknowledgement: "I accept a reversible cutover." }
    ]) {
      expect(() => validateFirstCutoverAcknowledgement({ policy, ...invalid })).toThrow();
    }
  });

  it("never includes rejected runtime acknowledgement values in errors", () => {
    const policy = validateReleasePolicy(validationInput());
    const marker = "sensitive-wrong-acknowledgement-marker";

    try {
      validateFirstCutoverAcknowledgement({
        policy,
        owner: `bad owner ${marker}`,
        acknowledgedAt: `not-a-date-${marker}`,
        acknowledgement: marker
      });
      throw new Error("Expected acknowledgement validation to fail.");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(marker);
    }
  });

  it("validates workflow environment input and prints only a safe summary", () => {
    const scriptPath = path.join(repositoryRoot, "scripts", "validate-release-policy.mjs");
    const result = spawnSync(process.execPath, ["--experimental-strip-types", scriptPath], {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        RELEASE_POLICY_OWNER: "erichare",
        RELEASE_POLICY_ACKNOWLEDGED_AT: "2026-07-15T04:30:00Z",
        FIRST_CUTOVER_ACKNOWLEDGEMENT
      }
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/verified 20 migration.*v0\.17\.4.*forward-only/i);
    expect(result.stdout).toMatch(/owner erichare.*2026-07-15T04:30:00Z/i);
    expect(result.stdout).not.toContain(FIRST_CUTOVER_ACKNOWLEDGEMENT);
    expect(result.stderr).not.toContain(FIRST_CUTOVER_ACKNOWLEDGEMENT);
  });

  it("fails workflow input safely without echoing a rejected acknowledgement", () => {
    const scriptPath = path.join(repositoryRoot, "scripts", "validate-release-policy.mjs");
    const marker = "sensitive-invalid-workflow-acknowledgement";
    const result = spawnSync(process.execPath, ["--experimental-strip-types", scriptPath], {
      cwd: repositoryRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        RELEASE_POLICY_OWNER: "erichare",
        RELEASE_POLICY_ACKNOWLEDGED_AT: "2026-07-15T04:30:00Z",
        FIRST_CUTOVER_ACKNOWLEDGEMENT: marker
      }
    });

    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).not.toContain(marker);
    expect(result.stderr).toMatch(/FIRST_CUTOVER_ACKNOWLEDGEMENT.*exact/i);
  });
});
