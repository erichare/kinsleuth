export type Role = "owner" | "admin" | "editor" | "contributor" | "viewer";

export type PrivacyLevel = "public" | "private" | "sensitive";

export type Confidence = "low" | "medium" | "high";

export type PersonFact = {
  id: string;
  type: string;
  date?: string;
  place?: string;
  value?: string;
  source?: string;
  confidence: number;
  privacy?: PrivacyLevel;
};

export type PersonSummary = {
  id: string;
  slug: string;
  displayName: string;
  givenName?: string;
  surname?: string;
  birthDate?: string;
  birthPlace?: string;
  deathDate?: string;
  deathPlace?: string;
  sex?: "M" | "F" | "U";
  livingStatus: "living" | "deceased" | "unknown";
  privacy: PrivacyLevel;
  published: boolean;
  facts: PersonFact[];
  relatives: string[];
  notes?: string;
};

export type ResearchReference = {
  type: "case" | "hypothesis" | "evidence" | "task";
  id: string;
};

export type ResearchHypothesisDecision = {
  id: string;
  requestId: string;
  fromStatus: ResearchHypothesis["status"];
  toStatus: ResearchHypothesis["status"];
  statement: string;
  reason: string;
  contextRefs: ResearchReference[];
  actorId: string;
  actorName: string;
  createdAt: string;
};

export type ResearchHypothesis = {
  id: string;
  statement: string;
  confidence: number;
  status: "open" | "supported" | "weakened" | "rejected";
  decisions?: ResearchHypothesisDecision[];
  updatedAt?: string;
};

export type ResearchEvidence = {
  id: string;
  title: string;
  type: string;
  summary: string;
  confidence: number;
  linkedPersonId?: string;
  linkedDnaMatchId?: string;
};

export type ResearchSearchScope = {
  repository: string;
  collection?: string;
  place?: string;
  dateRange?: string;
  query?: string;
};

export type ResearchTaskOutcome = {
  id: string;
  requestId: string;
  type: "found" | "not_found" | "inconclusive" | "blocked" | "already_tried";
  note: string;
  searchScope?: ResearchSearchScope;
  actorId: string;
  actorName: string;
  createdAt: string;
  correctsOutcomeId?: string;
};

export type ResearchTask = {
  id: string;
  title: string;
  status: "todo" | "doing" | "done";
  origin?: "manual" | "guide";
  priority?: "high" | "normal" | "low";
  guideKey?: string;
  workFingerprint?: string;
  guidance?: string;
  targetHypothesisId?: string;
  contextRefs?: ResearchReference[];
  outcomes?: ResearchTaskOutcome[];
  createdAt?: string;
  completedAt?: string;
  updatedAt?: string;
};

export type ResearchCase = {
  id: string;
  title: string;
  question: string;
  status: "active" | "planning" | "paused" | "resolved";
  focus: string;
  privacy: PrivacyLevel;
  hypotheses: ResearchHypothesis[];
  evidence: ResearchEvidence[];
  tasks: ResearchTask[];
};

export type AIAnalysisStatus = "ready" | "configuration_required" | "provider_error";

export type AIContextReference = {
  id: string;
  type: "person" | "case" | "source" | "dna_match" | "hypothesis" | "anomaly" | "task" | "evidence";
  label: string;
  summary?: string;
};

export type AIStagedSuggestion = {
  id: string;
  type: "task" | "evidence_check" | "source_gap" | "privacy_review";
  title: string;
  summary: string;
  linkedCaseId?: string;
  contextRefs: string[];
  confidence: number;
};

export type AIAnalysisRun = {
  id: string;
  question: string;
  answer: string;
  status: AIAnalysisStatus;
  evidenceUsed: string[];
  uncertainty: string[];
  anomalyCount: number;
  suggestions: AIStagedSuggestion[];
  contextReferences: AIContextReference[];
  provider?: string;
  model?: string;
  providerStatus?: "not_configured" | "completed" | "failed";
  promptPreview?: string;
  error?: string;
  linkedCaseId?: string;
  createdAt: string;
  completedAt?: string;
};

export type SourceDocument = {
  id: string;
  title: string;
  sourceType: string;
  importId?: string;
  rawRecordId?: string;
  fileName?: string;
  storageKey?: string;
  mimeType?: string;
  size?: number;
  repository?: string;
  url?: string;
  ancestryApid?: string;
  citationDate?: string;
  linkedPersonId?: string;
  linkedCaseId?: string;
  transcript?: string;
  notes?: string;
  privacy: PrivacyLevel;
  confidence: number;
  createdAt: string;
};

export type RawGedcomRecord = {
  id: string;
  importId: string;
  xref?: string;
  type: string;
  checksum: string;
  raw: string;
};

export type AppliedGedcomImport = {
  id: string;
  sourceName: string;
  checksum: string;
  appliedAt: string;
  summary: ImportSummary;
  recordCount: number;
  peopleImported: number;
  sourcesImported: number;
  rawRecordCount: number;
  backupId: string;
};

export type WorkspaceBackup = {
  id: string;
  createdAt: string;
  reason: string;
  storageKey: string;
  peopleCount: number;
  sourcesCount: number;
  casesCount: number;
  dnaMatchCount: number;
  importCount: number;
  rawRecordCount: number;
};

export type DnaSide = "maternal" | "paternal" | "both" | "unknown";

export type DnaTreeStatus = "none" | "private" | "partial" | "public" | "unknown";

export type DnaMatch = {
  id: string;
  displayName: string;
  totalCm: number;
  longestSegmentCm?: number;
  sharedDnaPercent?: number;
  predictedRelationship?: string;
  side: DnaSide;
  treeStatus: DnaTreeStatus;
  surnames: string[];
  places: string[];
  sharedMatches: string[];
  notes: string;
  ancestryUrl?: string;
  triageStatus: "needs_review" | "triaged" | "ignored" | "high_priority";
};

export type DnaConnectionHypothesis = {
  matchId: string;
  likelyBranch: string;
  likelyGeneration: string;
  geography: string[];
  candidateCommonAncestors: string[];
  confidence: number;
  evidence: string[];
  uncertainty: string[];
  explanation: string;
};

export type ImportSummary = {
  individuals: number;
  families: number;
  sources: number;
  media: number;
  notes: number;
  sourceReferences: number;
  urls: number;
  ancestryApids: number;
  dateRange?: {
    minYear?: number;
    maxYear?: number;
  };
};
