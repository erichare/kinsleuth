import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("operator archive provisioning documentation", () => {
  it("documents an explicit self-hosted demo contract in the example environment", async () => {
    const environment = await readFile(".env.example", "utf8");

    expect(environment).toMatch(/^KINRESOLVE_DEPLOYMENT_MODE=self-hosted$/m);
    expect(environment).toMatch(/^KINRESOLVE_DATASET_MODE=demo$/m);
    expect(environment).toMatch(/^KINSLEUTH_ARCHIVE_ID=archive-default$/m);
  });

  it("makes quick start provision before the app starts and removes seed-on-read instructions", async () => {
    const [readme, setupPage, persistence] = await Promise.all([
      readFile("README.md", "utf8"),
      readFile("app/setup/page.tsx", "utf8"),
      readFile("docs/persistence.md", "utf8")
    ]);

    expect(readme.indexOf("npm run archive:provision -- --mode demo")).toBeGreaterThan(
      readme.indexOf("docker compose up -d postgres")
    );
    expect(readme.indexOf("npm run archive:provision -- --mode demo")).toBeLessThan(readme.indexOf("npm run dev"));
    expect(`${readme}\n${setupPage}\n${persistence}`).not.toMatch(/first[- ](?:read|touch).*seed/i);
    expect(setupPage).toContain("npm run archive:provision -- --mode demo");
    expect(persistence).toContain("explicit archive provisioning");
  });

  it("runs one explicit Compose provisioner before both app and worker", async () => {
    const compose = await readFile("docker-compose.yml", "utf8");
    const provisioner = serviceSection(compose, "provision");

    expect(provisioner).toMatch(/command:\s*sh -c "npm run db:migrate && npm run archive:provision -- --mode demo"/);
    expect(provisioner).toMatch(/KINRESOLVE_DEPLOYMENT_MODE:\s*self-hosted/);
    expect(provisioner).toMatch(/KINRESOLVE_DATASET_MODE:\s*demo/);
    expect(provisioner).toMatch(/KINSLEUTH_ARCHIVE_ID:\s*archive-default/);
    expect(provisioner).toMatch(/postgres:\s*\n\s+condition:\s+service_healthy/);

    const postgres = serviceSection(compose, "postgres");
    expect(postgres).toMatch(/healthcheck:[\s\S]*pg_isready -U kinsleuth -d kinsleuth/);

    for (const name of ["app", "worker"] as const) {
      const service = serviceSection(compose, name);
      expect(service).toMatch(/KINRESOLVE_DEPLOYMENT_MODE:\s*self-hosted/);
      expect(service).toMatch(/KINRESOLVE_DATASET_MODE:\s*demo/);
      expect(service).toMatch(/KINSLEUTH_ARCHIVE_ID:\s*archive-default/);
      expect(service).toMatch(/provision:\s*\n\s+condition:\s+service_completed_successfully/);
    }
  });

  it("keeps the opt-in large integration fixture on explicit provisioning", async () => {
    const source = await readFile("tests/integration-large-refresh.test.ts", "utf8");

    expect(source).toContain('import { provisionTestArchive } from "@/tests/helpers/provision-test-archive";');
    expect(source).toContain("await provisionTestArchive(options);");
    expect(source).not.toMatch(/beforeEach\([\s\S]*?readWorkspace\(options\)/);
  });
});

function serviceSection(compose: string, service: string): string {
  const match = new RegExp(`^  ${service}:\\n([\\s\\S]*?)(?=^  [a-zA-Z0-9_-]+:\\n|^volumes:)`, "m").exec(compose);
  if (!match) throw new Error(`docker-compose.yml must define a ${service} service`);
  return match[1];
}
