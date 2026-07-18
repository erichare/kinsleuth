import { demoFictionNotice } from "./demo-data";
import { demoFamilyTree } from "./demo-family-tree";
import {
  demoArchiveMediaForEvidence,
  demoArchiveMediaForRecord,
  demoArchiveMediaForSource,
  type DemoArchiveMedia
} from "./demo-archive-media";
import { demoProfileContentFor } from "./demo-profile-content";
import type {
  AIAnalysisRun,
  PersonFact,
  PersonSummary,
  ResearchCase,
  SourceDocument
} from "./models";

export type PersonProfileFact = PersonFact & {
  label: string;
};

export type PersonProfileSource = {
  id: string;
  title: string;
  sourceType: string;
  repository?: string;
  citationDate?: string;
  summary?: string;
  confidence: number;
  supportCount: number;
  origin: "source-record" | "case-evidence" | "fact-citation";
  media?: DemoArchiveMedia;
};

export type PersonIdentityEntry = {
  id: string;
  name: string;
  date?: string;
  place?: string;
  source?: string;
  confidence?: number;
  kind: "profile" | "recorded";
};

export type PersonTimelineEvent = {
  id: string;
  label: string;
  date: string;
  place: string;
  detail?: string;
  source?: string;
  confidence: number;
};

export type PersonProfileNote = {
  id: string;
  title: string;
  body: string;
};

export type PersonProfileRelationship = {
  id: string;
  displayName: string;
  relationship: string;
  lifeSummary: string;
  birthPlace?: string;
};

export type PersonProfileInsight = {
  id: string;
  title: string;
  summary: string;
  detail: string;
  confidence?: number;
  tone: "ok" | "attention" | "neutral";
  href?: string;
  actionLabel?: string;
};

export type PersonProfileAnalysis = {
  id: string;
  question: string;
  answer: string;
  createdAt: string;
  provider?: string;
  model?: string;
  uncertainty: string[];
};

export type PersonProfileView = {
  facts: PersonProfileFact[];
  identityTrail: PersonIdentityEntry[];
  sources: PersonProfileSource[];
  sourceTotal: number;
  timeline: PersonTimelineEvent[];
  notes: PersonProfileNote[];
  relationships: PersonProfileRelationship[];
  insights: PersonProfileInsight[];
  savedAnalyses: PersonProfileAnalysis[];
  isFictionalDemo: boolean;
};

type PersonProfileContext = {
  people: PersonSummary[];
  sources?: SourceDocument[];
  cases?: ResearchCase[];
  aiRuns?: AIAnalysisRun[];
  includeProviderMetadata?: boolean;
  includeDemoMedia?: boolean;
};

const maximumProfileSources = 24;
const maximumSavedAnalyses = 6;

const factMediaRecordIds = new Map<string, string>([
  [factMediaKey("p-samuel-mercer", "Fictional Northstar Cove birth ledger"), "northstar-household-1901"],
  [factMediaKey("p-maeve-mercer", "Fictional Northstar Cove birth ledger"), "northstar-household-1901"],
  [factMediaKey("p-jonah-mercer", "Fictional Northstar Cove birth ledger"), "northstar-household-1901"],
  [factMediaKey("p-samuel-mercer", "Fictional Lantern Bay passenger list"), "lantern-passenger-declaration-1907"],
  [factMediaKey("p-nora-hartwell", "Fictional 1922 Nora Hartwell household journal"), "blue-tin-nora-journal-1922"],
  [factMediaKey("p-nora-hartwell", "Fictional Lantern Bay marriage ledger"), "lantern-marriage-1909"],
  [factMediaKey("p-samuel-mercer", "Fictional Lantern Bay marriage ledger"), "lantern-marriage-1909"],
  [factMediaKey("p-amalia-bellandi", "Fictional Lantern Bay marriage ledger"), "amalia-marriage-application-1885"],
  [factMediaKey("p-amalia-bellandi", "Fictional Ceraluna Alta parish register"), "ceraluna-baptisms-1859-1864"],
  [factMediaKey("p-amalia-bellandi", "Fictional Ceraluna Alta household register"), "ceraluna-households-1868"],
  [factMediaKey("p-luca-bellandi", "Fictional Ceraluna Alta parish register"), "ceraluna-baptisms-1859-1864"],
  [factMediaKey("p-mira-solari", "Fictional Ceraluna Alta parish register"), "ceraluna-baptisms-1859-1864"],
  [factMediaKey("p-amalia-bellandi", "Fictional Lantern Bay arrivals ledger"), "malia-passenger-ledger-1883"],
  [factMediaKey("p-amalia-bellandi", "Fictional Ceraluna–Lantern passenger ledger"), "malia-passenger-ledger-1883"],
  [factMediaKey("p-amalia-bellandi", "Fictional Lantern Bay marriage application"), "amalia-marriage-application-1885"]
]);

