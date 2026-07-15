export const betaStatus = {
  phase: "applications-open",
  badge: "Private beta applications open",
  headline: "Private beta applications are open.",
  rollout: "Hosted access is rolling out in small invitation cohorts.",
  summary: "Private beta applications are open. Hosted access is rolling out in small invitation cohorts.",
  metadataDescription:
    "Private beta applications are open. Hosted access is rolling out in small invitation cohorts for Kin Resolve’s evidence-led genealogy workspace.",
  implementedInSource: [
    "Single-archive private research workspace",
    "GEDCOM import preview, review, apply, rollback, and export",
    "People, source, case, evidence, hypothesis, and task workflows",
    "Deterministic quality and privacy checks",
    "Private object storage and durable background jobs"
  ],
  proposedCohortOne: [
    "A synthetic demo at launch",
    "One isolated real-GEDCOM pilot after legal and recovery gates",
    "Founder-operated onboarding and support",
    "A scoped, read-only API developer preview"
  ],
  excludedFromCohortOne: [
    "DNA uploads or triage",
    "External-provider AI",
    "Media packages or binary source attachments",
    "Real-data public publishing",
    "Open signup, billing, or shared multi-family hosting"
  ]
} as const;
