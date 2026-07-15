import { describe, expect, it } from "vitest";

import {
  getIntegrationFeatureFlags,
  getProviderCapabilities,
  isIntegrationProviderEnabled
} from "@/lib/integrations/feature-flags";

describe("integration rollout gates", () => {
  it("enables safe snapshot imports while keeping media and partner access gated by default", () => {
    const flags = getIntegrationFeatureFlags({});

    expect(flags).toEqual({
      exportRefresh: true,
      desktopMedia: false,
      desktopMediaLegalReviewApproved: false,
      ancestryPartnerApi: false
    });
    expect(isIntegrationProviderEnabled("ancestry_export", flags)).toBe(true);
    expect(isIntegrationProviderEnabled("family_tree_maker", flags)).toBe(true);
    expect(isIntegrationProviderEnabled("ancestry_api", flags)).toBe(false);
  });

  it("allows each public rollout track to be disabled independently", () => {
    const flags = getIntegrationFeatureFlags({
      KINRESOLVE_EXPORT_REFRESH_ENABLED: "false",
      KINRESOLVE_DESKTOP_MEDIA_ENABLED: "true",
      KINRESOLVE_MEDIA_LEGAL_REVIEW_APPROVED: "true"
    });

    expect(flags).toEqual({
      exportRefresh: false,
      desktopMedia: true,
      desktopMediaLegalReviewApproved: true,
      ancestryPartnerApi: false
    });
    expect(isIntegrationProviderEnabled("ancestry_export", flags)).toBe(false);
    expect(isIntegrationProviderEnabled("family_tree_maker", flags)).toBe(false);
  });

  it("requires both a feature flag and written partner approval before ancestry_api exists", () => {
    const enabledWithoutApproval = getIntegrationFeatureFlags({
      KINRESOLVE_ANCESTRY_API_ENABLED: "true"
    });
    const approvedWithoutEnablement = getIntegrationFeatureFlags({
      KINRESOLVE_ANCESTRY_PARTNER_APPROVED: "true"
    });
    const fullyEnabled = getIntegrationFeatureFlags({
      KINRESOLVE_ANCESTRY_API_ENABLED: "true",
      KINRESOLVE_ANCESTRY_PARTNER_APPROVED: "true"
    });

    expect(enabledWithoutApproval.ancestryPartnerApi).toBe(false);
    expect(approvedWithoutEnablement.ancestryPartnerApi).toBe(false);
    expect(fullyEnabled.ancestryPartnerApi).toBe(true);
    expect(isIntegrationProviderEnabled("ancestry_api", fullyEnabled)).toBe(true);
  });

  it("never advertises writeback and advertises media only after both operational gates open", () => {
    const closed = getIntegrationFeatureFlags({});
    const enabledWithoutReview = getIntegrationFeatureFlags({ KINRESOLVE_DESKTOP_MEDIA_ENABLED: "true" });
    const open = getIntegrationFeatureFlags({
      KINRESOLVE_DESKTOP_MEDIA_ENABLED: "true",
      KINRESOLVE_MEDIA_LEGAL_REVIEW_APPROVED: "true"
    });

    expect(getProviderCapabilities("ancestry_export", closed)).toEqual({
      snapshotImport: true,
      incrementalPull: false,
      media: false,
      oauth: false,
      writeback: false
    });
    expect(getProviderCapabilities("family_tree_maker", closed).media).toBe(false);
    expect(getProviderCapabilities("family_tree_maker", enabledWithoutReview).media).toBe(false);
    expect(getProviderCapabilities("family_tree_maker", open).media).toBe(true);
    expect(getProviderCapabilities("rootsmagic", open).media).toBe(true);
    expect(Object.values([
      "ancestry_export",
      "family_tree_maker",
      "rootsmagic",
      "gedcom",
      "ancestry_api"
    ]).every((provider) => getProviderCapabilities(provider as never, open).writeback === false)).toBe(true);
  });
});