export function buildPersonProfile(
  person: PersonSummary,
  context: PersonProfileContext
): PersonProfileView {
  const facts = person.facts.map((fact) => ({ ...fact, label: factTypeLabel(fact.type) }));
  const isFictionalDemo = Boolean(person.notes?.includes(demoFictionNotice));
  const includeDemoMedia = isFictionalDemo && context.includeDemoMedia !== false;
  const relevantCases = (context.cases ?? []).filter((researchCase) =>
    researchCase.evidence.some((evidence) => evidence.linkedPersonId === person.id)
  );
  const relevantCaseIds = new Set(relevantCases.map((researchCase) => researchCase.id));
  const allSources = deduplicatePersonSources(
    buildPersonSources(person, context.sources ?? [], relevantCases, includeDemoMedia)
  );
  const sources = allSources.slice(0, maximumProfileSources);
  const identityTrail = buildIdentityTrail(person, facts);
  const timeline = facts
    .map((fact) => ({
      id: fact.id,
      label: fact.label,
      date: fact.date ?? "Unknown date",
      place: fact.place ?? "Unknown place",
      detail: fact.value,
      source: fact.source,
      confidence: fact.confidence
    }))
    .sort(compareTimelineEvents);
  const noteBody = previewText(person.notes?.replace(demoFictionNotice, "").trim(), 4_000);
  const demoContent = isFictionalDemo ? demoProfileContentFor(person.id) : undefined;
  const notes: PersonProfileNote[] = [
    ...(noteBody
      ? [{ id: `${person.id}-profile-note`, title: isFictionalDemo ? "Family lore" : "Family research note", body: noteBody }]
      : []),
    ...(demoContent?.notes ?? [])
  ];
  const peopleById = new Map(context.people.map((candidate) => [candidate.id, candidate]));
  const relationships = person.relatives.flatMap((relativeId) => {
    const relative = peopleById.get(relativeId);
    if (!relative) return [];
    return [{
      id: relative.id,
      displayName: relative.displayName,
      relationship: describeDemoRelationship(person.id, relative),
      lifeSummary: lifeSummary(relative),
      birthPlace: relative.birthPlace
    }];
  });
  const savedAnalyses = (context.aiRuns ?? [])
    .filter((run) =>
      run.contextReferences.some((reference) => reference.type === "person" && reference.id === person.id)
      || Boolean(run.linkedCaseId && relevantCaseIds.has(run.linkedCaseId))
    )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, maximumSavedAnalyses)
    .map((run) => ({
      id: run.id,
      question: previewText(run.question, 240) ?? "Saved profile analysis",
      answer: previewText(run.answer, 1_200) ?? "No answer was saved for this run.",
      createdAt: run.createdAt,
      provider: context.includeProviderMetadata === false ? undefined : run.provider,
      model: context.includeProviderMetadata === false ? undefined : run.model,
      uncertainty: run.uncertainty.slice(0, 8).map((item) => previewText(item, 300) ?? "Unspecified uncertainty")
    }));

  return {
    facts,
    identityTrail,
    sources,
    sourceTotal: allSources.length,
    timeline,
    notes,
    relationships,
    insights: [
      ...buildProfileInsights(person, facts, allSources.length, relevantCases),
      ...(demoContent?.insights ?? []).map(({ caseId, ...insight }) => ({
        ...insight,
        href: caseId ? `/app/cases/${encodeURIComponent(caseId)}` : undefined,
        actionLabel: caseId ? "Open connected case" : undefined
      }))
    ],
    savedAnalyses,
    isFictionalDemo
  };
}

export function factTypeLabel(type: string): string {
  const normalized = type.trim().toUpperCase();
  const labels: Record<string, string> = {
    BIRT: "Birth",
    DEAT: "Death",
    MARR: "Marriage",
    IMMI: "Arrival",
    EMIG: "Departure",
    RESI: "Residence",
    OCCU: "Occupation",
    BAPM: "Baptism",
    BURI: "Burial",
    NAME: "Recorded name"
  };
  return labels[normalized] ?? type;
}

