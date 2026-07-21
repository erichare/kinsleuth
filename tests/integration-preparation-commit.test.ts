import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDatabasePools, query } from "@/lib/db";
import {
  commitIntegrationPreparation,
  failIntegrationPreparationTerminally,
  reconcileTerminalIntegrationFailures,
  resetIntegrationPreparationForRetry
} from "@/lib/integrations/preparation-store";
import {
  cancelSyncRun,
  createIntegrationConnection,
  getSyncRun,
  listSyncChanges,
  markSyncRunParsing,
  resolveExternalEntityRef,
  startSyncRun
} from "@/lib/integrations/store";
import { provisionTestArchive } from "@/tests/helpers/provision-test-archive";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;

describeIfDatabase("atomic integration preparation commit", () => {
  const archiveId = `test-preparation-${randomUUID()}`;
  const options = { archiveId, databaseUrl: databaseUrl! };

  beforeEach(async () => {
    await provisionTestArchive(options);
  });

  afterEach(async () => {
    await query("DELETE FROM archives WHERE id = $1", [archiveId], options);
  });

  afterAll(async () => {
    await closeDatabasePools();
  });

  it("publishes snapshot, changes, artifact state, and review status without pre-applying identity refs", async () => {
    const connection = await createConnection();
    const artifactId = await insertArtifact(connection.id, "a".repeat(64));
    const run = await startSyncRun(connection.id, { artifactId }, options);
    await markSyncRunParsing(run.id, options);

    const committed = await commitIntegrationPreparation(
      {
        runId: run.id,
        connectionId: connection.id,
        artifactId,
        snapshot: snapshotInput(connection.id, "a".repeat(64)),
        changes: [{
          entityType: "person",
          externalId: "@I1@",
          localEntityId: "person-synthetic-stable",
          baseHash: null,
          localHash: null,
          incomingHash: "incoming-hash",
          classification: "remote_only",
          proposedAction: "accept_incoming",
          resolutionPayload: {
            incomingAvailable: true,
            values: { incoming: { displayName: "Avery Ember", notes: "sealed preparation note" } }
          }
        }],
        externalRefs: [{
          entityType: "person",
          externalId: "@I1@",
          localEntityId: "person-synthetic-stable"
        }]
      },
      options
    );

    expect(committed.run).toMatchObject({ status: "review_ready", incomingSnapshotId: committed.snapshot.snapshot.id });
    expect((await listSyncChanges(run.id, { pageSize: 10 }, options)).items).toHaveLength(1);
    expect((await listSyncChanges(run.id, { pageSize: 10, query: "avery emb" }, options)).items).toHaveLength(1);
    expect((await listSyncChanges(run.id, { pageSize: 10, query: "sealed preparation" }, options)).items).toEqual([]);
    await expect(resolveExternalEntityRef(
      { connectionId: connection.id, entityType: "person", externalId: "@I1@" },
      options
    )).rejects.toMatchObject({ code: "NOT_FOUND" });
    const artifact = await query<{ state: string }>(
      "SELECT state FROM integration_artifacts WHERE archive_id = $1 AND id = $2",
      [archiveId, artifactId],
      options
    );
    expect(artifact.rows[0].state).toBe("ready");
  });

  it("cannot expose a partial review after the run is cancelled", async () => {
    const connection = await createConnection();
    const artifactId = await insertArtifact(connection.id, "b".repeat(64));
    const run = await startSyncRun(connection.id, { artifactId }, options);
    await markSyncRunParsing(run.id, options);
    await cancelSyncRun(run.id, options);

    await expect(commitIntegrationPreparation(
      {
        runId: run.id,
        connectionId: connection.id,
        artifactId,
        snapshot: snapshotInput(connection.id, "b".repeat(64)),
        changes: [],
        externalRefs: []
      },
      options
    )).rejects.toThrow(/cancel|state|prepar/i);

    await expect(getSyncRun(run.id, options)).resolves.toMatchObject({ status: "cancelled" });
    const persisted = await query<{ snapshots: number; changes: number }>(
      `SELECT
         (SELECT count(*)::integer FROM integration_snapshots WHERE archive_id = $1 AND connection_id = $2) AS snapshots,
         (SELECT count(*)::integer FROM sync_changes WHERE archive_id = $1 AND run_id = $3) AS changes`,
      [archiveId, connection.id, run.id],
      options
    );
    expect(persisted.rows[0]).toEqual({ snapshots: 0, changes: 0 });
  });

  it("publishes large review sets without mutating remembered identities before apply", async () => {
    const connection = await createConnection();
    const artifactId = await insertArtifact(connection.id, "e".repeat(64));
    const run = await startSyncRun(connection.id, { artifactId }, options);
    await markSyncRunParsing(run.id, options);
    const itemCount = 1_201;

    await commitIntegrationPreparation(
      {
        runId: run.id,
        connectionId: connection.id,
        artifactId,
        snapshot: snapshotInput(connection.id, "e".repeat(64)),
        changes: Array.from({ length: itemCount }, (_, index) => ({
          entityType: "fact",
          externalId: `synthetic-fact-${index}`,
          localEntityId: `synthetic-local-fact-${index}`,
          baseHash: null,
          localHash: null,
          incomingHash: `incoming-${index}`,
          classification: "remote_only" as const,
          proposedAction: "accept_incoming" as const,
          resolutionPayload: { syntheticIndex: index }
        })),
        externalRefs: Array.from({ length: itemCount }, (_, index) => ({
          entityType: "fact",
          externalId: `synthetic-fact-${index}`,
          localEntityId: `synthetic-local-fact-${index}`
        }))
      },
      options
    );

    const persisted = await query<{ changes: number; refs: number }>(
      `SELECT
         (SELECT count(*)::integer FROM sync_changes WHERE archive_id = $1 AND run_id = $2) AS changes,
         (SELECT count(*)::integer FROM external_entity_refs WHERE archive_id = $1 AND connection_id = $3) AS refs`,
      [archiveId, run.id, connection.id],
      options
    );
    expect(persisted.rows[0]).toEqual({ changes: itemCount, refs: 0 });
  });

  it("cannot publish review rows after its durable worker lease is lost", async () => {
    const connection = await createConnection();
    const artifactId = await insertArtifact(connection.id, "d".repeat(64));
    const run = await startSyncRun(connection.id, { artifactId }, options);
    await markSyncRunParsing(run.id, options);
    const jobId = `job-${randomUUID()}`;
    await query(
      `INSERT INTO durable_jobs (
         archive_id, id, kind, payload, state, idempotency_key, attempt,
         maximum_attempts, available_at, lease_owner, lease_token, lease_expires_at
       ) VALUES ($1, $2, 'integration_snapshot_parse', $3::jsonb, 'running', $4, 1, 3,
         now(), 'worker-new', 'lease-new', now() + interval '5 minutes')`,
      [archiveId, jobId, JSON.stringify({ runId: run.id }), `parse:${run.id}`],
      options
    );

    await expect(commitIntegrationPreparation(
      {
        runId: run.id,
        connectionId: connection.id,
        artifactId,
        snapshot: snapshotInput(connection.id, "d".repeat(64)),
        changes: [],
        externalRefs: [],
        leaseFence: { jobId, leaseToken: "lease-stale" }
      },
      options
    )).rejects.toThrow(/lease|expired/i);

    const persisted = await query<{ snapshots: number; changes: number }>(
      `SELECT
         (SELECT count(*)::integer FROM integration_snapshots WHERE archive_id = $1 AND connection_id = $2) AS snapshots,
         (SELECT count(*)::integer FROM sync_changes WHERE archive_id = $1 AND run_id = $3) AS changes`,
      [archiveId, connection.id, run.id],
      options
    );
    expect(persisted.rows[0]).toEqual({ snapshots: 0, changes: 0 });
  });

  it("resets transient failures for retry and publishes a safe terminal failure only at exhaustion", async () => {
    const connection = await createConnection();
    const artifactId = await insertArtifact(connection.id, "c".repeat(64));
    const run = await startSyncRun(connection.id, { artifactId }, options);
    await markSyncRunParsing(run.id, options);
    await query(
      "UPDATE integration_artifacts SET state = 'quarantined' WHERE archive_id = $1 AND id = $2",
      [archiveId, artifactId],
      options
    );

    const retry = await resetIntegrationPreparationForRetry(run.id, options);
    expect(retry).toMatchObject({ state: "queued", run: { status: "queued" } });
    await expect(query<{ state: string }>(
      "SELECT state FROM integration_artifacts WHERE archive_id = $1 AND id = $2",
      [archiveId, artifactId],
      options
    )).resolves.toMatchObject({ rows: [{ state: "staged" }] });

    await markSyncRunParsing(run.id, options);
    const terminal = await failIntegrationPreparationTerminally(
      run.id,
      { errorCode: "source_package_invalid" },
      options
    );
    expect(terminal).toMatchObject({ state: "failed", run: { status: "failed", errorCode: "source_package_invalid" } });
    expect(JSON.stringify(terminal)).not.toMatch(/password|filename|family/i);
    await expect(query<{ state: string }>(
      "SELECT state FROM integration_artifacts WHERE archive_id = $1 AND id = $2",
      [archiveId, artifactId],
      options
    )).resolves.toMatchObject({ rows: [{ state: "rejected" }] });
  });

  it("returns a fixed actionable message when private media retention is not authorized", async () => {
    const connection = await createConnection();
    const artifactId = await insertArtifact(connection.id, "e".repeat(64));
    const run = await startSyncRun(connection.id, { artifactId }, options);
    await markSyncRunParsing(run.id, options);

    await expect(failIntegrationPreparationTerminally(
      run.id,
      { errorCode: "media_retention_not_authorized" },
      options
    )).resolves.toMatchObject({
      state: "failed",
      run: {
        errorCode: "media_retention_not_authorized",
        errorMessage: "This media package requires the private-media feature to be enabled and a current rights acknowledgement."
      }
    });
  });

  it("maps every safe terminal error code to a data-free, user-actionable message", async () => {
    const expectedMessages: Record<string, RegExp> = {
      source_package_invalid: /could not be read as a GEDCOM/i,
      plain_gedcom_required: /plain GEDCOM file/i,
      gedcom_file_too_large: /larger than this deployment's import limit/i,
      gedcom_person_limit_exceeded: /more people than this deployment/i,
      provider_unavailable: /does not accept this kind of import package/i,
      feature_disabled: /disabled for this deployment/i,
      malware_detected: /security scan/i,
      storage_unavailable: /storage was temporarily unavailable/i,
      invalid_input: /could not safely reconcile/i,
      some_future_operational_code: /could not be prepared for review/i
    };

    for (const [errorCode, expected] of Object.entries(expectedMessages)) {
      const connection = await createConnection();
      const artifactId = await insertArtifact(connection.id, randomUUID().replaceAll("-", "").padEnd(64, "f").slice(0, 64));
      const run = await startSyncRun(connection.id, { artifactId }, options);
      await markSyncRunParsing(run.id, options);

      const terminal = await failIntegrationPreparationTerminally(run.id, { errorCode }, options);
      expect(terminal.run.errorMessage, errorCode).toMatch(expected);
      // Redaction discipline: never a staged file name or storage detail.
      expect(terminal.run.errorMessage).not.toMatch(/synthetic|minio|bucket|postgres|sha256|\//i);
    }
  });

  it("reconciles a terminal durable-job failure if run finalization was interrupted", async () => {
    const connection = await createConnection();
    const artifactId = await insertArtifact(connection.id, "d".repeat(64));
    const run = await startSyncRun(connection.id, { artifactId }, options);
    await markSyncRunParsing(run.id, options);
    await query(
      `UPDATE durable_jobs
       SET state = 'failed', attempt = maximum_attempts,
           last_error_code = 'source_package_invalid',
           last_error_message = 'Job failed after reaching its attempt limit.'
       WHERE archive_id = $1 AND payload->>'runId' = $2`,
      [archiveId, run.id],
      options
    );

    await expect(reconcileTerminalIntegrationFailures(options)).resolves.toBe(1);
    await expect(getSyncRun(run.id, options)).resolves.toMatchObject({
      status: "failed",
      errorCode: "source_package_invalid"
    });
    await expect(query<{ state: string }>(
      "SELECT state FROM integration_artifacts WHERE archive_id = $1 AND id = $2",
      [archiveId, artifactId],
      options
    )).resolves.toMatchObject({ rows: [{ state: "rejected" }] });
  });

  async function createConnection() {
    return createIntegrationConnection(
      { provider: "ancestry_export", authority: "ancestry", displayName: "Synthetic atomic tree" },
      options
    );
  }

  async function insertArtifact(connectionId: string, sha256: string): Promise<string> {
    const id = `artifact-${randomUUID()}`;
    await query(
      `INSERT INTO integration_artifacts (
         archive_id, id, connection_id, file_name, artifact_key, sha256,
         content_type, size_bytes, state
       ) VALUES ($1, $2, $3, 'synthetic.ged', $4, $5, 'text/plain', 10, 'staged')`,
      [archiveId, id, connectionId, `archives/${archiveId}/integration-artifacts/${sha256}`, sha256],
      options
    );
    return id;
  }

  function snapshotInput(connectionId: string, sha256: string) {
    return {
      connectionId,
      artifactKey: `archives/${archiveId}/integration-artifacts/${sha256}`,
      sha256,
      parserVersion: "synthetic-parser-v1",
      counts: { people: 1 },
      warnings: [],
      sourceMetadata: { fixture: "wholly-synthetic" }
    };
  }
});
