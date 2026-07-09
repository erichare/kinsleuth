import type { DnaConnectionHypothesis, PersonSummary, ResearchCase, Role } from "./models";
import { assertPermission } from "./rbac";

export type AIProviderConfig = {
  baseUrl: string;
  apiKey?: string;
  chatModel: string;
  embeddingModel: string;
};

export type StructuredAnomaly = {
  type: "date_conflict" | "privacy_risk" | "missing_source" | "relationship_gap";
  title: string;
  severity: "low" | "medium" | "high";
  evidence: string[];
};

export type AIAnalysisRequest = {
  role: Role;
  question: string;
  people: PersonSummary[];
  cases: ResearchCase[];
  dnaHypotheses: DnaConnectionHypothesis[];
  provider: AIProviderConfig;
};

export type AIAnalysisResult = {
  status: "ready" | "configuration_required";
  answer: string;
  anomalies: StructuredAnomaly[];
  evidenceUsed: string[];
  uncertainty: string[];
};

export function findStructuredAnomalies(people: PersonSummary[]): StructuredAnomaly[] {
  const anomalies: StructuredAnomaly[] = [];

  for (const person of people) {
    if (person.published && person.livingStatus === "living") {
      anomalies.push({
        type: "privacy_risk",
        title: `${person.displayName} appears published while living`,
        severity: "high",
        evidence: [`livingStatus=${person.livingStatus}`, `privacy=${person.privacy}`]
      });
    }

    const birthYear = extractYear(person.birthDate);
    const deathYear = extractYear(person.deathDate);
    if (birthYear && deathYear && deathYear < birthYear) {
      anomalies.push({
        type: "date_conflict",
        title: `${person.displayName} has death before birth`,
        severity: "high",
        evidence: [`Birth ${person.birthDate}`, `Death ${person.deathDate}`]
      });
    }

    for (const fact of person.facts) {
      if (!fact.source && ["BIRT", "DEAT", "MARR"].includes(fact.type)) {
        anomalies.push({
          type: "missing_source",
          title: `${person.displayName} has unsourced ${fact.type}`,
          severity: "medium",
          evidence: [fact.date ?? "no date", fact.place ?? "no place"]
        });
      }
    }
  }

  return anomalies;
}

export async function runAIAnalysis(request: AIAnalysisRequest): Promise<AIAnalysisResult> {
  assertPermission(request.role, "ai:whole-tree");

  const anomalies = findStructuredAnomalies(request.people);
  const localAnswer = buildLocalAnalysis({ ...request, anomalies });
  const evidenceUsed = [
    `${request.people.length} people`,
    `${request.cases.length} cases`,
    `${request.dnaHypotheses.length} DNA hypotheses`,
    `${anomalies.length} structured anomalies`,
    ...selectEvidenceHighlights(request.dnaHypotheses, anomalies)
  ];

  if (!request.provider.apiKey) {
    return {
      status: "configuration_required",
      answer: localAnswer,
      anomalies,
      evidenceUsed,
      uncertainty: [
        "No external AI call was made because AI_API_KEY is empty.",
        "This local analysis uses structured workspace data only; source transcripts and notes are not semantically ranked yet."
      ]
    };
  }

  return {
    status: "ready",
    answer: [
      localAnswer,
      "Provider-ready prompt:",
      buildAnalysisPrompt(request)
    ].join("\n\n"),
    anomalies,
    evidenceUsed,
    uncertainty: [
      "This result is a retrieval-grounded research aid, not proof.",
      "DNA relationship ranges overlap and require documentary corroboration."
    ]
  };
}

export function buildAnalysisPrompt(request: AIAnalysisRequest): string {
  const caseTitles = request.cases.map((researchCase) => researchCase.title).join(", ") || "no cases";
  const dnaSummary = request.dnaHypotheses
    .map((hypothesis) => `${hypothesis.likelyBranch}: ${hypothesis.candidateCommonAncestors.join(", ")}`)
    .join("; ");

  return [
    `Question: ${request.question}`,
    `Cases: ${caseTitles}`,
    `DNA hypotheses: ${dnaSummary || "none"}`,
    "Explain evidence, confidence, and uncertainty. Do not state hypotheses as facts."
  ].join("\n");
}

function buildLocalAnalysis(request: Omit<AIAnalysisRequest, "provider"> & { anomalies: StructuredAnomaly[] }): string {
  const topHypothesis = [...request.dnaHypotheses].sort((left, right) => right.confidence - left.confidence)[0];
  const activeCase = request.cases.find((researchCase) => researchCase.status === "active") ?? request.cases[0];
  const highRisk = request.anomalies.filter((anomaly) => anomaly.severity === "high");
  const missingSources = request.anomalies.filter((anomaly) => anomaly.type === "missing_source");

  const recommendation = topHypothesis
    ? `Start with ${topHypothesis.likelyBranch}. ${topHypothesis.explanation}`
    : "Start by creating or importing DNA matches with known surnames, places, and shared matches so KinSleuth can rank connection hypotheses.";

  const corroboration = activeCase
    ? `Tie that work back to "${activeCase.title}" and test whether the next evidence item supports or weakens the current case question: ${activeCase.question}`
    : "Create a focused research case before doing broad tree work, so each source check has a decision to support or weaken.";

  const sourceWork = missingSources.length
    ? `Before publishing, resolve the highest-value source gaps first: ${missingSources.slice(0, 3).map((item) => item.title).join("; ")}.`
    : "The structured pass did not find vital-event source gaps in the current workspace slice.";

  const privacyWork = highRisk.length
    ? `Privacy needs attention now: ${highRisk.map((item) => item.title).join("; ")}.`
    : "No high-risk living-person publication conflicts were found in the structured pass.";

  return [
    `Question: ${request.question}`,
    `Recommendation: ${recommendation}`,
    `Next check: ${corroboration}`,
    `Evidence hygiene: ${sourceWork}`,
    `Publication safety: ${privacyWork}`
  ].join("\n\n");
}

function selectEvidenceHighlights(dnaHypotheses: DnaConnectionHypothesis[], anomalies: StructuredAnomaly[]): string[] {
  const hypothesisHighlights = [...dnaHypotheses]
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, 2)
    .map((hypothesis) => `${hypothesis.likelyBranch} hypothesis (${Math.round(hypothesis.confidence * 100)}% confidence)`);

  const anomalyHighlights = anomalies
    .slice(0, 2)
    .map((anomaly) => `${anomaly.severity} ${anomaly.type}: ${anomaly.title}`);

  return [...hypothesisHighlights, ...anomalyHighlights];
}

function extractYear(dateText?: string): number | undefined {
  const match = dateText?.match(/(\d{4})/);
  return match ? Number(match[1]) : undefined;
}
