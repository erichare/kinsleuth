import { createHash } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  query: vi.fn(),
  withTransaction: vi.fn()
}));

vi.mock("@/lib/db", () => dbMocks);

import {
  createIntegrationArtifact,
  deleteIntegrationArtifact,
  readIntegrationArtifact,
  streamIntegrationArtifact
} from "@/lib/integrations/artifact-store";

afterEach(() => {
  vi.resetAllMocks();
});

describe("integration artifact reads", () => {
  it("returns bytes that still match their persisted size and SHA-256", async () => {
    const bytes = Buffer.from("0 HEAD\n0 TRLR\n");
    const storage = objectStorageReturning(bytes);
    mockArtifactRow(bytes);

    const result = await readIntegrationArtifact("connection-1", "artifact-1", {
      archiveId: "archive-synthetic",
      objectStorage: storage as never
    });

    expect(result.bytes).toEqual(bytes);
    expect(storage.read).toHaveBeenCalledWith({
      archiveId: "archive-synthetic",
      key: "archives/archive-synthetic/integration-artifacts/sha"
    });
  });

  it("fails closed when stored bytes no longer match the persisted SHA-256", async () => {
    const expected = Buffer.from("original");
    const tampered = Buffer.from("tampered");
    const storage = objectStorageReturning(tampered);
    mockArtifactRow(expected, tampered.length);

    await expect(readIntegrationArtifact("connection-1", "artifact-1", {
      archiveId: "archive-synthetic",
      objectStorage: storage as never
    })).rejects.toMatchObject({
      code: "ARTIFACT_INTEGRITY",
      message: "Stored integration artifact failed integrity verification"
    });
  });

  it("fails closed when stored bytes no longer match the persisted size", async () => {
    const bytes = Buffer.from("0 HEAD\n0 TRLR\n");
    const storage = objectStorageReturning(bytes);
    mockArtifactRow(bytes, bytes.length + 1);

    await expect(readIntegrationArtifact("connection-1", "artifact-1", {
      archiveId: "archive-synthetic",
      objectStorage: storage as never
    })).rejects.toMatchObject({
      code: "ARTIFACT_INTEGRITY",
      message: "Stored integration artifact failed integrity verification"
    });
  });
});

describe("integration artifact downloads", () => {
  it("streams a size-verified artifact without returning its private object key", async () => {
    const bytes = Buffer.from("PK synthetic private export");
    const storage = objectStorageReturning(bytes);
    mockArtifactRow(bytes);

    const result = await streamIntegrationArtifact("connection-1", "artifact-1", {
      archiveId: "archive-synthetic",
      objectStorage: storage as never
    });
    const chunks: Buffer[] = [];
    for await (const chunk of result.body) chunks.push(Buffer.from(chunk));

    expect(Buffer.concat(chunks)).toEqual(bytes);
    expect(JSON.stringify(result.artifact)).not.toContain("artifactKey");
    expect(JSON.stringify(result.artifact)).not.toContain("archives/");
    expect(storage.stat).toHaveBeenCalledWith({
      archiveId: "archive-synthetic",
      key: "archives/archive-synthetic/integration-artifacts/sha"
    });
    expect(storage.stream).toHaveBeenCalledWith({
      archiveId: "archive-synthetic",
      key: "archives/archive-synthetic/integration-artifacts/sha"
    });
  });

  it("does not resolve another archive's connection or artifact", async () => {
    const storage = objectStorageReturning(Buffer.from("other archive export"));
    dbMocks.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await expect(streamIntegrationArtifact("connection-beta", "artifact-beta", {
      archiveId: "archive-alpha",
      objectStorage: storage as never
    })).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(dbMocks.query).toHaveBeenCalledWith(
      expect.stringMatching(/archive_id = \$1.*connection_id = \$2.*id = \$3/is),
      ["archive-alpha", "connection-beta", "artifact-beta"],
      expect.objectContaining({ archiveId: "archive-alpha" })
    );
    expect(dbMocks.query.mock.calls[0]?.[0]).toMatch(/state = 'ready'/);
    expect(storage.stat).not.toHaveBeenCalled();
    expect(storage.stream).not.toHaveBeenCalled();
  });

  it("fails before streaming when object-storage size metadata changed", async () => {
    const bytes = Buffer.from("PK synthetic private export");
    const storage = objectStorageReturning(bytes);
    storage.stat.mockResolvedValueOnce({
      key: "archives/archive-synthetic/integration-artifacts/sha",
      size: bytes.length + 1,
      contentType: "application/zip"
    });
    mockArtifactRow(bytes);

    await expect(streamIntegrationArtifact("connection-1", "artifact-1", {
      archiveId: "archive-synthetic",
      objectStorage: storage as never
    })).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
    expect(storage.stream).not.toHaveBeenCalled();
  });
});

