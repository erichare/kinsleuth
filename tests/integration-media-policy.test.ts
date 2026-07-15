import { describe, expect, it } from "vitest";

import {
  DESKTOP_MEDIA_RIGHTS_ACKNOWLEDGEMENT_VERSION,
  detectSafeImportedMediaMime,
  shouldRetainDesktopMedia
} from "@/lib/integrations/media-store";

const acknowledgement = {
  version: DESKTOP_MEDIA_RIGHTS_ACKNOWLEDGEMENT_VERSION,
  actorId: "synthetic-owner",
  acknowledgedAt: "2026-07-14T20:00:00.000Z"
};

describe("desktop media retention policy", () => {
  it.each(["family_tree_maker", "rootsmagic"] as const)(
    "retains matched %s media only when both deploy gates and the current acknowledgement are present",
    (provider) => {
      expect(shouldRetainDesktopMedia({
        provider,
        desktopMediaEnabled: true,
        legalReviewApproved: true,
        rightsAcknowledgement: acknowledgement
      })).toBe(true);

      expect(shouldRetainDesktopMedia({
        provider,
        desktopMediaEnabled: false,
        legalReviewApproved: true,
        rightsAcknowledgement: acknowledgement
      })).toBe(false);
      expect(shouldRetainDesktopMedia({
        provider,
        desktopMediaEnabled: true,
        legalReviewApproved: false,
        rightsAcknowledgement: acknowledgement
      })).toBe(false);
      expect(shouldRetainDesktopMedia({
        provider,
        desktopMediaEnabled: true,
        legalReviewApproved: true
      })).toBe(false);
      expect(shouldRetainDesktopMedia({
        provider,
        desktopMediaEnabled: true,
        legalReviewApproved: true,
        rightsAcknowledgement: { ...acknowledgement, version: "obsolete-rights-v0" }
      })).toBe(false);
    }
  );

  it.each(["ancestry_export", "gedcom", "generic_gedcom"] as const)(
    "never retains binary media for %s",
    (provider) => {
      expect(shouldRetainDesktopMedia({
        provider,
        desktopMediaEnabled: true,
        legalReviewApproved: true,
        rightsAcknowledgement: acknowledgement
      })).toBe(false);
    }
  );

  it("derives a safe MIME type from content signatures rather than filenames", () => {
    expect(detectSafeImportedMediaMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]))).toBe("image/jpeg");
    expect(detectSafeImportedMediaMime(Buffer.from("%PDF-1.7\nsynthetic", "ascii"))).toBe("application/pdf");
    expect(detectSafeImportedMediaMime(Buffer.from("MZ disguised portrait", "ascii"))).toBeUndefined();
    expect(detectSafeImportedMediaMime(Buffer.from("unrecognized bytes", "utf8"))).toBeUndefined();
  });
});
