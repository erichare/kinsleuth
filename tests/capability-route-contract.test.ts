import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import {
  capabilityUnavailableResponse,
  hostedDeploymentUnavailableResponse
} from "@/lib/api-capabilities";

const privateBetaEnvironment = {
  KINRESOLVE_DEPLOYMENT_MODE: "hosted",
  KINRESOLVE_DATASET_MODE: "pilot",
  KINRESOLVE_DNA_ENABLED: "false",
  KINRESOLVE_EXTERNAL_AI_ENABLED: "false",
  KINRESOLVE_PUBLIC_ARCHIVE_ENABLED: "false",
  KINRESOLVE_PUBLIC_PUBLISHING_ENABLED: "false",
  KINRESOLVE_EVIDENCE_BINARY_UPLOADS_ENABLED: "false",
  KINRESOLVE_PACKAGE_MEDIA_ENABLED: "false",
  KINRESOLVE_PLAIN_GEDCOM_ENABLED: "true"
} as const;

describe("hosted capability route contract", () => {
  it("returns a generic not-found response for a disabled capability", async () => {
    const response = capabilityUnavailableResponse("dna", privateBetaEnvironment);

    expect(response?.status).toBe(404);
    await expect(response?.json()).resolves.toEqual({ error: "Not found" });
  });

  it("allows enabled and self-hosted capabilities through", () => {
    expect(capabilityUnavailableResponse("plainGedcom", privateBetaEnvironment)).toBeUndefined();
    expect(capabilityUnavailableResponse("dna", { KINRESOLVE_DEPLOYMENT_MODE: "self-hosted" })).toBeUndefined();
    expect(hostedDeploymentUnavailableResponse({ KINRESOLVE_DEPLOYMENT_MODE: "self-hosted" })).toBeUndefined();
  });

  it("fails closed without leaking invalid hosted configuration", async () => {
    const response = capabilityUnavailableResponse("dna", {
      KINRESOLVE_DEPLOYMENT_MODE: "hosted",
      KINRESOLVE_DATASET_MODE: "pilot"
    });

    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toEqual({ error: "Service unavailable" });
  });

  it("marks legacy import mutations unavailable in every hosted deployment", async () => {
    const response = hostedDeploymentUnavailableResponse(privateBetaEnvironment);

    expect(response?.status).toBe(404);
    await expect(response?.json()).resolves.toEqual({ error: "Not found" });
  });

  it.each([
    ["dna", "app/api/dna/import/route.ts", "readCsvRequest(request)"],
    ["dna", "app/api/dna/analyze/route.ts", "request.json()"],
    ["dna", "app/api/dna/matches/route.ts", "searchDnaMatchesPageFromDb("],
    ["dna", "app/api/dna/[id]/route.ts", "request.json()"],
    ["dna", "app/api/cases/[id]/evidence/route.ts", "request.json()"],
    ["externalAi", "app/api/ai/analyze/route.ts", "request.json()"],
    ["packageMedia", "app/api/integration-media/route.ts", "new URL(request.url)"],
    ["packageMedia", "app/api/integration-media/[id]/route.ts", "readJsonObject(request)"],
    ["packageMedia", "app/api/integration-media/[id]/download/route.ts", "context.params"]
  ] as const)("guards %s in %s before processing", async (capability, file, processingMarker) => {
    const source = await readFile(file, "utf8");
    const guard = `capabilityUnavailableResponse("${capability}")`;

    expect(source, file).toContain(guard);
    expect(source.indexOf(guard), file).toBeLessThan(source.indexOf(processingMarker));
  });

  it.each([
    ["app/api/imports/route.ts", "readImportRequest(request"],
    ["app/api/imports/uploads/route.ts", "process.env.BLOB_READ_WRITE_TOKEN"]
  ] as const)("disables the legacy hosted mutation in %s before processing", async (file, processingMarker) => {
    const source = await readFile(file, "utf8");
    const guard = "hostedDeploymentUnavailableResponse()";

    expect(source, file).toContain(guard);
    expect(source.indexOf(guard), file).toBeLessThan(source.indexOf(processingMarker));
  });
});
