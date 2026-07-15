import { createHash } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";

import { withClient, type DatabaseOptions } from "./db";
import { readWorkspaceSnapshot, type WorkspaceData } from "./workspace-store";

type ExportOptions = DatabaseOptions & { archiveId: string; userId: string };

export type ResearchArchiveExport = Readonly<{
  content: string;
  fileName: string;
  manifestDigest: string;
}>;

export async function createResearchArchiveExport(
  options: ExportOptions,
  now = new Date()
): Promise<ResearchArchiveExport> {
  const snapshot = await withClient(options, async (client) => {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    try {
      const workspace = await readWorkspaceSnapshot(client, options);
      const participant = await readParticipantMetadata(client, options);
      const legal = await readLegalMetadata(client, options);
      const connections = await readIntegrationConnections(client, options);
      const artifacts = await readIntegrationArtifacts(client, options);
      const snapshots = await readIntegrationSnapshots(client, options);
      const runs = await readSyncRuns(client, options);
      const changes = await readSyncChanges(client, options);
      const media = await readIntegrationMedia(client, options);
      await client.query("COMMIT");
      return { workspace, participant, legal, connections, artifacts, snapshots, runs, changes, media };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });

  const data = {
    participant: snapshot.participant,
    legal: snapshot.legal,
    archive: sanitizeWorkspace(snapshot.workspace),
    integrations: {
      connections: snapshot.connections,
      artifacts: snapshot.artifacts,
      snapshots: snapshot.snapshots,
      runs: snapshot.runs,
      changes: snapshot.changes,
      media: snapshot.media
    }
  };
  const dataSha256 = sha256(JSON.stringify(data));
  const generatedAt = now.toISOString();
  const bundle = {
    manifest: {
      schemaVersion: 1,
      product: "Kin Resolve",
      exportType: "owner-research-archive",
      generatedAt,
      archiveId: options.archiveId,
      dataSha256,
      excludedClasses: [
        "account-passwords-and-provider-credentials",
        "sessions-cookies-and-bearer-tokens",
        "ip-addresses-and-user-agents",
        "operator-nonces-and-rate-limit-keys",
        "database-and-object-provider-identities",
        "object-storage-keys-and-blob-urls",
        "worker-leases-and-idempotency-secrets"
      ]
    },
    data
  };
  const content = `${JSON.stringify(bundle, null, 2)}\n`;
  return {
    content,
    fileName: `kin-resolve-research-archive-${generatedAt.slice(0, 10)}.json`,
    manifestDigest: sha256(content)
  };
}

export function sanitizeWorkspace(workspace: WorkspaceData) {
  return {
    version: workspace.version,
    name: workspace.archiveName,
    tagline: workspace.archiveTagline,
    updatedAt: workspace.updatedAt,
    people: workspace.people,
    cases: workspace.cases,
    sources: workspace.sources.map(({ storageKey: _storageKey, ...source }) => source),
    dnaMatches: workspace.dnaMatches,
    aiRuns: workspace.aiRuns.map(({ error: _error, ...run }) => run),
    imports: workspace.imports,
    rawRecords: workspace.rawRecords,
    backups: workspace.backups.map(({ storageKey: _storageKey, ...backup }) => backup)
  };
}

async function readParticipantMetadata(client: PoolClient, options: ExportOptions) {
  const result = await client.query<{
    name: string;
    email: string;
    emailVerified: boolean;
    accountCreatedAt: Date;
    accountUpdatedAt: Date;
    role: string;
    membershipCreatedAt: Date;
  }>(
    `SELECT participant.name,
            participant.email,
            participant."emailVerified" AS "emailVerified",
            participant."createdAt" AS "accountCreatedAt",
            participant."updatedAt" AS "accountUpdatedAt",
            membership.role,
            membership.created_at AS "membershipCreatedAt"
     FROM public."user" AS participant
     JOIN public.memberships AS membership
       ON membership.user_id = participant.id
      AND membership.archive_id = $1
     WHERE participant.id = $2`,
    [options.archiveId, options.userId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("Participant export identity is unavailable.");
  return row;
}

async function readLegalMetadata(client: PoolClient, options: ExportOptions) {
  return rows(
    client,
    `SELECT acceptance.acceptance_method AS "acceptanceMethod",
            acceptance.request_id::text AS "requestId",
            acceptance.accepted_at AS "acceptedAt",
            acceptance.participation_terms_version AS "participationTermsVersion",
            acceptance.participation_terms_sha256 AS "participationTermsSha256",
            acceptance.participation_terms_url AS "participationTermsUrl",
            acceptance.privacy_notice_version AS "privacyNoticeVersion",
            acceptance.privacy_notice_sha256 AS "privacyNoticeSha256",
            acceptance.privacy_notice_url AS "privacyNoticeUrl",
            acceptance.beta_boundary_version AS "betaBoundaryVersion",
            acceptance.beta_boundary_sha256 AS "betaBoundarySha256",
            acceptance.beta_boundary_url AS "betaBoundaryUrl",
            invitation.purpose,
            invitation.role
     FROM public.beta_terms_acceptances AS acceptance
     JOIN public.beta_invitations AS invitation
       ON invitation.id = acceptance.invitation_id
      AND invitation.archive_id = acceptance.archive_id
      AND invitation.consumed_by_user_id = acceptance.user_id
     WHERE acceptance.archive_id = $1
       AND acceptance.user_id = $2
     ORDER BY acceptance.accepted_at ASC, acceptance.id ASC`,
    options,
    [options.archiveId, options.userId]
  );
}

async function readIntegrationConnections(client: PoolClient, options: ExportOptions) {
  return rows(
    client,
    `SELECT id, provider, authority, display_name AS "displayName", status,
            capabilities, last_refreshed_at AS "lastRefreshedAt",
            disconnected_at AS "disconnectedAt", created_at AS "createdAt",
            updated_at AS "updatedAt"
     FROM public.integration_connections
     WHERE archive_id = $1 ORDER BY created_at ASC, id ASC`,
    options
  );
}

async function readIntegrationArtifacts(client: PoolClient, options: ExportOptions) {
  return rows(
    client,
    `SELECT id, connection_id AS "connectionId", file_name AS "fileName",
            sha256, content_type AS "contentType", size_bytes AS "sizeBytes",
            state, created_at AS "createdAt", updated_at AS "updatedAt",
            completed_at AS "completedAt", deleted_at AS "deletedAt"
     FROM public.integration_artifacts
     WHERE archive_id = $1 ORDER BY created_at ASC, id ASC`,
    options
  );
}

async function readIntegrationSnapshots(client: PoolClient, options: ExportOptions) {
  return rows(
    client,
    `SELECT id, connection_id AS "connectionId", sha256,
            parser_version AS "parserVersion", counts, warnings,
            created_at AS "createdAt"
     FROM public.integration_snapshots
     WHERE archive_id = $1 ORDER BY created_at ASC, id ASC`,
    options
  );
}

async function readSyncRuns(client: PoolClient, options: ExportOptions) {
  return rows(
    client,
    `SELECT id, connection_id AS "connectionId", artifact_id AS "artifactId",
            base_snapshot_id AS "baseSnapshotId",
            incoming_snapshot_id AS "incomingSnapshotId", status,
            applied_change_count AS "appliedChangeCount", applied_at AS "appliedAt",
            rolled_back_at AS "rolledBackAt", cancel_requested_at AS "cancelRequestedAt",
            error_code AS "errorCode", created_at AS "createdAt", updated_at AS "updatedAt"
     FROM public.sync_runs
     WHERE archive_id = $1 ORDER BY created_at ASC, id ASC`,
    options
  );
}

async function readSyncChanges(client: PoolClient, options: ExportOptions) {
  return rows(
    client,
    `SELECT id, run_id AS "runId", entity_type AS "entityType",
            local_entity_id AS "localEntityId", classification,
            proposed_action AS "proposedAction", resolution,
            resolution_payload AS "resolutionPayload", sort_order AS "sortOrder",
            created_at AS "createdAt", updated_at AS "updatedAt"
     FROM public.sync_changes
     WHERE archive_id = $1 ORDER BY run_id ASC, sort_order ASC, id ASC`,
    options
  );
}

async function readIntegrationMedia(client: PoolClient, options: ExportOptions) {
  return rows(
    client,
    `SELECT id, connection_id AS "connectionId", snapshot_id AS "snapshotId",
            run_id AS "runId", artifact_id AS "artifactId", sha256,
            mime_type AS "mimeType", size_bytes AS "sizeBytes", license_class AS "licenseClass",
            privacy, publishable, ai_eligible AS "aiEligible",
            rights_acknowledgement_version AS "rightsAcknowledgementVersion",
            rights_acknowledged_at AS "rightsAcknowledgedAt",
            ownership_attestation_version AS "ownershipAttestationVersion",
            ownership_attested_at AS "ownershipAttestedAt",
            created_at AS "createdAt", updated_at AS "updatedAt"
     FROM public.integration_media_objects
     WHERE archive_id = $1 ORDER BY created_at ASC, id ASC`,
    options
  );
}

async function rows<T extends QueryResultRow = QueryResultRow>(
  client: PoolClient,
  text: string,
  options: ExportOptions,
  values: unknown[] = [options.archiveId]
) {
  return (await client.query<T>(text, values)).rows;
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
