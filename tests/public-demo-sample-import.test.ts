import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applyPreparedGedcomImport: vi.fn(),
  readWorkspace: vi.fn(),
  restoreWorkspaceBackupInTransaction: vi.fn(),
  clientQuery: vi.fn()
}));

vi.mock("@/lib/workspace-store", () => ({
  applyPreparedGedcomImport: mocks.applyPreparedGedcomImport,
  readWorkspace: mocks.readWorkspace,
  restoreWorkspaceBackupInTransaction: mocks.restoreWorkspaceBackupInTransaction
}));

vi.mock("@/lib/db", () => ({
  withTransaction: async (_options: unknown, callback: (client: object) => Promise<unknown>) => callback({
    query: mocks.clientQuery
  })
}));

describe("bundled public demo GEDCOM", () => {
  beforeEach(() => {
    mocks.applyPreparedGedcomImport.mockReset();
    mocks.readWorkspace.mockReset();
    mocks.readWorkspace.mockResolvedValue({ imports: [], backups: [] });
    mocks.restoreWorkspaceBackupInTransaction.mockReset();
    mocks.clientQuery.mockReset();
  });

  it("builds a real parser-backed review without caller content", async () => {
    const { runPublicDemoSampleImport } = await import("@/lib/public-demo-sample-import");
    const result = await runPublicDemoSampleImport(
      "review",
      "hartwell-mercer-sample-v1",
      { archiveId: "archive-guest" }
    );

    expect(result).toMatchObject({
      action: "review",
      fixtureId: "hartwell-mercer-sample-v1",
      snapshot: {
        sourceName: expect.stringMatching(/fictional/i),
        summary: expect.objectContaining({ individuals: 2, families: 1, sources: 1 })
      },
      diff: { added: expect.any(Number), changed: 0, deleted: 0, unchanged: 0 }
    });
    expect(mocks.applyPreparedGedcomImport).not.toHaveBeenCalled();
  });

  it("applies the exact prepared fixture to the explicit guest archive", async () => {
    mocks.applyPreparedGedcomImport.mockResolvedValue({
      import: { id: "import-demo" },
      backup: { id: "backup-demo" },
      peopleImported: 2,
      sourcesImported: 1,
      rawRecordCount: 5
    });
    const { runPublicDemoSampleImport } = await import("@/lib/public-demo-sample-import");
    const result = await runPublicDemoSampleImport(
      "apply",
      "hartwell-mercer-sample-v1",
      { archiveId: "archive-guest" }
    );

    expect(mocks.applyPreparedGedcomImport).toHaveBeenCalledWith(
      expect.objectContaining({
        appliedImport: expect.objectContaining({ sourceName: expect.stringMatching(/fictional/i) })
      }),
      { archiveId: "archive-guest" }
    );
    expect(result).toMatchObject({ action: "apply", backupId: "backup-demo" });
  });

  it("denies a second apply until the current sample is rolled back", async () => {
    const { runPublicDemoSampleImport } = await import("@/lib/public-demo-sample-import");
    const review = await runPublicDemoSampleImport(
      "review",
      "hartwell-mercer-sample-v1",
      { archiveId: "archive-guest" }
    );
    if (!("snapshot" in review) || !review.snapshot) {
      throw new Error("Expected the bundled fixture review snapshot");
    }
    mocks.readWorkspace.mockResolvedValue({
      imports: [{ id: review.snapshot.id }],
      backups: []
    });

    await expect(runPublicDemoSampleImport(
      "apply",
      "hartwell-mercer-sample-v1",
      { archiveId: "archive-guest" }
    )).rejects.toThrow(/already applied/i);
    expect(mocks.applyPreparedGedcomImport).not.toHaveBeenCalled();
  });

  it("rolls back the newest matching pre-import backup inside the guest archive", async () => {
    mocks.readWorkspace.mockResolvedValue({
      backups: [
        { id: "backup-unrelated", reason: "Before another operation", createdAt: "2026-07-16T13:00:00.000Z" },
        { id: "backup-fixture", reason: "Before applying Fictional Hartwell-Mercer sample.ged", createdAt: "2026-07-16T12:00:00.000Z" }
      ]
    });
    mocks.clientQuery.mockResolvedValue({ rowCount: 1, rows: [{ id: "archive-guest" }] });
    mocks.restoreWorkspaceBackupInTransaction.mockResolvedValue({});
    const { runPublicDemoSampleImport } = await import("@/lib/public-demo-sample-import");
    const result = await runPublicDemoSampleImport(
      "rollback",
      "hartwell-mercer-sample-v1",
      { archiveId: "archive-guest" }
    );

    expect(mocks.readWorkspace).toHaveBeenCalledWith({ archiveId: "archive-guest" });
    expect(mocks.clientQuery).toHaveBeenCalledWith(
      expect.stringMatching(/UPDATE archives/),
      ["archive-guest"]
    );
    expect(mocks.restoreWorkspaceBackupInTransaction).toHaveBeenCalledWith(
      expect.any(Object),
      "archive-guest",
      "backup-fixture"
    );
    expect(result).toEqual({
      action: "rollback",
      fixtureId: "hartwell-mercer-sample-v1",
      restored: true
    });
  });
});
