import { createHash } from "node:crypto";
import { apiV1ConfigurationStatus, type ApiV1ConfigurationStatus } from "./beta-api-tokens";
import { getPool, query } from "./db";
import { isDatabaseTransportVerified } from "./connection-string";
import {
  databaseIdentityPattern,
  readDatabaseIdentity
} from "./database-attestation";
import { datasetModes, type DatasetMode, type DeploymentMode } from "./hosted-config";
import { resolveHostedCapabilities, type HostedCapabilities } from "./hosted-capabilities";
import { demoFixtureVersion, getArchiveId } from "./workspace-store";
import { APP_VERSION } from "./app-version";
import { createConfiguredArchiveObjectStorage } from "./storage/object-storage";
import { getScheduledWritesStatus, type ScheduledWritesStatus } from "./scheduled-writes";

export type RuntimeStatus = {
  product: "KinSleuth";
  version: string;
  database: {
    configured: boolean;
    connected: boolean;
    identityConfigured: boolean;
    identity: string | null;
    identityMatchesConfigured: boolean;
    transportVerified: boolean;
    archiveId: string;
    archiveName: string;
    archiveTagline: string;
    archiveCount: number;
    peopleCount: number;
    caseCount: number;
    aiRunCount: number;
    provisioned: boolean;
    datasetMode: DatasetMode | null;
    expectedDatasetMode: DatasetMode | null;
    datasetModeMatches: boolean;
    demoFixtureVersion: number | null;
    error?: string;
  };
  ai: {
    enabled: boolean;
    configured: boolean;
    baseUrl: string;
    chatModel: string;
    embeddingModel: string;
    mode: "responses" | "chat";
  };
  api: ApiV1ConfigurationStatus;
  storage: {
    configured: boolean;
    identityConfigured: boolean;
    identityVerified: boolean;
  };
  scheduledWrites: ScheduledWritesStatus;
  capabilities: {
    valid: boolean;
    deploymentMode: DeploymentMode | null;
    datasetMode: DatasetMode | null;
    dna: boolean;
    externalAi: boolean;
    publicArchive: boolean;
    publicPublishing: boolean;
    evidenceBinaryUploads: boolean;
    packageMedia: boolean;
    plainGedcom: boolean;
    gedcomFileLimitBytes: number | null;
    gedcomPersonLimit: number | null;
  };
};

export function isRuntimeReady(status: RuntimeStatus): boolean {
  const storageFreeHostedDemo = status.capabilities.deploymentMode === "hosted"
    && status.capabilities.datasetMode === "demo"
    && !status.capabilities.evidenceBinaryUploads
    && !status.capabilities.packageMedia
    && !status.capabilities.plainGedcom;
  return status.capabilities.valid
    && status.scheduledWrites.valid
    && status.api.configured
    && status.database.connected
    && status.database.provisioned
    && status.database.datasetModeMatches
    && (status.capabilities.deploymentMode !== "hosted" || (
      status.database.identityConfigured
      && status.database.identityMatchesConfigured
      && status.database.transportVerified
    ))
    && (storageFreeHostedDemo || (
      status.storage.configured
      && (status.capabilities.deploymentMode !== "hosted" || (
        status.storage.identityConfigured && status.storage.identityVerified
      ))
    ));
}