describe("integration artifact deletion", () => {
  it("refuses to remove an object retained by an immutable snapshot", async () => {
    const bytes = Buffer.from("0 HEAD\n0 TRLR\n");
    const storage = objectStorageReturning(bytes);
    mockDeletionTransaction({ usedBySnapshot: true });

    await expect(deleteIntegrationArtifact("connection-1", "artifact-1", {
      archiveId: "archive-synthetic",
      objectStorage: storage as never
    })).rejects.toMatchObject({ code: "RUN_STATE" });

    expect(storage.delete).not.toHaveBeenCalled();
  });

  it("removes only an unconsumed staged object", async () => {
    const bytes = Buffer.from("0 HEAD\n0 TRLR\n");
    const storage = objectStorageReturning(bytes);
    mockDeletionTransaction({ usedBySnapshot: false });
    dbMocks.query.mockResolvedValueOnce({ rows: [{ total: 0 }] });

    await deleteIntegrationArtifact("connection-1", "artifact-1", {
      archiveId: "archive-synthetic",
      objectStorage: storage as never
    });

    expect(storage.delete).toHaveBeenCalledWith({
      archiveId: "archive-synthetic",
      key: "archives/archive-synthetic/integration-artifacts/sha"
    });
  });

  it("does not physically delete a legacy artifact key while a live browser ticket can recreate it", async () => {
    const bytes = Buffer.from("0 HEAD\n0 TRLR\n");
    const storage = objectStorageReturning(bytes);
    const client = mockDeletionTransaction({ usedBySnapshot: false, referenceTotal: 1 });

    await deleteIntegrationArtifact("connection-1", "artifact-1", {
      archiveId: "archive-synthetic",
      objectStorage: storage as never,
      now: () => new Date("2026-07-14T20:00:00.000Z")
    });

    expect(storage.delete).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledWith(
      expect.stringMatching(/integration_upload_intents[\s\S]*expires_at > \$3/i),
      [
        "archive-synthetic",
        "archives/archive-synthetic/integration-artifacts/sha",
        "2026-07-14T20:00:00.000Z"
      ]
    );
  });

  it("holds the artifact-key lock while rechecking references and deleting", async () => {
    const bytes = Buffer.from("0 HEAD\n0 TRLR\n");
    let transactionDepth = 0;
    const events: string[] = [];
    const storage = objectStorageReturning(bytes);
    storage.delete.mockImplementation(async () => {
      events.push("delete");
      expect(transactionDepth).toBeGreaterThan(0);
    });
    const artifact = deletionArtifactRow(false);
    const client = {
      query: vi.fn(async (sql: string) => {
        if (/pg_advisory_xact_lock/i.test(sql)) {
          events.push("lock");
          return { rows: [{}], rowCount: 1 };
        }
        if (/SELECT artifact_key/i.test(sql)) return { rows: [{ artifact_key: artifact.artifact_key }], rowCount: 1 };
        if (/SELECT artifact\.\*/i.test(sql)) return { rows: [artifact], rowCount: 1 };
        if (/count\(\*\).*integration_artifacts/is.test(sql)) return { rows: [{ total: 0 }], rowCount: 1 };
        return { rows: [], rowCount: 1 };
      })
    };
    dbMocks.query.mockResolvedValue({ rows: [{ total: 0 }], rowCount: 1 });
    dbMocks.withTransaction.mockImplementation(async (_options, operation) => {
      transactionDepth += 1;
      try {
        return await operation(client);
      } finally {
        transactionDepth -= 1;
      }
    });

    await deleteIntegrationArtifact("connection-1", "artifact-1", {
      archiveId: "archive-synthetic",
      objectStorage: storage as never
    });

    expect(events).toContain("lock");
    expect(events.indexOf("lock")).toBeLessThan(events.indexOf("delete"));
  });
});

