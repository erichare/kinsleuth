export interface RoadmapItem {
  readonly title: string;
  readonly detail: string;
}

export interface RoadmapSection {
  readonly id: "shipped" | "in-progress" | "next" | "exploring" | "not-planned";
  readonly label: string;
  readonly tone: "available" | "developing" | "exploring";
  readonly headline: string;
  readonly note: string;
  readonly items: readonly RoadmapItem[];
}

/**
 * Hand-maintained roadmap data shared by /roadmap and mirrored by the
 * canonical repository ROADMAP.md. Every entry follows the public claims
 * contract in docs/brand-and-domain.md: "Shipped" is a code-state claim
 * about the public source, never a hosted-availability claim, and nothing
 * below asserts a date, a price, or production readiness.
 */
export const roadmapSections = [
  {
    id: "shipped",
    label: "Shipped",
    tone: "available",
    headline: "Merged and tested in the public source.",
    note: "Shipped means the capability is implemented, reviewed, and covered by tests on the main branch. It is a code-state claim, not a claim that a hosted service offers it.",
    items: [
      {
        title: "Single-archive private research workspace",
        detail: "Account-gated people, source, case, evidence, hypothesis, and task workflows over one Postgres-backed archive."
      },
      {
        title: "GEDCOM import preview, apply, rollback, and export",
        detail: "Reviewable re-import differences, pre-apply snapshots, and full GEDCOM 5.5.1 export so the archive stays portable."
      },
      {
        title: "Deterministic quality and privacy checks",
        detail: "Date-conflict, coverage-gap, and living-person checks that run with no AI provider configured."
      },
      {
        title: "Private data-source artifact storage and durable background jobs",
        detail: "Archive-namespaced private storage for data-source artifacts plus Postgres-leased jobs with retries, cancellation, and redacted errors. Legacy general source-file attachments still target local disk and need the same backend before production use."
      },
      {
        title: "Private guided research loop",
        detail: "A deterministic next-step case guide with durable outcomes and decisions, behind a server-side flag; no external model calls."
      },
      {
        title: "Synthetic research challenge and demo fixtures",
        detail: "Five browser-local investigations across thirty fictional Hartwell–Mercer records; every demo detail is invented."
      },
      {
        title: "Candidate-first release and rollback machinery",
        detail: "Staged candidate deployments, database write fencing, and a checked-in zero-runtime holding page as the rollback target."
      }
    ]
  },
  {
    id: "in-progress",
    label: "In progress",
    tone: "developing",
    headline: "Active work with open gates.",
    note: "In progress is not the same as available. Each item below has named launch gates that remain open, and none is offered as a hosted service today.",
    items: [
      {
        title: "Hosted private beta launch gates",
        detail: "Owner, legal, runtime, provider, and recovery evidence gates for the invitation-only hosted beta remain open."
      },
      {
        title: "Public demo cutover",
        detail: "The always-on synthetic demo cell has a dedicated project and runbook; external configuration and rehearsal gates remain."
      },
      {
        title: "Production hardening",
        detail: "Observability, backup and restore evidence, and self-hosted storage portability ahead of any real-data pilot."
      }
    ]
  },
  {
    id: "next",
    label: "Next",
    tone: "developing",
    headline: "Queued behind the gates above.",
    note: "These start only after their prerequisite approvals and evidence exist. Listing them here is planning, not a promise of timing.",
    items: [
      {
        title: "One isolated plain-GEDCOM real-data pilot",
        detail: "A single dedicated cell for one researcher, admitted only after every real-data gate passes."
      },
      {
        title: "Founder-operated onboarding, export, deletion, and support",
        detail: "Hands-on operation for the first hosted cohort, with operator-assisted export and deletion."
      },
      {
        title: "Scoped read-only API preview",
        detail: "Owner-scoped tokens and the published OpenAPI contract, released only after separate edge-limit, canary, and revocation gates."
      },
      {
        title: "Production delivery of the invitation and recovery perimeter",
        detail: "The implemented invitation, email-verification, recovery, and exact-document acceptance flows still need live operational evidence."
      }
    ]
  },
  {
    id: "exploring",
    label: "Exploring",
    tone: "exploring",
    headline: "Design intent without dates.",
    note: "Research directions the project is openly studying. None of these is implemented as a finished capability, and none should be bought on faith.",
    items: [
      {
        title: "Semantic retrieval and stronger citation grounding",
        detail: "The pgvector embeddings table is provisioned and unused; retrieval-backed, citation-grounded analysis is design work."
      },
      {
        title: "Genealogical Proof Standard conflict-resolution workflows",
        detail: "Explicit research logs, exhaustive-search checklists, and forced conflict resolution."
      },
      {
        title: "Agent-assisted record search",
        detail: "Tool-calling against partner record APIs, dependent on partnership approvals that do not exist yet."
      },
      {
        title: "Shared multi-archive hosting and tenant isolation",
        detail: "Database-policy tenant isolation and collaboration between unrelated families."
      },
      {
        title: "Granular fact, citation, and story publishing controls",
        detail: "Publication decisions at the fact and source level, beyond today's person-level gates."
      }
    ]
  },
  {
    id: "not-planned",
    label: "Not planned yet",
    tone: "exploring",
    headline: "Server-enforced cohort boundaries.",
    note: "These are deliberate hosted cohort-one exclusions, not hidden omissions. Several exist in source for self-hosted operators; none has a hosted plan or date.",
    items: [
      {
        title: "Hosted DNA uploads or triage",
        detail: "DNA match triage exists in the source product but remains disabled for the hosted cohort."
      },
      {
        title: "External-provider AI in the hosted cohort",
        detail: "Self-hosted operators can configure an OpenAI-compatible provider; the hosted cohort makes no external AI calls."
      },
      {
        title: "Hosted media packages or binary source attachments",
        detail: "Hosted source work stays transcript-only: metadata, links, and pasted text."
      },
      {
        title: "Real-data public publishing",
        detail: "Publication-readiness checks ship in source, while publishing real family data publicly stays disabled."
      },
      {
        title: "Open signup, billing, or shared multi-family hosting",
        detail: "No self-service accounts, no payment collection, and no shared tenancy in the hosted cohort."
      }
    ]
  }
] as const satisfies readonly RoadmapSection[];
