import type {
  IntegrationConnection,
  IntegrationMedia,
  SyncChange,
  SyncChangeClassification,
  SyncProposedAction,
  SyncRun,
  SyncRunStatus
} from "./types";

/**
 * Deliberately small response shapes for the authenticated Data Sources UI.
 * Store models include hashes, actor IDs, provenance links, and audit timestamps
 * that are useful to server-side processing but are not part of the browser API.
 */
export type PublicSyncRun = {
  id: string;
  connectionId: string;
  status: SyncRunStatus;
  artifactId?: string;
  errorMessage?: string;
  backupAvailable: boolean;
};

export type PublicIntegrationConnection = Pick<
  IntegrationConnection,
  "id" | "provider" | "authority" | "displayName" | "status" | "capabilities" | "lastRefreshedAt"
>;

export type PublicSyncChange = {
  id: string;
  entityType: string;
  externalId?: string;
  classification: SyncChangeClassification;
  proposedAction: SyncProposedAction;
  resolutionPayload: Record<string, unknown>;
};

export type PublicIntegrationMedia = {
  id: string;
  provider: "family_tree_maker" | "rootsmagic";
  fileName: string;
  mimeType: string;
  size: number;
  licenseClass: "third_party_restricted" | "user_owned";
  privacy: "private";
  publishable: false;
  aiEligible: false;
};

export function toPublicIntegrationConnection(
  connection: IntegrationConnection
): PublicIntegrationConnection {
  return {
    id: connection.id,
    provider: connection.provider,
    authority: connection.authority,
    displayName: connection.displayName,
    status: connection.status,
    capabilities: { ...connection.capabilities },
    ...(connection.lastRefreshedAt ? { lastRefreshedAt: connection.lastRefreshedAt } : {})
  };
}

export function toPublicSyncRun(run: SyncRun): PublicSyncRun {
  return {
    id: run.id,
    connectionId: run.connectionId,
    status: run.status,
    ...(run.artifactId ? { artifactId: run.artifactId } : {}),
    ...(run.errorMessage ? { errorMessage: run.errorMessage } : {}),
    backupAvailable: Boolean(run.backupId)
  };
}

export function toPublicSyncChange(change: SyncChange): PublicSyncChange {
  return {
    id: change.id,
    entityType: change.entityType,
    ...(change.externalId ? { externalId: change.externalId } : {}),
    classification: change.classification,
    proposedAction: change.proposedAction,
    resolutionPayload: change.resolutionPayload
  };
}

export function toPublicIntegrationMedia(media: IntegrationMedia): PublicIntegrationMedia {
  return {
    id: media.id,
    provider: media.provider,
    fileName: media.sourceArchivePath.replace(/\\/g, "/").split("/").at(-1) || "Private media file",
    mimeType: media.mimeType,
    size: media.size,
    licenseClass: media.licenseClass,
    privacy: media.privacy,
    publishable: media.publishable,
    aiEligible: media.aiEligible
  };
}