describe("integration artifact creation cleanup", () => {
  it("rejects a desktop ZIP before object storage when either media release gate is closed", async () => {
    const bytes = Buffer.from("PK synthetic private export");
    const storage = objectStorageReturning(bytes);
    const client = {
      query: vi.fn(async (sql: string) => {
        if (/pg_advisory_xact_lock/i.test(sql)) return { rows: [{}], rowCount: 1 };
        if (/integration_connections/i.test(sql)) {
          return { rows: [{ id: "connection-1", provider: "rootsmagic" }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      })
    };
    dbMocks.withTransaction.mockImplementation(async (_options, operation) => operation(client));

    await expect(createIntegrationArtifact(
      "connection-1",
      {
        fileName: "rootsmagic.zip",
        contentType: "application/zip",
        bytes,
        mediaRightsAcknowledgement: {
          accepted: true,
          version: "desktop-media-rights-v1",
          actorId: "synthetic-owner"
        }
      },
      {
        archiveId: "archive-synthetic",
        objectStorage: storage as never,
        featureFlags: {
          exportRefresh: true,
          desktopMedia: true,
          desktopMediaLegalReviewApproved: false,
          ancestryPartnerApi: false
        }
      }
    )).rejects.toMatchObject({ code: "DESKTOP_MEDIA_DISABLED" });
    expect(storage.put).not.toHaveBeenCalled();
  });

  it("locks before object creation and removes an unreferenced object after a database write failure", async () => {
    const bytes = Buffer.from("0 HEAD\n0 TRLR\n");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const artifactKey = `archives/archive-synthetic/integration-artifacts/${sha256}`;
    const events: string[] = [];
    const storage = objectStorageReturning(bytes);
    storage.put.mockImplementation(async () => {
      events.push("put");
      return {
        key: artifactKey,
        access: "private",
        sha256,
        size: bytes.length,
        duplicate: false
      };
    });
    storage.delete.mockImplementation(async () => {
      events.push("delete");
    });
    dbMocks.query.mockResolvedValue({ rows: [{ id: "connection-1" }], rowCount: 1 });
    const client = {
      query: vi.fn(async (sql: string) => {
        if (/pg_advisory_xact_lock/i.test(sql)) {
          events.push("lock");
          return { rows: [{}], rowCount: 1 };
        }
        if (/integration_connections/i.test(sql)) return { rows: [{ id: "connection-1" }], rowCount: 1 };
        if (/INSERT INTO integration_artifacts/i.test(sql)) throw new Error("synthetic database write failure");
        if (/count\(\*\).*integration_artifacts/is.test(sql)) return { rows: [{ total: 0 }], rowCount: 1 };
        return { rows: [], rowCount: 1 };
      })
    };
    dbMocks.withTransaction.mockImplementation(async (_options, operation) => operation(client));

    await expect(createIntegrationArtifact(
      "connection-1",
      { fileName: "synthetic.ged", contentType: "text/plain", bytes },
      { archiveId: "archive-synthetic", objectStorage: storage as never }
    )).rejects.toThrow(/database write failure/i);

    expect(events).toContain("delete");
    expect(events.indexOf("lock")).toBeLessThan(events.indexOf("put"));
    expect(events.indexOf("put")).toBeLessThan(events.indexOf("delete"));
  });
});

function mockArtifactRow(bytes: Uint8Array, size = bytes.length): void {
  dbMocks.query.mockResolvedValue({
    rowCount: 1,
    rows: [{
      id: "artifact-1",
      connection_id: "connection-1",
      file_name: "tree.ged",
      artifact_key: "archives/archive-synthetic/integration-artifacts/sha",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      content_type: "application/x-gedcom",
      size_bytes: size,
      state: "ready",
      created_at: "2026-07-14T20:00:00.000Z",
      updated_at: "2026-07-14T20:00:00.000Z"
    }]
  });
}

function mockDeletionTransaction(input: { usedBySnapshot: boolean; referenceTotal?: number }) {
  const artifact = deletionArtifactRow(input.usedBySnapshot);
  const client = {
    query: vi.fn(async (sql: string) => {
      if (/SELECT artifact_key/i.test(sql)) return { rows: [{ artifact_key: artifact.artifact_key }], rowCount: 1 };
      if (/pg_advisory_xact_lock/i.test(sql)) return { rows: [{}], rowCount: 1 };
      if (/SELECT artifact\.\*/i.test(sql)) return { rows: [artifact], rowCount: 1 };
      if (/count\(\*\).*integration_artifacts/is.test(sql)) {
        return { rows: [{ total: input.referenceTotal ?? 0 }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    })
  };
  dbMocks.withTransaction.mockImplementation(async (_options, operation) => operation(client));
  return client;
}

function deletionArtifactRow(usedBySnapshot: boolean) {
  return {
    id: "artifact-1",
    connection_id: "connection-1",
    file_name: "tree.ged",
    artifact_key: "archives/archive-synthetic/integration-artifacts/sha",
    sha256: "a".repeat(64),
    content_type: "application/x-gedcom",
    size_bytes: 16,
    state: "staged",
    created_at: "2026-07-14T20:00:00.000Z",
    updated_at: "2026-07-14T20:00:00.000Z",
    used_by_run: false,
    used_by_snapshot: usedBySnapshot
  };
}

function objectStorageReturning(bytes: Uint8Array) {
  return {
    put: vi.fn(),
    read: vi.fn(async () => Buffer.from(bytes)),
    stat: vi.fn(async ({ key }: { key: string }) => ({
      key,
      size: bytes.length,
      contentType: "application/octet-stream"
    })),
    stream: vi.fn(async () => (async function* () {
      yield Buffer.from(bytes);
    })()),
    delete: vi.fn()
  };
}
