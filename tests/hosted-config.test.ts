import { describe, expect, it } from "vitest";

import { resolveDatasetConfiguration } from "@/lib/hosted-config";

describe("hosted dataset configuration", () => {
  it.each(["empty", "demo", "pilot"] as const)("accepts explicit hosted %s mode", (datasetMode) => {
    expect(
      resolveDatasetConfiguration({
        NODE_ENV: "production",
        KINRESOLVE_DEPLOYMENT_MODE: "hosted",
        KINRESOLVE_DATASET_MODE: datasetMode
      })
    ).toEqual({ deploymentMode: "hosted", datasetMode, explicitDatasetMode: true });
  });

  it("requires an explicit dataset mode for hosted deployments", () => {
    expect(() =>
      resolveDatasetConfiguration({
        NODE_ENV: "production",
        KINRESOLVE_DEPLOYMENT_MODE: "hosted"
      })
    ).toThrow(/KINRESOLVE_DATASET_MODE.*required.*hosted/i);
  });

  it("fails closed when a Vercel production runtime omits the deployment mode", () => {
    expect(() =>
      resolveDatasetConfiguration({
        NODE_ENV: "production",
        VERCEL: "1",
        VERCEL_ENV: "production",
        KINRESOLVE_DATASET_MODE: "pilot"
      })
    ).toThrow(/KINRESOLVE_DEPLOYMENT_MODE.*required.*Vercel production/i);
  });

  it("preserves an explicit self-hosted contract with a demo default", () => {
    expect(
      resolveDatasetConfiguration({
        NODE_ENV: "production",
        KINRESOLVE_DEPLOYMENT_MODE: "self-hosted"
      })
    ).toEqual({ deploymentMode: "self-hosted", datasetMode: "demo", explicitDatasetMode: false });

    expect(
      resolveDatasetConfiguration({
        KINRESOLVE_DEPLOYMENT_MODE: "self-hosted",
        KINRESOLVE_DATASET_MODE: "empty"
      })
    ).toEqual({ deploymentMode: "self-hosted", datasetMode: "empty", explicitDatasetMode: true });
  });

  it("defaults non-Vercel local development to the self-hosted demo contract", () => {
    expect(resolveDatasetConfiguration({ NODE_ENV: "development" })).toEqual({
      deploymentMode: "self-hosted",
      datasetMode: "demo",
      explicitDatasetMode: false
    });
  });

  it.each([
    [{ KINRESOLVE_DEPLOYMENT_MODE: "cloud", KINRESOLVE_DATASET_MODE: "pilot" }, /KINRESOLVE_DEPLOYMENT_MODE/i],
    [{ KINRESOLVE_DEPLOYMENT_MODE: "hosted", KINRESOLVE_DATASET_MODE: "seed" }, /KINRESOLVE_DATASET_MODE/i],
    [{ KINRESOLVE_DEPLOYMENT_MODE: "hosted", KINRESOLVE_DATASET_MODE: "" }, /KINRESOLVE_DATASET_MODE.*required/i]
  ])("rejects invalid configuration %#", (environment, expected) => {
    expect(() => resolveDatasetConfiguration(environment)).toThrow(expected);
  });
});