export function describeDemoRelationship(subjectId: string, relative: PersonSummary): string {
  for (const family of demoFamilyTree.families) {
    const partnerIds: readonly string[] = family.partnerIds;
    const childIds: readonly string[] = family.childIds;
    const subjectIsPartner = partnerIds.includes(subjectId);
    const relativeIsPartner = partnerIds.includes(relative.id);
    const subjectIsChild = childIds.includes(subjectId);
    const relativeIsChild = childIds.includes(relative.id);

    if (subjectIsPartner && relativeIsPartner) return "Spouse";
    if (subjectIsPartner && relativeIsChild) return genderedRelationship(relative.sex, "Son", "Daughter", "Child");
    if (subjectIsChild && relativeIsPartner) return genderedRelationship(relative.sex, "Father", "Mother", "Parent");
    if (subjectIsChild && relativeIsChild) return genderedRelationship(relative.sex, "Brother", "Sister", "Sibling");
  }
  return "Linked relative";
}

function buildPersonSources(
  person: PersonSummary,
  sourceDocuments: SourceDocument[],
  relevantCases: ResearchCase[],
  includeDemoMedia: boolean
): PersonProfileSource[] {
  const directSources: PersonProfileSource[] = sourceDocuments
    .filter((source) => source.linkedPersonId === person.id)
    .map((source) => ({
      id: source.id,
      title: previewText(source.title, 180) ?? "Untitled source",
      sourceType: previewText(source.sourceType, 100) ?? "Source record",
      repository: previewText(source.repository, 140),
      citationDate: previewText(source.citationDate, 80),
      summary: previewText(source.transcript, 520),
      confidence: source.confidence,
      supportCount: 1,
      origin: "source-record" as const,
      media: includeDemoMedia ? demoArchiveMediaForSource(source.id) : undefined
    }));

  const caseEvidence: PersonProfileSource[] = relevantCases.flatMap((researchCase) =>
    researchCase.evidence
      .filter((evidence) => evidence.linkedPersonId === person.id)
      .map((evidence) => ({
        id: `${researchCase.id}:${evidence.id}`,
        title: previewText(evidence.title, 180) ?? "Untitled evidence",
        sourceType: previewText(evidence.type, 100) ?? "Case evidence",
        repository: previewText(researchCase.title, 140),
        summary: previewText(evidence.summary, 520),
        confidence: evidence.confidence,
        supportCount: 1,
        origin: "case-evidence" as const,
        media: includeDemoMedia ? demoArchiveMediaForEvidence(evidence.id) : undefined
      }))
  );

  const factsByCitation = new Map<string, PersonProfileFact[]>();
  for (const fact of person.facts) {
    const citation = fact.source?.trim();
    if (!citation) continue;
    factsByCitation.set(citation, [
      ...(factsByCitation.get(citation) ?? []),
      { ...fact, label: factTypeLabel(fact.type) }
    ]);
  }
  const factCitations: PersonProfileSource[] = [...factsByCitation.entries()].map(([citation, facts], index) => {
    const recordId = factMediaRecordIds.get(factMediaKey(person.id, citation));
    const labels = [...new Set(facts.map((fact) => fact.label))];
    const dates = [...new Set(facts.flatMap((fact) => fact.date ? [fact.date] : []))];
    return {
      id: `${person.id}:fact-citation:${index}`,
      title: previewText(citation, 180) ?? "Untitled citation",
      sourceType: sourceTypeForFacts(facts),
      repository: "Fact-level citation",
      citationDate: dates.join("; ") || undefined,
      summary: `Cited for ${joinList(labels.map((label) => label.toLowerCase()))}.`,
      confidence: average(facts.map((fact) => fact.confidence)),
      supportCount: facts.length,
      origin: "fact-citation",
      media: includeDemoMedia && recordId ? demoArchiveMediaForRecord(recordId) : undefined
    };
  });

  return [...directSources, ...caseEvidence, ...factCitations];
}

function deduplicatePersonSources(sources: PersonProfileSource[]): PersonProfileSource[] {
  const uniqueSources: PersonProfileSource[] = [];
  const indexByRecordId = new Map<string, number>();

  for (const source of sources) {
    const recordId = source.media?.recordId;
    if (!recordId) {
      uniqueSources.push(source);
      continue;
    }

    const canonicalSource = sourceWithCanonicalMediaMetadata(source);

    const existingIndex = indexByRecordId.get(recordId);
    if (existingIndex === undefined) {
      indexByRecordId.set(recordId, uniqueSources.length);
      uniqueSources.push(canonicalSource);
      continue;
    }

    const existing = uniqueSources[existingIndex];
    uniqueSources[existingIndex] = {
      ...existing,
      confidence: Math.max(existing.confidence, canonicalSource.confidence),
      supportCount: existing.supportCount + canonicalSource.supportCount,
      summary: mergeSourceSummaries(existing.summary, canonicalSource.summary)
    };
  }

  return uniqueSources;
}

