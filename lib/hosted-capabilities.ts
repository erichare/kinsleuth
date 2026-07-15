import { resolveDatasetConfiguration, type DatasetMode, type DeploymentMode } from "./hosted-config";

export const hostedGedcomFileLimitBytes = 10 * 1024 * 1024;
export const hostedGedcomPersonLimit = 40_000;

export const hostedCapabilityEnvironmentNames = [
  "KINRESOLVE_DNA_ENABLED",
  "KINRESOLVE_EXTERNAL_AI_ENABLED",
  "KINRESOLVE_PUBLIC_ARCHIVE_ENABLED",
  "KINRESOLVE_PUBLIC_PUBLISHING_ENABLED",
  "KINRESOLVE_EVIDENCE_BINARY_UPLOADS_ENABLED",
  "KINRESOLVE_PACKAGE_MEDIA_ENABLED",
  "KINRESOLVE_PLAIN_GEDCOM_ENABLED"
] as const;

export type HostedCapabilityName =
  | "dna"
  | "externalAi"
  | "publicArchive"
  | "publicPublishing"
  | "evidenceBinaryUploads"
  | "packageMedia"
  | "plainGedcom";

export type HostedCapabilities = Record<HostedCapabilityName, boolean> & {
  deploymentMode: DeploymentMode;
  datasetMode: DatasetMode;
  gedcomFileLimitBytes: number;
  gedcomPersonLimit: number;
};

type Environment = Record<string, string | undefined>;

const capabilitySettings: Record<HostedCapabilityName, (typeof hostedCapabilityEnvironmentNames)[number]> = {
  dna: "KINRESOLVE_DNA_ENABLED",
  externalAi: "KINRESOLVE_EXTERNAL_AI_ENABLED",
  publicArchive: "KINRESOLVE_PUBLIC_ARCHIVE_ENABLED",
  publicPublishing: "KINRESOLVE_PUBLIC_PUBLISHING_ENABLED",
  evidenceBinaryUploads: "KINRESOLVE_EVIDENCE_BINARY_UPLOADS_ENABLED",
  packageMedia: "KINRESOLVE_PACKAGE_MEDIA_ENABLED",
  plainGedcom: "KINRESOLVE_PLAIN_GEDCOM_ENABLED"
};

export class HostedCapabilityError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code = "CAPABILITY_DISABLED", status = 404) {
    super(message);
    this.name = "HostedCapabilityError";
    this.code = code;
    this.status = status;
  }
}

export function resolveHostedCapabilities(environment: Environment = process.env): HostedCapabilities {
  const dataset = resolveDatasetConfiguration(environment);
  const hosted = dataset.deploymentMode === "hosted";

  return {
    deploymentMode: dataset.deploymentMode,
    datasetMode: dataset.datasetMode,
    dna: capabilityValue("dna", true, hosted, environment),
    externalAi: capabilityValue("externalAi", true, hosted, environment),
    publicArchive: capabilityValue("publicArchive", true, hosted, environment),
    publicPublishing: capabilityValue("publicPublishing", true, hosted, environment),
    evidenceBinaryUploads: capabilityValue("evidenceBinaryUploads", true, hosted, environment),
    packageMedia: capabilityValue("packageMedia", true, hosted, environment),
    plainGedcom: capabilityValue("plainGedcom", true, hosted, environment),
    gedcomFileLimitBytes: hosted ? hostedGedcomFileLimitBytes : 25 * 1024 * 1024,
    gedcomPersonLimit: hosted ? hostedGedcomPersonLimit : Number.MAX_SAFE_INTEGER
  };
}

export function requireHostedCapability(
  capability: HostedCapabilityName,
  environment: Environment = process.env
): HostedCapabilities {
  const capabilities = resolveHostedCapabilities(environment);
  if (!capabilities[capability]) {
    throw new HostedCapabilityError("This capability is not available for this deployment.");
  }
  return capabilities;
}

export function validateHostedGedcomFile(
  file: { fileName: string; contentType?: string; size: number },
  environment: Environment = process.env
): void {
  const capabilities = requireHostedCapability("plainGedcom", environment);
  const fileName = file.fileName.trim();
  const contentType = file.contentType?.trim().toLowerCase() ?? "";
  if (
    !/\.(?:ged|gedcom)$/i.test(fileName)
    || !["", "text/plain", "application/octet-stream", "application/x-gedcom"].includes(contentType)
  ) {
    throw new HostedCapabilityError(
      "Only a plain GEDCOM file ending in .ged or .gedcom is available for this deployment.",
      "PLAIN_GEDCOM_REQUIRED",
      415
    );
  }
  if (!Number.isSafeInteger(file.size) || file.size <= 0) {
    throw new HostedCapabilityError("The GEDCOM file size is invalid.", "GEDCOM_FILE_INVALID", 400);
  }
  if (file.size > capabilities.gedcomFileLimitBytes) {
    throw new HostedCapabilityError(
      "The GEDCOM file exceeds this deployment's import limit.",
      "GEDCOM_FILE_TOO_LARGE",
      413
    );
  }
}

export function validateHostedGedcomPeople(
  people: number,
  environment: Environment = process.env
): void {
  const capabilities = requireHostedCapability("plainGedcom", environment);
  if (!Number.isSafeInteger(people) || people < 0) {
    throw new HostedCapabilityError("The parsed GEDCOM person count is invalid.", "GEDCOM_PERSON_COUNT_INVALID", 400);
  }
  if (people > capabilities.gedcomPersonLimit) {
    throw new HostedCapabilityError(
      "The GEDCOM contains more people than this deployment can safely import.",
      "GEDCOM_PERSON_LIMIT_EXCEEDED",
      413
    );
  }
}

function capabilityValue(
  capability: HostedCapabilityName,
  selfHostedDefault: boolean,
  hosted: boolean,
  environment: Environment
): boolean {
  const setting = capabilitySettings[capability];
  const raw = environment[setting]?.trim().toLowerCase();
  if (!raw) {
    if (hosted) {
      throw new Error(`${setting} is required for a hosted deployment.`);
    }
    return selfHostedDefault;
  }
  if (raw !== "true" && raw !== "false") {
    throw new Error(`${setting} must be exactly true or false.`);
  }
  return raw === "true";
}
