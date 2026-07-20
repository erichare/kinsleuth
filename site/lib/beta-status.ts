import { marketingReleaseMode } from "@/lib/marketing-release-mode";

const releaseStatus = {
  prelaunch: {
    phase: "applications-open-prelaunch",
    badge: "Private beta applications open",
    headline: "Private beta applications are open.",
    rollout: "Invitations have not started.",
    summary: "Private beta applications are open; invitations have not started.",
    metadataDescription:
      "Apply for Kin Resolve’s invitation-only private beta—applications are open, and invitations have not started.",
    hostedLive: false,
    apiLive: false,
    cohortHeading: "Proposed for the first hosted cohort",
    cohortColumnHeading: "Proposed after launch gates",
    cohortColumnNote: "Each item still depends on its applicable approval and production evidence.",
    productFootnote: "Hosted invitations have not started, and the API preview is not yet available.",
    launchMediaDisclaimer:
      "This is proof of the source product—not a claim that hosted invitations or the API are already live."
  },
  application: {
    phase: "hosted-private-beta-live",
    badge: "Hosted private beta live",
    headline: "Hosted private beta is live.",
    rollout: "Access is invitation-only for approved participants; the hosted API is not available in this release.",
    summary: "Hosted private beta is live; access is invitation-only for approved participants.",
    metadataDescription:
      "Apply for Kin Resolve’s invitation-only hosted private beta; access is limited to approved participants.",
    hostedLive: true,
    apiLive: false,
    cohortHeading: "Included in the hosted private beta",
    cohortColumnHeading: "Included in the hosted cohort",
    cohortColumnNote: "Access is activated only for approved participants under the recorded cohort boundary.",
    productFootnote: "Hosted private beta access is live for approved participants; the API preview is not available in this release.",
    launchMediaDisclaimer:
      "This is proof of the source product. Hosted availability is limited to approved private-beta participants, and the API is not available in this release."
  },
  "api-launch": {
    phase: "hosted-private-beta-api-live",
    badge: "Private beta and API live",
    headline: "Hosted private beta and API v1 are live.",
    rollout: "Access remains invitation-only; API v1 is available only to approved participants for archives they own.",
    summary: "Hosted private beta and API v1 are live; access remains invitation-only for approved participants.",
    metadataDescription:
      "Apply for Kin Resolve’s invitation-only hosted private beta and owner-scoped API v1 developer preview.",
    hostedLive: true,
    apiLive: true,
    cohortHeading: "Included in the hosted private beta",
    cohortColumnHeading: "Included in the hosted cohort",
    cohortColumnNote: "Access is activated only for approved participants under the recorded cohort boundary.",
    productFootnote: "Hosted private beta and API v1 access are live only for approved participants and archives they own.",
    launchMediaDisclaimer:
      "This is proof of the source product. Hosted private-beta and API access are limited to approved participants and archives they own."
  }
} as const;

const selectedReleaseStatus = releaseStatus[marketingReleaseMode];

export const betaStatus = {
  releaseMode: marketingReleaseMode,
  ...selectedReleaseStatus,
  implementedInSource: [
    "Single-archive private research workspace",
    "GEDCOM import preview, review, apply, rollback, and export",
    "People, source, case, evidence, hypothesis, and task workflows",
    "Deterministic quality and privacy checks",
    "Private object storage and durable background jobs"
  ],
  proposedCohortOne: [
    "A synthetic demo before any private family data",
    "One isolated plain-GEDCOM pilot after every real-data gate",
    "Founder-operated onboarding, export, deletion, and support",
    selectedReleaseStatus.apiLive
      ? "A scoped, read-only API preview for approved archive owners"
      : "A scoped, read-only API preview after its separate launch gate"
  ],
  excludedFromCohortOne: [
    "DNA uploads or triage",
    "External-provider AI",
    "Media packages or binary source attachments",
    "Real-data public publishing",
    "Open signup, billing, or shared multi-family hosting"
  ]
} as const;