function sourceWithCanonicalMediaMetadata(source: PersonProfileSource): PersonProfileSource {
  if (!source.media) return source;

  return {
    ...source,
    title: source.media.title,
    sourceType: source.media.kind,
    repository: source.media.catalogId,
    citationDate: source.media.date
  };
}

function mergeSourceSummaries(...summaries: (string | undefined)[]): string | undefined {
  const distinctSummaries = [...new Set(summaries.flatMap((summary) => summary?.trim() ? [summary.trim()] : []))];
  return previewText(distinctSummaries.join(" "), 1_000);
}

function buildIdentityTrail(
  person: PersonSummary,
  facts: PersonProfileFact[]
): PersonIdentityEntry[] {
  const nameFacts = facts.filter((fact) => fact.type.trim().toUpperCase() === "NAME" && fact.value?.trim());
  if (nameFacts.length === 0) return [];

  const primaryEntry: PersonIdentityEntry = {
    id: `${person.id}-profile-name`,
    name: person.displayName,
    kind: "profile"
  };

  return [
    primaryEntry,
    ...nameFacts.map((fact): PersonIdentityEntry => ({
      id: fact.id,
      name: fact.value?.trim() ?? person.displayName,
      date: fact.date,
      place: fact.place,
      source: fact.source,
      confidence: fact.confidence,
      kind: "recorded"
    }))
  ].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "profile" ? -1 : 1;
    return genealogicalDateSortKey(left.date ?? "") - genealogicalDateSortKey(right.date ?? "")
      || (left.date ?? "").localeCompare(right.date ?? "")
      || left.name.localeCompare(right.name);
  });
}

function buildProfileInsights(
  person: PersonSummary,
  facts: PersonProfileFact[],
  sourceTotal: number,
  relevantCases: ResearchCase[]
): PersonProfileInsight[] {
  const sourcedFacts = facts.filter((fact) => Boolean(fact.source?.trim()));
  const confidence = facts.length > 0 ? average(facts.map((fact) => fact.confidence)) : 0;
  const datedFacts = facts.filter((fact) => extractYear(fact.date) !== undefined);
  const years = datedFacts.flatMap((fact) => {
    const year = extractYear(fact.date);
    return year === undefined ? [] : [year];
  });
  const datedPlaces = [...new Set(datedFacts.flatMap((fact) => fact.place ? [fact.place] : []))];
  const allPlaces = [...new Set(facts.flatMap((fact) => fact.place ? [fact.place] : []))];
  const weakestFact = [...facts].sort((left, right) => left.confidence - right.confidence)[0];
  const unsourcedFact = facts.find((fact) => !fact.source?.trim());
  const insights: PersonProfileInsight[] = [
    {
      id: "evidence-coverage",
      title: "Evidence coverage",
      summary: facts.length > 0
        ? `${sourcedFacts.length} of ${facts.length} profile facts carry a citation, across ${sourceTotal} source and evidence cards.`
        : "This profile has no structured facts to assess yet.",
      detail: facts.length > 0
        ? `Average fact confidence is ${Math.round(confidence * 100)}%.`
        : "Add one dated fact and a citation to establish an evidence baseline.",
      confidence: facts.length > 0 ? confidence : undefined,
      tone: sourcedFacts.length === facts.length && facts.length > 0 ? "ok" : "attention"
    },
    {
      id: "timeline-pattern",
      title: "Timeline pattern",
      summary: years.length > 0
        ? timelinePatternSummary(datedFacts.length, years, datedPlaces)
        : "No reliably dated events are available for chronology review.",
      detail: allPlaces.length > 1
        ? `The record moves between ${joinList(allPlaces)}; location changes are useful targets for independent corroboration.`
        : `The saved facts remain centered on ${allPlaces[0] ?? person.birthPlace ?? "an unknown place"}.`,
      tone: years.length > 1 ? "ok" : "neutral"
    },
    {
      id: "research-priority",
      title: "Suggested next check",
      summary: unsourcedFact
        ? `Find a source for the ${unsourcedFact.label.toLowerCase()} entry${unsourcedFact.date ? ` dated ${unsourcedFact.date}` : ""}.`
        : weakestFact
          ? `Corroborate the ${weakestFact.label.toLowerCase()} entry${weakestFact.date ? ` dated ${weakestFact.date}` : ""}; it is the profile's lowest-confidence fact.`
          : "Add a birth, residence, or relationship fact before drawing a conclusion.",
      detail: "This is a deterministic, read-only profile suggestion based on saved citations and confidence values.",
      confidence: weakestFact?.confidence,
      tone: "attention"
    }
  ];

  if (relevantCases.length > 0) {
    const caseInsights = relevantCases.map((researchCase): PersonProfileInsight => {
      const evidenceCount = researchCase.evidence.filter((evidence) => evidence.linkedPersonId === person.id).length;
      const connectedCaseSummary = `${evidenceCount} evidence item${evidenceCount === 1 ? "" : "s"} connect this profile to ${researchCase.title}`;
      return {
        id: `case-connection:${researchCase.id}`,
        title: "Connected mystery",
        summary: `${connectedCaseSummary}${/[.!?]$/.test(connectedCaseSummary) ? "" : "."}`,
        detail: previewText(researchCase.question, 520) ?? "Open the case to compare its working hypotheses and research trail.",
        tone: "neutral",
        href: `/app/cases/${encodeURIComponent(researchCase.id)}`,
        actionLabel: "Open connected case"
      };
    });
    insights.splice(2, 0, ...caseInsights);
  }

  return insights;
}

