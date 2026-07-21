import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDatabasePools, query } from "@/lib/db";
import { isIntegrationImportId } from "@/lib/integrations/import-id";
import {
  applyPreparedIntegrationSyncRun,
  processIntegrationSyncRun
} from "@/lib/integrations/run-processor";
import {
  createIntegrationArtifact,
  createIntegrationConnection,
  startSyncRun
} from "@/lib/integrations/store";
import { buildPersonMiniTree } from "@/lib/person-mini-tree";
import { buildPersonProfile } from "@/lib/person-profile";
import { fallbackRelationshipLabel, workspaceFamilyEdges } from "@/lib/person-relationships";
import { createArchiveObjectStorage } from "@/lib/storage/object-storage";
import { readPersonXrefMappingsByImportId, readWorkspace } from "@/lib/workspace-store";
import { provisionTestArchive } from "@/tests/helpers/provision-test-archive";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;

// End-to-end regression for the family-edge join: an integration-applied
// archive stores raw FAM records whose members are GEDCOM xrefs while its
// people carry generated local ids, and typed relationship labels plus the
// profile mini tree must still resolve through the per-connection external
// entity refs. Every name below is synthetic Hartwell–Mercer style fiction.
describeIfDatabase("person relationship context for integration-applied archives", () => {
  const archiveId = `test-relationship-context-${randomUUID()}`;
  const objects = new Map<string, { bytes: Buffer; contentType: string }>();
  const backend = {
    stat: vi.fn(async ({ key }: { key: string }) => {
      const value = objects.get(key);
      return value ? { key, size: value.bytes.length, contentType: value.contentType } : undefined;
    }),
    put: vi.fn(async (input: { key: string; bytes: Uint8Array; contentType: string }) => {
      objects.set(input.key, { bytes: Buffer.from(input.bytes), contentType: input.contentType });
    }),
    read: vi.fn(async ({ key }: { key: string }) => {
      const value = objects.get(key);
      if (!value) throw new Error("object not found");
      return value.bytes;
    }),
    delete: vi.fn(async ({ key }: { key: string }) => {
      objects.delete(key);
    })
  };
  const objectStorage = createArchiveObjectStorage({ backend });
  const options = { archiveId, databaseUrl: databaseUrl!, objectStorage };

  beforeEach(async () => {
    await provisionTestArchive(options);
  });

  afterEach(async () => {
    await query("DELETE FROM archives WHERE id = $1", [archiveId], options);
    objects.clear();
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await closeDatabasePools();
  });

  it("labels relatives and builds the mini tree from xref-translated family edges", async () => {
    const connection = await createIntegrationConnection(
      {
        provider: "ancestry_export",
        authority: "ancestry",
        displayName: "Synthetic Northwood hourglass export"
      },
      options
    );
    const artifact = await createIntegrationArtifact(
      connection.id,
      {
        fileName: "northwood-hourglass.ged",
        contentType: "text/plain",
        size: Buffer.byteLength(syntheticHourglassGedcom, "utf8"),
        bytes: Buffer.from(syntheticHourglassGedcom, "utf8")
      },
      options
    );
    const run = await startSyncRun(connection.id, { artifactId: artifact.id }, options);
    await processIntegrationSyncRun(run.id, options);
    await applyPreparedIntegrationSyncRun(
      run.id,
      { idempotencyKey: "apply-hourglass-v1", resolutions: [], acceptAllSafeIncoming: true },
      options
    );

    const workspace = await readWorkspace(options);
    const byName = (displayName: string) => {
      const match = workspace.people.find((person) => person.displayName === displayName);
      if (!match) throw new Error(`Missing imported person ${displayName}`);
      return match;
    };
    const focus = byName("Arthur Northwood");

    // The premise of the regression: integration-applied people do NOT reuse
    // their GEDCOM xrefs as ids, so a raw xref join can never match them.
    for (const person of [focus, byName("Gideon Northwood"), byName("Prudence Northwood")]) {
      expect(person.id).not.toMatch(/^@.+@$/);
    }
    expect(focus.relatives.length).toBeGreaterThan(0);

    const appliedImport = workspace.imports.find((item) => isIntegrationImportId(item.id));
    expect(appliedImport).toBeDefined();
    const xrefMappings = await readPersonXrefMappingsByImportId(options);
    expect(xrefMappings.get(appliedImport!.id)).toMatchObject({ scopeId: connection.id });

    const familyEdges = workspaceFamilyEdges(workspace, xrefMappings);
    const profile = buildPersonProfile(focus, { people: workspace.people, families: familyEdges });
    const labelByName = new Map(
      profile.relationships.map((relationship) => [relationship.displayName, relationship.relationship])
    );
    expect(labelByName.get("Gideon Northwood")).toBe("Father");
    expect(labelByName.get("Prudence Northwood")).toBe("Mother");
    expect(labelByName.get("Beatrice Northwood")).toBe("Sister");
    expect(labelByName.get("Cordelia Northwood")).toBe("Wife");
    expect(labelByName.get("Edmund Northwood")).toBe("Son");

    const miniTree = buildPersonMiniTree(focus, workspace.people, familyEdges);
    expect(miniTree).toBeDefined();
    expect(miniTree?.tree.generations.map((generation) => generation.id)).toEqual([
      "grandparents",
      "parents",
      "focus",
      "children"
    ]);
    const placedNames = miniTree?.people.map((person) => person.displayName) ?? [];
    expect(placedNames).toEqual(expect.arrayContaining([
      "Obadiah Northwood",
      "Tabitha Northwood",
      "Gideon Northwood",
      "Prudence Northwood",
      "Arthur Northwood",
      "Cordelia Northwood",
      "Edmund Northwood"
    ]));
    for (const placed of miniTree?.people ?? []) {
      expect(placed.id).not.toMatch(/^@.+@$/);
    }

    // Without the xref translation the raw edges cannot join the generated
    // person ids at all — the exact defect this suite guards against.
    const untranslatedEdges = workspaceFamilyEdges(workspace);
    const untranslatedProfile = buildPersonProfile(focus, {
      people: workspace.people,
      families: untranslatedEdges
    });
    expect(new Set(untranslatedProfile.relationships.map((relationship) => relationship.relationship)))
      .toEqual(new Set([fallbackRelationshipLabel]));
    expect(buildPersonMiniTree(focus, workspace.people, untranslatedEdges)).toBeUndefined();
  });
});

