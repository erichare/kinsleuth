import { describe, expect, it } from "vitest";

import { resolveArtifactRightsAcknowledgement } from "@/lib/integrations/artifact-rights";
import { DESKTOP_MEDIA_RIGHTS_ACKNOWLEDGEMENT_VERSION } from "@/lib/integrations/types";

const enabledFlags = {
  exportRefresh: true,
  desktopMedia: true,
  desktopMediaLegalReviewApproved: true,
  ancestryPartnerApi: false
};
const acknowledgedAt = new Date("2026-07-14T20:00:00.000Z");
const acknowledgement = {
  accepted: true as const,
  version: DESKTOP_MEDIA_RIGHTS_ACKNOWLEDGEMENT_VERSION,
  actorId: " synthetic-owner "
};

describe("artifact-stage desktop media rights policy", () => {
  it.each(["family_tree_maker", "rootsmagic"] as const)(
    "requires both release gates and the current actor-bound acknowledgement for %s ZIPs",
    (provider) => {
      expect(() => resolveArtifactRightsAcknowledgement({
        provider,
        fileName: "desktop-export.zip",
        acknowledgement,
        featureFlags: { ...enabledFlags, desktopMediaLegalReviewApproved: false },
        acknowledgedAt
      })).toThrow(expect.objectContaining({ code: "DESKTOP_MEDIA_DISABLED" }));

      expect(() => resolveArtifactRightsAcknowledgement({
        provider,
        fileName: "desktop-export.zip",
        featureFlags: enabledFlags,
        acknowledgedAt
      })).toThrow(expect.objectContaining({ code: "MEDIA_RIGHTS_REQUIRED" }));

      expect(resolveArtifactRightsAcknowledgement({
        provider,
        fileName: "desktop-export.zip",
        acknowledgement,
        featureFlags: enabledFlags,
        acknowledgedAt
      })).toEqual({
        version: DESKTOP_MEDIA_RIGHTS_ACKNOWLEDGEMENT_VERSION,
        actorId: "synthetic-owner",
        acknowledgedAt: acknowledgedAt.toISOString()
      });
    }
  );

  it.each(["ancestry_export", "gedcom"] as const)(
    "never accepts a desktop-media acknowledgement for %s",
    (provider) => {
      expect(() => resolveArtifactRightsAcknowledgement({
        provider,
        fileName: "tree.zip",
        acknowledgement,
        featureFlags: enabledFlags,
        acknowledgedAt
      })).toThrow(expect.objectContaining({ code: "MEDIA_RIGHTS_NOT_APPLICABLE" }));
    }
  );

  it("allows a desktop provider's standalone GEDCOM without media acknowledgement", () => {
    expect(resolveArtifactRightsAcknowledgement({
      provider: "family_tree_maker",
      fileName: "tree.ged",
      featureFlags: { ...enabledFlags, desktopMedia: false },
      acknowledgedAt
    })).toBeUndefined();
  });
});
