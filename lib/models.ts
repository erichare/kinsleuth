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

export type ResearchCase = {
  id: string;
  title: string;
  question: string;
  status: "active" | "planning" | "paused" | "resolved";
  focus: string;
  privacy: PrivacyLevel;
  hypotheses: Array<{
    id: string;
    statement: string;
    confidence: number;
    status: "open" | "supported" | "weakened" | "rejected";
  }>;
  evidence: Array<{
    id: string;
    title: string;
    type: string;
    summary: string;
    confidence: number;
    linkedPersonId?: string;
    linkedDnaMatchId?: string;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    status: "todo" | "doing" | "done";
  }>;
};

export type SourceDocument = {
  id: string;
  title: string;
  sourceType: string;
  fileName?: string;
  storageKey?: string;
  mimeType?: string;
  size?: number;
  repository?: string;
  citationDate?: string;
  linkedPersonId?: string;
  linkedCaseId?: string;
  transcript?: string;
  notes?: string;
  privacy: PrivacyLevel;
  confidence: number;
  createdAt: string;
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
