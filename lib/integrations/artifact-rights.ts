import type { IntegrationFeatureFlags } from "./feature-flags";
import {
  DESKTOP_MEDIA_RIGHTS_ACKNOWLEDGEMENT_VERSION,
  type IntegrationProvider,
  type MediaRightsAcknowledgement
} from "./types";

export type MediaRightsAcceptance = {
  accepted: true;
  version: string;
  actorId: string;
};

export function resolveArtifactRightsAcknowledgement(input: {
  provider: IntegrationProvider;
  fileName: string;
  acknowledgement?: MediaRightsAcceptance;
  featureFlags: IntegrationFeatureFlags;
  acknowledgedAt: Date;
}): MediaRightsAcknowledgement | undefined {
  const isDesktopProvider = input.provider === "family_tree_maker" || input.provider === "rootsmagic";
  const isDesktopZip = isDesktopProvider && /\.zip$/i.test(input.fileName.trim());

  if (!isDesktopZip) {
    if (input.acknowledgement) {
      throw rightsError(
        "MEDIA_RIGHTS_NOT_APPLICABLE",
        "Desktop-media rights acknowledgement is accepted only for Family Tree Maker or RootsMagic ZIP packages"
      );
    }
    return undefined;
  }

  if (!input.featureFlags.desktopMedia || !input.featureFlags.desktopMediaLegalReviewApproved) {
    throw rightsError(
      "DESKTOP_MEDIA_DISABLED",
      "Desktop media ZIP import is unavailable; upload a standalone GEDCOM export instead"
    );
  }

  const actorId = input.acknowledgement?.actorId.trim();
  if (
    input.acknowledgement?.accepted !== true
    || input.acknowledgement.version !== DESKTOP_MEDIA_RIGHTS_ACKNOWLEDGEMENT_VERSION
    || !actorId
  ) {
    throw rightsError(
      "MEDIA_RIGHTS_REQUIRED",
      "The current desktop-media rights acknowledgement is required"
    );
  }

  return {
    version: DESKTOP_MEDIA_RIGHTS_ACKNOWLEDGEMENT_VERSION,
    actorId,
    acknowledgedAt: input.acknowledgedAt.toISOString()
  };
}

function rightsError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}