export async function getRuntimeStatus(): Promise<RuntimeStatus> {
  const databaseUrl = process.env.DATABASE_URL;
  const archiveId = getArchiveId();
  const capabilityResolution = resolveRuntimeCapabilities();
  const capabilities = capabilityResolution.status;
  const ai = getAIStatus(capabilities);
  const api = apiV1ConfigurationStatus();
  const storage = await getStorageIdentityStatus(archiveId);
  const scheduledWrites = getScheduledWritesStatus();
  const expectedDatasetMode = capabilities.valid && (
    capabilities.deploymentMode === "hosted" || Boolean(process.env.KINRESOLVE_DATASET_MODE?.trim())
  )
    ? capabilities.datasetMode
    : null;

  if (!capabilities.valid) {
    const identityStatus = configuredDatabaseIdentityStatus(databaseUrl);
    return {
      product: "KinSleuth",
      version: APP_VERSION,
      ai,
      api,
      storage,
      scheduledWrites,
      capabilities,
      database: {
        configured: Boolean(databaseUrl),
        connected: false,
        ...identityStatus,
        archiveId,
        archiveName: "",
        archiveTagline: "",
        archiveCount: 0,
        peopleCount: 0,
        caseCount: 0,
        aiRunCount: 0,
        provisioned: false,
        datasetMode: null,
        expectedDatasetMode: null,
        datasetModeMatches: false,
        demoFixtureVersion: null,
        error: capabilityResolution.error ?? "Hosted capability configuration is invalid"
      }
    };
  }

  const identityStatus = await getDatabaseIdentityStatus(databaseUrl);

  if (!databaseUrl) {
    return {
      product: "KinSleuth",
      version: APP_VERSION,
      ai,
      api,
      storage,
      scheduledWrites,
      capabilities,
      database: {
        configured: false,
        connected: false,
        ...identityStatus,
        archiveId,
        archiveName: "",
        archiveTagline: "",
        archiveCount: 0,
        peopleCount: 0,
        caseCount: 0,
        aiRunCount: 0,
        provisioned: false,
        datasetMode: null,
        expectedDatasetMode,
        datasetModeMatches: false,
        demoFixtureVersion: null,
        error: "DATABASE_URL is not configured"
      }
    };
  }

  try {
    const result = await query<{
      archive_id: string | null;
      archive_name: string | null;
      archive_tagline: string | null;
      dataset_mode: string | null;
      demo_fixture_version: number | null;
      archive_count: string;
      people_count: string;
      case_count: string;
      ai_run_count: string;
    }>(
      `SELECT
        (SELECT id FROM archives WHERE id = $1) AS archive_id,
        (SELECT name FROM archives WHERE id = $1) AS archive_name,
        (SELECT tagline FROM archives WHERE id = $1) AS archive_tagline,
        (SELECT dataset_mode FROM archives WHERE id = $1) AS dataset_mode,
        (SELECT demo_fixture_version FROM archives WHERE id = $1) AS demo_fixture_version,
        (SELECT COUNT(*) FROM archives) AS archive_count,
        (SELECT COUNT(*) FROM people WHERE archive_id = $1) AS people_count,
        (SELECT COUNT(*) FROM research_cases WHERE archive_id = $1) AS case_count,
        (SELECT COUNT(*) FROM ai_runs WHERE archive_id = $1) AS ai_run_count`,
      [archiveId],
      { databaseUrl }
    );
    const row = result.rows[0];
    const provisioned = Boolean(row?.archive_id);
    const datasetMode = row?.dataset_mode && isDatasetMode(row.dataset_mode) ? row.dataset_mode : null;
    const fixtureMatches = datasetMode !== "demo" || row?.demo_fixture_version === demoFixtureVersion;
    const datasetModeMatches =
      provisioned && datasetMode !== null && (!expectedDatasetMode || datasetMode === expectedDatasetMode) && fixtureMatches;
    const provisioningError = !provisioned
      ? `Archive ${archiveId} is not provisioned.`
      : !datasetModeMatches
        ? `Archive ${archiveId} dataset mode does not match the configured runtime.`
        : undefined;

    return {
      product: "KinSleuth",
      version: APP_VERSION,
      ai,
      api,
      storage,
      scheduledWrites,
      capabilities,
      database: {
        configured: true,
        connected: true,
        ...identityStatus,
        archiveId,
        archiveName: row?.archive_name ?? "",
        archiveTagline: row?.archive_tagline ?? "",
        archiveCount: Number(row?.archive_count ?? 0),
        peopleCount: Number(row?.people_count ?? 0),
        caseCount: Number(row?.case_count ?? 0),
        aiRunCount: Number(row?.ai_run_count ?? 0),
        provisioned,
        datasetMode,
        expectedDatasetMode,
        datasetModeMatches,
        demoFixtureVersion: row?.demo_fixture_version ?? null,
        ...(provisioningError ? { error: provisioningError } : {})
      }
    };
  } catch (error) {
    return {
      product: "KinSleuth",
      version: APP_VERSION,
      ai,
      api,
      storage,
      scheduledWrites,
      capabilities,
      database: {
        configured: true,
        connected: false,
        ...identityStatus,
        archiveId,
        archiveName: "",
        archiveTagline: "",
        archiveCount: 0,
        peopleCount: 0,
        caseCount: 0,
        aiRunCount: 0,
        provisioned: false,
        datasetMode: null,
        expectedDatasetMode,
        datasetModeMatches: false,
        demoFixtureVersion: null,
        error: error instanceof Error ? error.message : "Database health check failed"
      }
    };
  }
}

async function getDatabaseIdentityStatus(databaseUrl: string | undefined): Promise<{
  identityConfigured: boolean;
  identity: string | null;
  identityMatchesConfigured: boolean;
  transportVerified: boolean;
}> {
  const configured = configuredDatabaseIdentityStatus(databaseUrl);
  const configuredIdentity = process.env.KINRESOLVE_DATABASE_IDENTITY?.trim() ?? "";
  if (!databaseUrl) {
    return configured;
  }

  let identity: string | null = null;
  try {
    identity = (await readDatabaseIdentity(getPool({ databaseUrl }))).fingerprint;
  } catch {
    // The public health contract reports only the safe readiness booleans below.
  }
  return {
    identityConfigured: configured.identityConfigured,
    identity,
    identityMatchesConfigured: configured.identityConfigured && identity === configuredIdentity,
    transportVerified: configured.transportVerified
  };
}

