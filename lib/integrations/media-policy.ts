export type ImportedMediaProvider =
  | "ancestry_export"
  | "family_tree_maker"
  | "rootsmagic"
  | "gedcom"
  | "generic_gedcom"
  | "ancestry_api";

export type ImportedMediaPolicy = {
  licenseClass: "third_party_restricted" | "user_owned";
  privacy: "private" | "sensitive" | "public";
  publishable: boolean;
  aiEligible: boolean;
};

export type ImportedMediaUse = "private_archive_view" | "public_publish" | "ai_context";

/**
 * Imported files have unknown rights until a researcher explicitly classifies
 * them. Provider exports therefore always begin with the most restrictive
 * policy, including files that unexpectedly appear in an Ancestry export.
 */
export function defaultImportedMediaPolicy(_input: { provider: ImportedMediaProvider }): ImportedMediaPolicy {
  return {
    licenseClass: "third_party_restricted",
    privacy: "private",
    publishable: false,
    aiEligible: false
  };
}

export function canUseImportedMedia(policy: ImportedMediaPolicy, use: ImportedMediaUse): boolean {
  if (use === "private_archive_view") {
    return policy.privacy !== "public" || policy.licenseClass === "user_owned";
  }

  if (policy.licenseClass === "third_party_restricted") {
    return false;
  }

  if (use === "public_publish") {
    return policy.privacy === "public" && policy.publishable;
  }

  return policy.aiEligible;
}
