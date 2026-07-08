import type { PersonSummary } from "./models";
import { publicFactFilter } from "./privacy";

export type PublicationIssue = {
  id: string;
  severity: "blocker" | "warning" | "note";
  area: "privacy" | "facts" | "sources" | "story";
  title: string;
  detail: string;
  action: string;
};

export type PublicationStatus = "ready" | "needs_review" | "blocked";

export type PublicationProfile = {
  personId: string;
  slug: string;
  displayName: string;
  published: boolean;
  status: PublicationStatus;
  readinessScore: number;
  previewPath: string;
  publicFactCount: number;
  sourceCoverage: number;
  blockerCount: number;
  warningCount: number;
  noteCount: number;
  recommendedAction: string;
  issues: PublicationIssue[];
};

export type PublicationPlan = {
  score: number;
  profiles: PublicationProfile[];
  summary: {
    total: number;
    ready: number;
    needsReview: number;
    blocked: number;
    published: number;
    draft: number;
    blockerCount: number;
    warningCount: number;
  };
};

export function evaluatePublicationReadiness(person: PersonSummary): PublicationProfile {
  const publicFacts = person.facts.filter(publicFactFilter);
  const citedPublicFacts = publicFacts.filter((fact) => Boolean(fact.source?.trim()));
  const sourceCoverage = publicFacts.length === 0 ? 0 : citedPublicFacts.length / publicFacts.length;
  const issues: PublicationIssue[] = [];

  if (person.livingStatus !== "deceased") {
    issues.push({
      id: `${person.id}-living-status`,
      severity: "blocker",
      area: "privacy",
      title: "Living status is not publishable",
      detail: `${person.displayName} is marked ${person.livingStatus}. Public profiles require deceased status.`,
      action: "Confirm death evidence or keep the profile private."
    });
  }

  if (person.privacy !== "public") {
    issues.push({
      id: `${person.id}-privacy`,
      severity: "blocker",
      area: "privacy",
      title: "Profile privacy blocks publication",
      detail: `${person.displayName} is marked ${person.privacy}.`,
      action: "Change privacy to public only after reviewing living-person and sensitivity risks."
    });
  }

  if (publicFacts.length === 0) {
    issues.push({
      id: `${person.id}-facts`,
      severity: "blocker",
      area: "facts",
      title: "No public facts selected",
      detail: "A public profile needs at least one public event to render safely.",
      action: "Curate birth, marriage, residence, death, or burial facts for public display."
    });
  } else if (publicFacts.length < 2) {
    issues.push({
      id: `${person.id}-thin-facts`,
      severity: "warning",
      area: "facts",
      title: "Public profile is thin",
      detail: `${person.displayName} has ${publicFacts.length} public fact selected.`,
      action: "Add at least one more sourced public fact before publishing."
    });
  }

  if (publicFacts.length > 0 && sourceCoverage < 0.5) {
    issues.push({
      id: `${person.id}-source-coverage`,
      severity: "warning",
      area: "sources",
      title: "Public facts need citations",
      detail: `${Math.round(sourceCoverage * 100)}% of public facts currently show a source.`,
      action: "Attach citations or hide unsourced facts from the public profile."
    });
  }

  const lowConfidenceFacts = publicFacts.filter((fact) => fact.confidence < 0.6);
  if (lowConfidenceFacts.length > 0) {
    issues.push({
      id: `${person.id}-low-confidence`,
      severity: "warning",
      area: "sources",
      title: "Low-confidence public facts",
      detail: `${lowConfidenceFacts.length} public fact${lowConfidenceFacts.length === 1 ? "" : "s"} fall below 60% confidence.`,
      action: "Review the evidence or mark uncertain facts private until resolved."
    });
  }

  if (!person.notes?.trim()) {
    issues.push({
      id: `${person.id}-story-note`,
      severity: "note",
      area: "story",
      title: "Story context is missing",
      detail: "The profile can publish, but it will read like a record list.",
      action: "Add a short biographical note or link the profile to a story draft."
    });
  }

  const blockerCount = issues.filter((issue) => issue.severity === "blocker").length;
  const warningCount = issues.filter((issue) => issue.severity === "warning").length;
  const noteCount = issues.filter((issue) => issue.severity === "note").length;
  const status: PublicationStatus = blockerCount > 0 ? "blocked" : warningCount > 0 ? "needs_review" : "ready";
  const readinessScore = clampScore(100 - blockerCount * 35 - warningCount * 12 - noteCount * 4 - Math.round((1 - sourceCoverage) * 8));

  return {
    personId: person.id,
    slug: person.slug,
    displayName: person.displayName,
    published: person.published,
    status,
    readinessScore,
    previewPath: `/people/${person.slug}`,
    publicFactCount: publicFacts.length,
    sourceCoverage: Math.round(sourceCoverage * 100),
    blockerCount,
    warningCount,
    noteCount,
    recommendedAction: recommendationFor(status, person.published),
    issues
  };
}

export function buildPublicationPlan(people: PersonSummary[]): PublicationPlan {
  const profiles = people.map(evaluatePublicationReadiness).sort((a, b) => {
    const statusDelta = statusRank(a.status) - statusRank(b.status);
    return statusDelta === 0 ? a.displayName.localeCompare(b.displayName) : statusDelta;
  });

  const blockerCount = profiles.reduce((sum, profile) => sum + profile.blockerCount, 0);
  const warningCount = profiles.reduce((sum, profile) => sum + profile.warningCount, 0);
  const score =
    profiles.length === 0
      ? 100
      : Math.round(profiles.reduce((sum, profile) => sum + profile.readinessScore, 0) / profiles.length);

  return {
    score,
    profiles,
    summary: {
      total: profiles.length,
      ready: profiles.filter((profile) => profile.status === "ready").length,
      needsReview: profiles.filter((profile) => profile.status === "needs_review").length,
      blocked: profiles.filter((profile) => profile.status === "blocked").length,
      published: profiles.filter((profile) => profile.published).length,
      draft: profiles.filter((profile) => !profile.published).length,
      blockerCount,
      warningCount
    }
  };
}

function recommendationFor(status: PublicationStatus, published: boolean): string {
  if (status === "blocked") {
    return published ? "Unpublish until blockers are resolved." : "Resolve blockers before publishing.";
  }

  if (status === "needs_review") {
    return published ? "Keep published only if the warnings are intentional." : "Review warnings, then publish.";
  }

  return published ? "Already public and ready." : "Ready for final editorial approval.";
}

function statusRank(status: PublicationStatus): number {
  if (status === "blocked") {
    return 0;
  }
  if (status === "needs_review") {
    return 1;
  }
  return 2;
}

function clampScore(score: number): number {
  return Math.max(0, Math.min(100, score));
}
