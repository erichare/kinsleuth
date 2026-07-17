import { pathToFileURL } from "node:url";

import {
  demoFixtureVersion,
  rotateCanonicalPublicDemoFixture
} from "../lib/archive-provisioning";
import { resolveDatasetConfiguration } from "../lib/hosted-config";
import { publicDemoCanonicalArchiveId } from "../lib/public-demo-config";

type Environment = Record<string, string | undefined>;

export type PublicDemoFixtureRotationRequest = {
  archiveId: typeof publicDemoCanonicalArchiveId;
  databaseUrl: string;
  expectedPreviousFixtureVersion: number;
};

export function resolvePublicDemoFixtureRotationRequest(
  argv: string[],
  environment: Environment = process.env
): PublicDemoFixtureRotationRequest {
  if (argv.length !== 2 || argv[0] !== "--from-version") {
    throw new Error("Usage: archive:rotate-public-demo-fixture -- --from-version <positive integer>.");
  }
  const expectedPreviousFixtureVersion = Number(argv[1]);
  if (!Number.isSafeInteger(expectedPreviousFixtureVersion) || expectedPreviousFixtureVersion < 1) {
    throw new Error("The previous demo fixture version must be a positive integer.");
  }
  if (expectedPreviousFixtureVersion >= demoFixtureVersion) {
    throw new Error("The previous demo fixture version must be below the compiled fixture version.");
  }

  const databaseUrl = requiredEnvironment(environment, "DATABASE_URL");
  const archiveId = requiredEnvironment(environment, "KINSLEUTH_ARCHIVE_ID");
  if (archiveId !== publicDemoCanonicalArchiveId) {
    throw new Error("Fixture rotation is restricted to the canonical public demo archive.");
  }
  const configuration = resolveDatasetConfiguration(environment);
  if (configuration.deploymentMode !== "hosted" || configuration.datasetMode !== "demo") {
    throw new Error("Fixture rotation requires the hosted demo dataset.");
  }
  if (environment.KINRESOLVE_PUBLIC_DEMO_ENABLED !== "true") {
    throw new Error("The public demo must be enabled for fixture rotation.");
  }
  const expectedConfirmation = [
    "ROTATE-DEMO-FIXTURE",
    publicDemoCanonicalArchiveId,
    expectedPreviousFixtureVersion,
    demoFixtureVersion
  ].join(":");
  if (environment.DEMO_FIXTURE_ROTATION_CONFIRMATION !== expectedConfirmation) {
    throw new Error(`The exact fixture rotation confirmation is required: ${expectedConfirmation}.`);
  }

  return {
    archiveId: publicDemoCanonicalArchiveId,
    databaseUrl,
    expectedPreviousFixtureVersion
  };
}

export async function runPublicDemoFixtureRotationCommand(
  argv: string[] = process.argv.slice(2),
  environment: Environment = process.env
): Promise<void> {
  const request = resolvePublicDemoFixtureRotationRequest(argv, environment);
  const result = await rotateCanonicalPublicDemoFixture(
    request.expectedPreviousFixtureVersion,
    {
      archiveId: request.archiveId,
      databaseUrl: request.databaseUrl,
      datasetMode: "demo"
    }
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function requiredEnvironment(environment: Environment, name: string): string {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required for public demo fixture rotation.`);
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPublicDemoFixtureRotationCommand().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
