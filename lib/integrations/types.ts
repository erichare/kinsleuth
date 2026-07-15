export const integrationProviders = [
  "ancestry_export",
  "family_tree_maker",
  "rootsmagic",
  "gedcom",
  "ancestry_api"
] as const;

export type IntegrationProvider = (typeof integrationProviders)[number];

export const DESKTOP_MEDIA_RIGHTS_ACKNOWLEDGEMENT_VERSION = "desktop-media-rights-v1";
export const MEDIA_OWNERSHIP_ATTESTATION_VERSION = "media-ownership-v1";

export type MediaRightsAcknowledgement = {
  version: string;
  actorId: string;
  acknowledgedAt: string;
};

export type IntegrationMedia = {
  id: string;
  connectionId: string;
  snapshotId: string;
  runId: string;
  artifactId: string;
  provider: "family_tree_maker" | "rootsmagic";
  sourceArtifactSha256: string;
  sourceGedcomPath: string;
  sourceNormalizedPath: string;
  sourceArchivePath: string;
  sha256: string;
  mimeType: string;
  size: number;
  licenseClass: "third_party_restricted" | "user_owned";
  privacy: "private";
  publishable: false;
  aiEligible: false;
  rightsAcknowledgement: MediaRightsAcknowledgement;
  ownershipAttestation?: {
    version: string;
    actorId: string;
    attestedAt: string;
  };
  createdAt: string;
  updatedAt: string;
};

export type IntegrationCapabilities = {
  snapshotImport: boolean;
  incrementalPull: boolean;
  media: boolean;
  oauth: boolean;
  writeback: boolean;
};

export type IntegrationConnectionStatus = "active" | "disconnected" | "error";

export type IntegrationConnection = {
  id: string;
  provider: IntegrationProvider;
  authority: string;
  displayName: string;
  status: IntegrationConnectionStatus;
  capabilities: IntegrationCapabilities;
  remoteAccountId?: string;
  remoteTreeId?: string;
  lastAppliedSnapshotId?: string;
  lastRefreshedAt?: string;
  disconnectedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type IntegrationSnapshot = {
  id: string;
  connectionId: string;
  artifactKey: string;
  sha256: string;
  parserVersion: string;
  counts: Record<string, number>;
  warnings: string[];
  sourceMetadata: Record<string, unknown>;
  createdAt: string;
};

export type ExternalEntityRef = {
  id: string;
  connectionId: string;
  snapshotId: string;
  entityType: string;
  externalId: string;
  localEntityId: string;
  createdAt: string;
  updatedAt: string;
};

export type SyncRunStatus =
  | "queued"
  | "parsing"
  | "review_ready"
  | "applying"
  | "applied"
  | "cancel_requested"
  | "cancelled"
  | "failed"
  | "rolled_back";

export type SyncRun = {
  id: string;
  connectionId: string;
  artifactId?: string;
  baseSnapshotId?: string;
  incomingSnapshotId?: string;
  status: SyncRunStatus;
  backupId?: string;
  appliedChangeCount: number;
  appliedAt?: string;
  cancelRequestedAt?: string;
  rolledBackAt?: string;
  rolledBackBy?: string;
  errorCode?: string;
  errorMessage?: string;
  mediaRightsAcknowledgement?: MediaRightsAcknowledgement;
  createdAt: string;
  updatedAt: string;
};

export type SyncChangeClassification = "remote_only" | "local_only" | "same" | "conflict" | "deletion";
export type SyncProposedAction = "accept_incoming" | "keep_local" | "no_op" | "review";
export type SyncResolution = Exclude<SyncProposedAction, "review">;

export type SyncChange = {
  id: string;
  runId: string;
  entityType: string;
  externalId?: string;
  localEntityId?: string;
  baseHash?: string;
  localHash?: string;
  incomingHash?: string;
  classification: SyncChangeClassification;
  proposedAction: SyncProposedAction;
  resolution?: SyncResolution;
  resolutionPayload: Record<string, unknown>;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};