function configuredDatabaseIdentityStatus(databaseUrl: string | undefined): {
  identityConfigured: boolean;
  identity: null;
  identityMatchesConfigured: false;
  transportVerified: boolean;
} {
  const configuredIdentity = process.env.KINRESOLVE_DATABASE_IDENTITY?.trim() ?? "";
  return {
    identityConfigured: databaseIdentityPattern.test(configuredIdentity),
    identity: null,
    identityMatchesConfigured: false,
    transportVerified: Boolean(databaseUrl && isDatabaseTransportVerified(databaseUrl))
  };
}

function isDatasetMode(value: string): value is DatasetMode {
  return datasetModes.some((mode) => mode === value);
}

export function getAIStatus(
  capabilities: RuntimeStatus["capabilities"] = resolveRuntimeCapabilities().status
): RuntimeStatus["ai"] {
  const enabled = capabilities.valid && capabilities.externalAi;
  return {
    enabled,
    configured: enabled && Boolean(process.env.AI_API_KEY || process.env.OPENAI_API_KEY),
    baseUrl: process.env.AI_BASE_URL ?? "https://api.openai.com/v1",
    chatModel: process.env.AI_CHAT_MODEL ?? "gpt-5-mini",
    embeddingModel: process.env.AI_EMBEDDING_MODEL ?? "text-embedding-3-small",
    mode: process.env.AI_API_MODE === "chat" ? "chat" : "responses"
  };
}

function resolveRuntimeCapabilities(): {
  status: RuntimeStatus["capabilities"];
  error?: string;
} {
  try {
    const capabilities = resolveHostedCapabilities();
    return {
      status: {
        valid: true,
        ...publicCapabilityManifest(capabilities)
      }
    };
  } catch (error) {
    return {
      status: {
        valid: false,
        deploymentMode: null,
        datasetMode: null,
        dna: false,
        externalAi: false,
        publicArchive: false,
        publicPublishing: false,
        evidenceBinaryUploads: false,
        packageMedia: false,
        plainGedcom: false,
        gedcomFileLimitBytes: null,
        gedcomPersonLimit: null
      },
      error: error instanceof Error ? error.message : "Hosted capability configuration is invalid"
    };
  }
}

function publicCapabilityManifest(capabilities: HostedCapabilities): HostedCapabilities {
  return {
    deploymentMode: capabilities.deploymentMode,
    datasetMode: capabilities.datasetMode,
    dna: capabilities.dna,
    externalAi: capabilities.externalAi,
    publicArchive: capabilities.publicArchive,
    publicPublishing: capabilities.publicPublishing,
    evidenceBinaryUploads: capabilities.evidenceBinaryUploads,
    packageMedia: capabilities.packageMedia,
    plainGedcom: capabilities.plainGedcom,
    gedcomFileLimitBytes: capabilities.gedcomFileLimitBytes,
    gedcomPersonLimit: capabilities.gedcomPersonLimit
  };
}

export function getStorageStatus(): RuntimeStatus["storage"] {
  const backend = process.env.KINRESOLVE_OBJECT_STORAGE_BACKEND?.trim().toLowerCase();

  if (backend === "vercel-blob") {
    return storageStatus(Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim()));
  }

  if (backend === "s3") {
    const hasAccessKey = Boolean(process.env.S3_ACCESS_KEY_ID?.trim());
    const hasSecretKey = Boolean(process.env.S3_SECRET_ACCESS_KEY?.trim());
    return storageStatus(Boolean(process.env.S3_BUCKET?.trim()) && hasAccessKey === hasSecretKey);
  }

  return storageStatus(false);
}

function storageStatus(configured: boolean): RuntimeStatus["storage"] {
  const identityConfigured = /^[a-f0-9]{64}$/.test(
    process.env.KINRESOLVE_OBJECT_STORAGE_IDENTITY?.trim() ?? ""
  );
  return { configured, identityConfigured, identityVerified: false };
}

async function getStorageIdentityStatus(archiveId: string): Promise<RuntimeStatus["storage"]> {
  const status = getStorageStatus();
  const identity = process.env.KINRESOLVE_OBJECT_STORAGE_IDENTITY?.trim() ?? "";
  if (!status.configured || !status.identityConfigured) return status;

  try {
    const bytes = await createConfiguredArchiveObjectStorage().read({
      archiveId,
      key: `archives/${archiveId}/release-readiness/${identity}`
    });
    const actual = createHash("sha256").update(bytes).digest("hex");
    return { ...status, identityVerified: actual === identity };
  } catch {
    return status;
  }
}
