import { describe, expect, it } from "vitest";

import { canUseImportedMedia, defaultImportedMediaPolicy } from "@/lib/integrations/media-policy";

describe("imported media policy", () => {
  it.each(["family_tree_maker", "rootsmagic"] as const)(
    "defaults every %s binary to third-party restricted and private",
    (provider) => {
      const policy = defaultImportedMediaPolicy({ provider });

      expect(policy).toEqual({
        licenseClass: "third_party_restricted",
        privacy: "private",
        publishable: false,
        aiEligible: false
      });
    }
  );

  it("fails closed for unexpected media in an Ancestry export", () => {
    const policy = defaultImportedMediaPolicy({ provider: "ancestry_export" });

    expect(policy.licenseClass).toBe("third_party_restricted");
    expect(policy.privacy).toBe("private");
    expect(policy.publishable).toBe(false);
    expect(policy.aiEligible).toBe(false);
  });

  it("allows restricted media only in an authenticated private archive view", () => {
    const policy = defaultImportedMediaPolicy({ provider: "rootsmagic" });

    expect(canUseImportedMedia(policy, "private_archive_view")).toBe(true);
    expect(canUseImportedMedia(policy, "public_publish")).toBe(false);
    expect(canUseImportedMedia(policy, "ai_context")).toBe(false);
  });
});