// Three-generation synthetic hourglass around Arthur Northwood: paternal
// grandparents, parents (with a sister), and his own family with a son.
const syntheticHourglassGedcom = [
  "0 HEAD",
  "1 SOUR KIN_RESOLVE_SYNTHETIC_FIXTURE",
  "1 GEDC",
  "2 VERS 5.5.1",
  "0 @I1@ INDI",
  "1 NAME Obadiah /Northwood/",
  "1 SEX M",
  "1 BIRT",
  "2 DATE 3 MAR 1831",
  "0 @I2@ INDI",
  "1 NAME Tabitha /Northwood/",
  "1 SEX F",
  "0 @I3@ INDI",
  "1 NAME Gideon /Northwood/",
  "1 SEX M",
  "1 BIRT",
  "2 DATE 21 MAY 1858",
  "0 @I4@ INDI",
  "1 NAME Prudence /Northwood/",
  "1 SEX F",
  "0 @I5@ INDI",
  "1 NAME Arthur /Northwood/",
  "1 SEX M",
  "1 BIRT",
  "2 DATE 14 APR 1884",
  "2 PLAC Lantern Bay, Wisconsin",
  "0 @I6@ INDI",
  "1 NAME Beatrice /Northwood/",
  "1 SEX F",
  "0 @I7@ INDI",
  "1 NAME Cordelia /Northwood/",
  "1 SEX F",
  "0 @I8@ INDI",
  "1 NAME Edmund /Northwood/",
  "1 SEX M",
  "0 @F1@ FAM",
  "1 HUSB @I1@",
  "1 WIFE @I2@",
  "1 CHIL @I3@",
  "0 @F2@ FAM",
  "1 HUSB @I3@",
  "1 WIFE @I4@",
  "1 CHIL @I5@",
  "1 CHIL @I6@",
  "0 @F3@ FAM",
  "1 HUSB @I5@",
  "1 WIFE @I7@",
  "1 CHIL @I8@",
  "0 TRLR"
].join("\n");
