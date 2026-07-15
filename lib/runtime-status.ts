import { query } from "./db";
import { datasetModes, type DatasetMode, type DeploymentMode } from "./hosted-config";
import { resolveHostedCapabilities, type HostedCapabilities } from "./hosted-capabilities";
import { demoFixtureVersion, getArchiveId } from "./workspace-store";
import { APP_VERSION } from "./app-version";

export type RuntimeStatus = {
  product: "KinSleuth";
  version: string;
  database: {
    configured: boolean;
    connected: boolean;
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
  storage: {
    configured: boolean;
  };
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

export async function getRuntimeStatus(): Promise<RuntimeStatus> {
  const databaseUrl = process.env.DATABASE_URL;
  const archiveId = getArchiveId();
  const capabilityResolution = resolveRuntimeCapabilities();
  const capabilities = capabilityResolution.status;
  const ai = getAIStatus(capabilities);
  const storage = getStorageStatus();
  const expectedDatasetMode = capabilities.valid && (
    capabilities.deploymentMode === "hosted" || Boolean(process.env.KINRESOLVE_DATASET_MODE?.trim())
  )
    ? capabilities.datasetMode
    : null;

  if (!capabilities.valid) {
    return {
      product: "KinSleuth",
      version: APP_VERSION,
      ai,
      storage,
      capabilities,
      database: {
        configured: Boolean(databaseUrl),
        connected: false,
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

  if (!databaseUrl) {
    return {
      product: "KinSleuth",
      version: APP_VERSION,
      ai,
      storage,
      capabilities,
      database: {
        configured: false,
        connected: false,
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
      storage,
      capabilities,
      database: {
        configured: true,
        connected: true,
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
      storage,
      capabilities,
      database: {
        configured: true,
        connected: false,
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
    return { configured: Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim()) };
  }

  if (backend === "s3") {
    const hasAccessKey = Boolean(process.env.S3_ACCESS_KEY_ID?.trim());
    const hasSecretKey = Boolean(process.env.S3_SECRET_ACCESS_KEY?.trim());
    return {
      configured: Boolean(process.env.S3_BUCKET?.trim()) && hasAccessKey === hasSecretKey
    };
  }

  return {
    configured: false
  };
}