function timelinePatternSummary(eventCount: number, years: number[], places: string[]): string {
  const firstYear = Math.min(...years);
  const lastYear = Math.max(...years);
  const yearRange = firstYear === lastYear ? String(firstYear) : `${firstYear}–${lastYear}`;
  const eventText = `${eventCount} dated event${eventCount === 1 ? "" : "s"}`;
  const placeText = places.length === 0
    ? "with no recorded place"
    : `across ${places.length} recorded place${places.length === 1 ? "" : "s"}`;
  return `${eventText} ${eventCount === 1 ? "is" : "are"} recorded in ${yearRange}, ${placeText}.`;
}

function compareTimelineEvents(left: PersonTimelineEvent, right: PersonTimelineEvent): number {
  const leftKey = genealogicalDateSortKey(left.date);
  const rightKey = genealogicalDateSortKey(right.date);
  return leftKey - rightKey || left.date.localeCompare(right.date) || left.label.localeCompare(right.label);
}

function genealogicalDateSortKey(value: string): number {
  const year = extractYear(value);
  if (year === undefined) return Number.POSITIVE_INFINITY;

  const isoDate = value.match(/\b(?:1[0-9]{3}|20[0-9]{2})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])\b/);
  if (isoDate) return year * 10_000 + Number(isoDate[1]) * 100 + Number(isoDate[2]);

  const monthNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const monthMatch = value.toUpperCase().match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b/);
  const month = monthMatch ? monthNames.indexOf(monthMatch[1]) + 1 : 0;
  const dayMatch = monthMatch
    ? value.toUpperCase().match(/\b([0-2]?[0-9]|3[01])\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\b/)
    : undefined;
  const day = dayMatch ? Number(dayMatch[1]) : 0;
  return year * 10_000 + month * 100 + day;
}

function extractYear(value?: string): number | undefined {
  const match = value?.match(/\b(1[0-9]{3}|20[0-9]{2})\b/);
  return match ? Number(match[1]) : undefined;
}

function sourceTypeForFacts(facts: PersonProfileFact[]): string {
  const types = new Set(facts.map((fact) => fact.type.trim().toUpperCase()));
  if ([...types].every((type) => ["BIRT", "DEAT", "MARR", "BAPM", "BURI"].includes(type))) {
    return "Vital record citation";
  }
  if ([...types].some((type) => ["IMMI", "EMIG"].includes(type))) return "Migration record citation";
  if ([...types].some((type) => ["RESI", "OCCU"].includes(type))) return "Directory citation";
  return "Genealogical citation";
}

function lifeSummary(person: PersonSummary): string {
  const birth = person.birthDate ?? "Unknown birth";
  const death = person.deathDate ?? (person.livingStatus === "deceased" ? "Unknown death" : "Living");
  return `${birth} – ${death}`;
}

function genderedRelationship(
  sex: PersonSummary["sex"],
  male: string,
  female: string,
  unknown: string
): string {
  return sex === "M" ? male : sex === "F" ? female : unknown;
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;
}

function joinList(values: string[]): string {
  if (values.length === 0) return "none";
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function previewText(value: string | undefined, maximumLength: number): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (normalized.length <= maximumLength) return normalized;
  return `${normalized.slice(0, maximumLength - 1).trimEnd()}…`;
}

function factMediaKey(personId: string, source: string): string {
  return `${personId}\u0000${source}`;
}
