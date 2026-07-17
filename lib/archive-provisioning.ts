// Keep the operator-facing archive lifecycle API small and explicit. The
// workspace store owns the transaction because initial fixture persistence and
// the archive metadata row must commit atomically.
export {
  demoFixtureVersion,
  getArchiveProvisioning,
  provisionArchive,
  requireProvisionedArchive,
  rotateCanonicalPublicDemoFixture,
  type ArchiveProvisioning,
  type ArchiveProvisioningResult,
  type CanonicalPublicDemoFixtureRotationResult
} from "./workspace-store";
