import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));

describe("Docker deployment contract", () => {
  it("excludes environment secrets from the build context while preserving the example", async () => {
    const contents = await readFile(`${repositoryRoot}.dockerignore`, "utf8");
    const patterns = contents.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

    expect(patterns).toContain(".env");
    expect(patterns).toContain(".env.*");
    expect(patterns).toContain("!.env.example");
    expect(patterns.indexOf("!.env.example")).toBeGreaterThan(patterns.indexOf(".env.*"));
  });

  it("excludes common private archive data directories from the build context", async () => {
    const contents = await readFile(`${repositoryRoot}.dockerignore`, "utf8");
    const patterns = contents
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/^\//, "").replace(/\/$/, ""))
      .filter(Boolean);

    expect(patterns).toEqual(expect.arrayContaining(["data", "uploads", "storage"]));
  });

  it("requires one operator-supplied MinIO credential pair across every Compose service", async () => {
    const compose = await readFile(`${repositoryRoot}docker-compose.yml`, "utf8");
    const app = serviceSection(compose, "app");
    const worker = serviceSection(compose, "worker");
    const minio = serviceSection(compose, "minio");
    const minioInit = serviceSection(compose, "minio-init");

    for (const service of [app, worker]) {
      expect(service).toMatch(/MINIO_ROOT_USER:\s*\$\{MINIO_ROOT_USER:\?[^}]+\}/);
      expect(service).toMatch(/MINIO_ROOT_PASSWORD:\s*\$\{MINIO_ROOT_PASSWORD:\?[^}]+\}/);
    }
    expect(minio).toMatch(/MINIO_ROOT_USER:\s*\$\{MINIO_ROOT_USER:\?[^}]+\}/);
    expect(minio).toMatch(/MINIO_ROOT_PASSWORD:\s*\$\{MINIO_ROOT_PASSWORD:\?[^}]+\}/);
    expect(minioInit).toMatch(/MINIO_ROOT_USER:\s*\$\{MINIO_ROOT_USER:\?[^}]+\}/);
    expect(minioInit).toMatch(/MINIO_ROOT_PASSWORD:\s*\$\{MINIO_ROOT_PASSWORD:\?[^}]+\}/);
    expect(minioInit).toContain('"$${MINIO_ROOT_USER}"');
    expect(minioInit).toContain('"$${MINIO_ROOT_PASSWORD}"');
    expect(compose).not.toContain("kinsleuth-secret");
  });

  it("publishes the MinIO API and console only on the loopback interface", async () => {
    const compose = await readFile(`${repositoryRoot}docker-compose.yml`, "utf8");
    const minio = serviceSection(compose, "minio");

    expect(minio).toContain('"127.0.0.1:9000:9000"');
    expect(minio).toContain('"127.0.0.1:9001:9001"');
  });

  it("starts the integration worker in the default Compose application", async () => {
    const worker = await composeWorkerSection();

    expect(worker).not.toMatch(/^\s+profiles:/m);
  });

  it("restarts the long-running integration worker after an operational exit", async () => {
    const worker = await composeWorkerSection();

    expect(worker).toMatch(/^\s+restart:\s+unless-stopped\s*$/m);
  });

  it("keeps ClamAV private while requiring the worker to wait for scanner health", async () => {
    const compose = await readFile(`${repositoryRoot}docker-compose.yml`, "utf8");
    const app = serviceSection(compose, "app");
    const worker = await composeWorkerSection();
    const clamav = serviceSection(compose, "clamav");

    expect(worker).toMatch(/KINRESOLVE_MALWARE_SCANNER:\s*clamd/);
    expect(worker).toMatch(/KINRESOLVE_CLAMD_HOST:\s*clamav/);
    expect(worker).toMatch(/clamav:\s*\n\s+condition:\s+service_healthy/);
    expect(clamav).toMatch(/^\s+healthcheck:/m);
    expect(clamav).not.toMatch(/^\s+ports:/m);
    expect(app).not.toMatch(/clamav/);
  });
});

async function composeWorkerSection(): Promise<string> {
  const compose = await readFile(`${repositoryRoot}docker-compose.yml`, "utf8");
  return serviceSection(compose, "worker");
}

function serviceSection(compose: string, service: string): string {
  const match = new RegExp(`^  ${service}:\\n([\\s\\S]*?)(?=^  [a-zA-Z0-9_-]+:\\n|^volumes:)`, "m").exec(compose);
  if (!match) throw new Error("docker-compose.yml must define a worker service");
  return match[1];
}
