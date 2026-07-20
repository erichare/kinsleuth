import { withTransaction, type DatabaseOptions } from "./db";
// Imported from ./db-rls directly so unit tests that mock "@/lib/db" keep the
// real scope helper.
import { withRlsArchiveScope } from "./db-rls";
import { prepareGedcomImport } from "./gedcom/apply";
import {
  applyPreparedGedcomImport,
  assertDemoGuestGenerationFenceInTransaction,
  readWorkspace,
  restoreWorkspaceBackupInTransaction,
  type DemoGuestGenerationFence
} from "./workspace-store";

export const publicDemoSampleFixtureId = "hartwell-mercer-sample-v1" as const;
export type PublicDemoSampleImportAction = "review" | "apply" | "rollback";

const sourceName = "Fictional Hartwell-Mercer sample.ged";
const preImportReason = `Before applying ${sourceName}`;

const bundledGedcom = [
  "0 HEAD",
  "1 SOUR KINRESOLVE-DEMO",
  "1 GEDC",
  "2 VERS 5.5.1",
  "2 FORM LINEAGE-LINKED",
  "1 CHAR UTF-8",
  "1 NOTE Fictional sample created only for the Kin Resolve public demo.",
  "0 @I901@ INDI",
  "1 NAME Rowan /Hartwell/",
  "1 SEX M",
  "1 BIRT",
  "2 DATE 12 MAR 1884",
  "2 PLAC Lantern Bay, Wisconsin",
  "2 SOUR @S901@",
  "1 DEAT",
  "2 DATE 4 APR 1951",
  "1 _KS_LIVING deceased",
  "1 _KS_PRIVACY private",
  "1 _KS_PUBLISHED N",
  "0 @I902@ INDI",
  "1 NAME Eliza /Mercer/",
  "1 SEX F",
  "1 BIRT",
  "2 DATE 7 JUL 1888",
  "2 PLAC Northstar Cove, Nova Scotia",
  "2 SOUR @S901@",
  "1 DEAT",
  "2 DATE 9 SEP 1960",
  "1 _KS_LIVING deceased",
  "1 _KS_PRIVACY private",
  "1 _KS_PUBLISHED N",
  "0 @F901@ FAM",
  "1 HUSB @I901@",
  "1 WIFE @I902@",
  "1 MARR",
  "2 DATE 2 JUN 1910",
  "2 PLAC Lantern Bay, Wisconsin",
  "2 SOUR @S901@",
  "0 @S901@ SOUR",
  "1 TITL Fictional Lantern Bay sample register",
  "1 REPO Kin Resolve synthetic demo archive",
  "1 NOTE Invented citation; it does not describe a real record or person.",
  "0 TRLR"
].join("\n");

type PublicDemoSampleImportOptions = DatabaseOptions & {
  archiveId: string;
  demoGuestFence: DemoGuestGenerationFence;
};

export async function runPublicDemoSampleImport(
  action: PublicDemoSampleImportAction,
  fixtureId: typeof publicDemoSampleFixtureId,
  options: PublicDemoSampleImportOptions
) {
  if (fixtureId !== publicDemoSampleFixtureId) {
    throw new Error("Unknown public demo sample fixture");
  }

  const prepared = prepareGedcomImport(sourceName, bundledGedcom);

  if (action === "review") {
    return {
      action,
      fixtureId,
      snapshot: {
        id: prepared.snapshot.id,
        sourceName: prepared.snapshot.sourceName,
        checksum: prepared.snapshot.checksum,
        summary: prepared.snapshot.summary,
        recordCount: prepared.snapshot.records.length
      },
      diff: {
        added: prepared.snapshot.records.length,
        changed: 0,
        deleted: 0,
        unchanged: 0,
        records: prepared.snapshot.records.map((record) => ({
          xref: record.xref,
          type: record.type,
          status: "added" as const
        }))
      }
    };
  }

  if (action === "apply") {
    const workspace = await readWorkspace(options);
    if (workspace.imports.some((candidate) => candidate.id === prepared.appliedImport.id)) {
      throw new Error("The bundled sample is already applied in this sandbox");
    }
    const applied = await applyPreparedGedcomImport(prepared, options);
    return {
      action,
      fixtureId,
      importId: applied.import.id,
      backupId: applied.backup.id,
      peopleImported: applied.peopleImported,
      sourcesImported: applied.sourcesImported,
      rawRecordCount: applied.rawRecordCount
    };
  }

  const workspace = await readWorkspace(options);
  const backup = workspace.backups
    .filter((candidate) => candidate.reason === preImportReason)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];
  if (!backup) {
    throw new Error("The bundled sample has not been applied in this sandbox");
  }

  await withTransaction(withRlsArchiveScope(options, options.archiveId), async (client) => {
    const locked = await client.query(
      "UPDATE archives SET updated_at = now() WHERE id = $1 RETURNING id",
      [options.archiveId]
    );
    if (locked.rowCount !== 1) {
      throw new Error("Public demo archive not found");
    }
    await assertDemoGuestGenerationFenceInTransaction(
      client,
      options.archiveId,
      options.demoGuestFence
    );
    await restoreWorkspaceBackupInTransaction(client, options.archiveId, backup.id);
  });

  return { action, fixtureId, restored: true };
}
