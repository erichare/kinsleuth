import type { IntegrationCapabilities, IntegrationProvider } from "./types";

export type IntegrationFeatureFlags = {
  exportRefresh: boolean;
  desktopMedia: boolean;
  desktopMediaLegalReviewApproved: boolean;
  ancestryPartnerApi: boolean;
};

type Environment = Record<string, string | undefined>;

export function getIntegrationFeatureFlags(environment: Environment = process.env): IntegrationFeatureFlags {
  const apiEnabled = booleanValue(environment.KINRESOLVE_ANCESTRY_API_ENABLED, false);
  const partnerApproved = booleanValue(environment.KINRESOLVE_ANCESTRY_PARTNER_APPROVED, false);

  return {
    exportRefresh: booleanValue(environment.KINRESOLVE_EXPORT_REFRESH_ENABLED, true),
    desktopMedia: booleanValue(environment.KINRESOLVE_DESKTOP_MEDIA_ENABLED, false),
    desktopMediaLegalReviewApproved: booleanValue(
      environment.KINRESOLVE_MEDIA_LEGAL_REVIEW_APPROVED,
      false
    ),
    // A deploy-time flag cannot substitute for written authorization. Both
    // gates are deliberate so an accidental environment copy cannot expose a
    // partner-only account connection.
    ancestryPartnerApi: apiEnabled && partnerApproved
  };
}

export function isIntegrationProviderEnabled(
  provider: IntegrationProvider,
  flags = getIntegrationFeatureFlags()
): boolean {
  if (provider === "ancestry_api") return flags.ancestryPartnerApi;
  return flags.exportRefresh;
}

export function getProviderCapabilities(
  provider: IntegrationProvider,
  flags = getIntegrationFeatureFlags()
): IntegrationCapabilities {
  if (provider === "ancestry_api") {
    return {
      snapshotImport: false,
      incrementalPull: flags.ancestryPartnerApi,
      media: false,
      oauth: flags.ancestryPartnerApi,
      writeback: false
    };
  }

  return {
    snapshotImport: true,
    incrementalPull: false,
    media: (provider === "family_tree_maker" || provider === "rootsmagic")
      && flags.desktopMedia
      && flags.desktopMediaLegalReviewApproved,
    oauth: false,
    writeback: false
  };
}

function booleanValue(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}
