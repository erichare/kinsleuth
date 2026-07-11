import type {
  AIAnalysisStatus,
  AIContextReference,
  AIStagedSuggestion,
  DnaConnectionHypothesis,
  DnaMatch,
  PersonSummary,
  ResearchCase,
  Role,
  SourceDocument
} from "./models";
import { assertPermission } from "./rbac";

export type AIProviderMode = "responses" | "chat";

export type AIProviderConfig = {
  baseUrl: string;
  apiKey?: string;
  chatModel: string;
  embeddingModel: string;
  mode?: AIProviderMode;
  fetcher?: typeof fetch;
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
  selectedCaseId?: string;
  people: PersonSummary[];
  cases: ResearchCase[];
  sources: SourceDocument[];
  dnaMatches: DnaMatch[];
  dnaHypotheses: DnaConnectionHypothesis[];
  provider: AIProviderConfig;
};

export type AIAnalysisResult = {
  status: AIAnalysisStatus;
  providerStatus: "not_configured" | "completed" | "failed";
  provider: string;
  model: string;
  answer: string;
  anomalies: StructuredAnomaly[];
  evidenceUsed: string[];
  uncertainty: string[];
  suggestions: AIStagedSuggestion[];
  contextReferences: AIContextReference[];
  promptPreview: string;
  error?: string;
};

type PromptPack = {
  prompt: string;
  preview: string;
  references: AIContextReference[];
  evidenceUsed: string[];
  truncated: boolean;
};

type ProviderPayload = {
  answer?: unknown;
  uncertainty?: unknown;
  suggestions?: unknown;
  evidenceUsed?: unknown;
  contextReferences?: unknown;
};

const promptCharacterLimit = 28_000;

export function findStructuredAnomalies(people: PersonSummary[]): StructuredAnomaly[] {
  const anomalies: StructuredAnomaly[] = [];

  for (const person of people) {
    if (person.published && person.livingStatus !== "deceased") {
      anomalies.push({
        type: "privacy_risk",
        title:
          person.livingStatus === "living"
            ? `${person.displayName} appears published while living`
            : `${person.displayName} is marked published without confirmed death evidence`,
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
  const promptPack = buildPromptPack(request, anomalies);
  const deterministicSuggestions = buildDeterministicSuggestions(request, anomalies);
  const provider = providerLabel(request.provider.baseUrl);
  const model = request.provider.chatModel;

  if (!request.provider.apiKey) {
    return {
      status: "configuration_required",
      providerStatus: "not_configured",
      provider,
      model,
      answer: localAnswer,
      anomalies,
      evidenceUsed: promptPack.evidenceUsed,
      suggestions: deterministicSuggestions,
      contextReferences: promptPack.references,
      promptPreview: promptPack.preview,
      uncertainty: [
        "No external AI call was made because AI_API_KEY or OPENAI_API_KEY is empty.",
        "This local analysis uses structured workspace checks and ranked context, but no provider generation."
      ]
    };
  }

  try {
    const providerText = await callAIProvider(request.provider, promptPack.prompt);
    const parsed = parseProviderPayload(providerText);
    const suggestions = normalizeSuggestions(parsed.suggestions, request, deterministicSuggestions);
    const uncertainty = normalizeStringArray(parsed.uncertainty);
    const evidenceUsed = normalizeStringArray(parsed.evidenceUsed);
    const contextReferences = normalizeContextReferences(parsed.contextReferences);

    return {
      status: "ready",
      providerStatus: "completed",
      provider,
      model,
      answer: normalizeProviderAnswer(parsed.answer, providerText),
      anomalies,
      evidenceUsed: evidenceUsed.length ? evidenceUsed : promptPack.evidenceUsed,
      suggestions: suggestions.length ? suggestions : deterministicSuggestions,
      contextReferences: contextReferences.length ? contextReferences : promptPack.references,
      promptPreview: promptPack.preview,
      uncertainty: uncertainty.length
        ? uncertainty
        : [
            "This result is a retrieval-grounded research aid, not proof.",
            "DNA relationship ranges overlap and require documentary corroboration."
          ]
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Provider request failed";
    return {
      status: "provider_error",
      providerStatus: "failed",
      provider,
      model,
      answer: localAnswer,
      anomalies,
      evidenceUsed: promptPack.evidenceUsed,
      suggestions: deterministicSuggestions,
      contextReferences: promptPack.references,
      promptPreview: promptPack.preview,
      error: message,
      uncertainty: [
        `Provider call failed: ${message}`,
        "KinSleuth saved a local deterministic fallback so the research thread is not lost."
      ]
    };
  }
}

export function buildAnalysisPrompt(request: AIAnalysisRequest): string {
  return buildPromptPack(request, findStructuredAnomalies(request.people)).prompt;
}

export function buildPromptPack(request: AIAnalysisRequest, anomalies: StructuredAnomaly[]): PromptPack {
  const selectedCase = request.selectedCaseId ? request.cases.find((researchCase) => researchCase.id === request.selectedCaseId) : undefined;
  const references: AIContextReference[] = [];
  const sections: string[] = [
    "You are the KinSleuth AI Analyst for a private family-history workspace.",
    "Use the full private context below. Do not treat hypotheses as facts. Separate evidence from inference.",
    "Return JSON only with this shape: {\"answer\":\"...\",\"uncertainty\":[\"...\"],\"evidenceUsed\":[\"...\"],\"contextReferences\":[{\"id\":\"...\",\"type\":\"person|case|source|dna_match|hypothesis|anomaly|task|evidence\",\"label\":\"...\",\"summary\":\"...\"}],\"suggestions\":[{\"type\":\"task|evidence_check|source_gap|privacy_review\",\"title\":\"...\",\"summary\":\"...\",\"linkedCaseId\":\"optional\",\"contextRefs\":[\"id\"],\"confidence\":0.0}]}",
    `Research question: ${request.question}`,
    selectedCase ? `Selected case: ${selectedCase.title} (${selectedCase.id}) - ${selectedCase.question}` : "Selected case: none"
  ];

  const addReference = (reference: AIContextReference): void => {
    if (!references.some((item) => item.id === reference.id && item.type === reference.type)) {
      references.push(reference);
    }
  };

  const append = (heading: string, lines: string[]): void => {
    if (!lines.length) {
      return;
    }
    sections.push(`\n## ${heading}\n${lines.join("\n")}`);
  };

  append(
    "Cases",
    rankCases(request.cases, request.question, request.selectedCaseId).map((researchCase) => {
      addReference({
        id: researchCase.id,
        type: "case",
        label: researchCase.title,
        summary: researchCase.question
      });
      for (const task of researchCase.tasks) {
        addReference({ id: task.id, type: "task", label: task.title, summary: `${researchCase.title}: ${task.status}` });
      }
      for (const evidence of researchCase.evidence) {
        addReference({ id: evidence.id, type: "evidence", label: evidence.title, summary: evidence.summary });
      }
      return [
        `Case ${researchCase.id}: ${researchCase.title}`,
        `Question: ${researchCase.question}`,
        `Status/privacy/focus: ${researchCase.status}; ${researchCase.privacy}; ${researchCase.focus}`,
        `Hypotheses: ${researchCase.hypotheses.map((item) => `${item.statement} (${Math.round(item.confidence * 100)}%, ${item.status})`).join(" | ") || "none"}`,
        `Evidence: ${researchCase.evidence.map((item) => `${item.id}: ${item.title}; ${item.type}; ${item.summary}; confidence ${Math.round(item.confidence * 100)}%`).join(" | ") || "none"}`,
        `Tasks: ${researchCase.tasks.map((item) => `${item.id}: ${item.title} [${item.status}]`).join(" | ") || "none"}`
      ].join("\n");
    })
  );

  append(
    "People And Facts",
    rankPeople(request.people, request.question, selectedCase).map((person) => {
      addReference({
        id: person.id,
        type: "person",
        label: person.displayName,
        summary: [person.birthDate, person.birthPlace, person.deathDate, person.deathPlace].filter(Boolean).join(" - ")
      });
      return [
        `Person ${person.id}: ${person.displayName} (${person.slug})`,
        `Names: ${[person.givenName, person.surname].filter(Boolean).join(" ") || "unknown"}; sex=${person.sex ?? "unknown"}`,
        `Vital: birth ${person.birthDate ?? "unknown"} in ${person.birthPlace ?? "unknown"}; death ${person.deathDate ?? "unknown"} in ${person.deathPlace ?? "unknown"}`,
        `Privacy/publication: ${person.livingStatus}; ${person.privacy}; published=${person.published}`,
        `Relatives: ${person.relatives.join(", ") || "none"}`,
        `Notes: ${person.notes ?? "none"}`,
        `Facts: ${person.facts.map((fact) => `${fact.id}: ${fact.type}; ${fact.date ?? "no date"}; ${fact.place ?? "no place"}; source=${fact.source ?? "missing"}; confidence=${Math.round(fact.confidence * 100)}%; privacy=${fact.privacy ?? person.privacy}`).join(" | ") || "none"}`
      ].join("\n");
    })
  );

  append(
    "Sources",
    rankSources(request.sources, request.question, request.selectedCaseId).map((source) => {
      addReference({
        id: source.id,
        type: "source",
        label: source.title,
        summary: [source.sourceType, source.repository, source.citationDate].filter(Boolean).join(" - ")
      });
      return [
        `Source ${source.id}: ${source.title}`,
        `Type/repository/date: ${source.sourceType}; ${source.repository ?? "unknown"}; ${source.citationDate ?? "unknown"}`,
        `Links: person=${source.linkedPersonId ?? "none"}; case=${source.linkedCaseId ?? "none"}; raw=${source.rawRecordId ?? "none"}`,
        `Privacy/confidence: ${source.privacy}; ${Math.round(source.confidence * 100)}%`,
        `Transcript: ${truncate(source.transcript ?? "none", 1200)}`,
        `Notes: ${truncate(source.notes ?? "none", 800)}`
      ].join("\n");
    })
  );

  append(
    "DNA Matches And Hypotheses",
    rankDnaMatches(request.dnaMatches, request.dnaHypotheses, request.question).map(({ match, hypothesis }) => {
      addReference({
        id: match.id,
        type: "dna_match",
        label: match.displayName,
        summary: `${match.totalCm} cM; ${match.predictedRelationship ?? "relationship unknown"}; ${match.side} side`
      });
      if (hypothesis) {
        addReference({
          id: `hyp-${hypothesis.matchId}`,
          type: "hypothesis",
          label: hypothesis.likelyBranch,
          summary: hypothesis.explanation
        });
      }
      return [
        `DNA ${match.id}: ${match.displayName}; ${match.totalCm} cM; longest=${match.longestSegmentCm ?? "unknown"}; predicted=${match.predictedRelationship ?? "unknown"}`,
        `Tree/side/status: ${match.treeStatus}; ${match.side}; ${match.triageStatus}`,
        `Surnames: ${match.surnames.join(", ") || "none"}; Places: ${match.places.join(", ") || "none"}; Shared matches: ${match.sharedMatches.join(", ") || "none"}`,
        `Notes: ${match.notes || "none"}`,
        hypothesis
          ? `Hypothesis: ${hypothesis.likelyBranch}; generation=${hypothesis.likelyGeneration}; confidence=${Math.round(hypothesis.confidence * 100)}%; ancestors=${hypothesis.candidateCommonAncestors.join(", ") || "none"}; evidence=${hypothesis.evidence.join(" | ")}; uncertainty=${hypothesis.uncertainty.join(" | ")}`
          : "Hypothesis: none"
      ].join("\n");
    })
  );

  append(
    "Structured Anomalies",
    anomalies.map((anomaly) => {
      const id = `anomaly-${slugify(anomaly.title)}`;
      addReference({ id, type: "anomaly", label: anomaly.title, summary: anomaly.evidence.join("; ") });
      return `${id}: ${anomaly.severity} ${anomaly.type}; ${anomaly.title}; evidence=${anomaly.evidence.join(" | ")}`;
    })
  );

  let prompt = sections.join("\n");
  let truncated = false;
  if (prompt.length > promptCharacterLimit) {
    prompt = `${prompt.slice(0, promptCharacterLimit)}\n\n[Context truncated by relevance ranking at ${promptCharacterLimit} characters.]`;
    truncated = true;
  }

  const evidenceUsed = [
    `${request.people.length} people`,
    `${request.cases.length} cases`,
    `${request.sources.length} sources`,
    `${request.dnaMatches.length} DNA matches`,
    `${request.dnaHypotheses.length} DNA hypotheses`,
    `${anomalies.length} structured anomalies`,
    ...references.slice(0, 10).map((reference) => `${reference.type}: ${reference.label}`)
  ];

  return {
    prompt,
    preview: [
      `Question: ${request.question}`,
      selectedCase ? `Selected case: ${selectedCase.title}` : "Selected case: none",
      `Context counts: ${request.people.length} people, ${request.cases.length} cases, ${request.sources.length} sources, ${request.dnaMatches.length} DNA matches, ${anomalies.length} anomalies.`,
      `Context refs: ${references.slice(0, 12).map((reference) => `${reference.type}:${reference.id}`).join(", ") || "none"}`,
      truncated ? "Prompt preview note: full prompt was truncated before provider call." : "Prompt preview note: prompt fit within the provider context budget."
    ].join("\n"),
    references,
    evidenceUsed,
    truncated
  };
}

async function callAIProvider(provider: AIProviderConfig, prompt: string): Promise<string> {
  const mode = provider.mode ?? "responses";
  const fetcher = provider.fetcher ?? fetch;
  const endpoint = `${provider.baseUrl.replace(/\/+$/, "")}${mode === "chat" ? "/chat/completions" : "/responses"}`;
  const headers = {
    "authorization": `Bearer ${provider.apiKey}`,
    "content-type": "application/json"
  };
  const developerInstructions = "Return only valid JSON for KinSleuth. Keep claims cautious, cite context IDs, and stage suggestions for review instead of saying work was changed.";
  const body =
    mode === "chat"
      ? {
          model: provider.chatModel,
          messages: [
            { role: "developer", content: developerInstructions },
            { role: "user", content: prompt }
          ]
        }
      : {
          model: provider.chatModel,
          input: [
            { role: "developer", content: developerInstructions },
            { role: "user", content: prompt }
          ]
        };

  const response = await fetcher(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`Provider returned ${response.status}: ${truncate(raw, 240)}`);
  }

  const json = tryParseJson(raw);
  return extractProviderText(json) || raw;
}

function parseProviderPayload(providerText: string): ProviderPayload {
  const json = tryParseJson(stripJsonFence(providerText));
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return { answer: providerText };
  }
  return json as ProviderPayload;
}

function extractProviderText(value: unknown): string {
  if (!value || typeof value !== "object") {
    return "";
  }

  const payload = value as {
    output_text?: unknown;
    output?: Array<{ content?: Array<{ text?: unknown; type?: string }> }>;
    choices?: Array<{ message?: { content?: unknown } }>;
  };

  if (typeof payload.output_text === "string") {
    return payload.output_text;
  }

  const outputText = payload.output
    ?.flatMap((item) => item.content ?? [])
    .map((content) => (typeof content.text === "string" ? content.text : ""))
    .filter(Boolean)
    .join("\n");
  if (outputText) {
    return outputText;
  }

  const chatText = payload.choices?.[0]?.message?.content;
  return typeof chatText === "string" ? chatText : "";
}

function normalizeProviderAnswer(answer: unknown, fallback: string): string {
  return typeof answer === "string" && answer.trim() ? answer.trim() : fallback.trim();
}

function normalizeSuggestions(value: unknown, request: AIAnalysisRequest, fallback: AIStagedSuggestion[]): AIStagedSuggestion[] {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const normalized = value
    .map((item, index) => {
      if (!item || typeof item !== "object") {
        return undefined;
      }
      const suggestion = item as Partial<AIStagedSuggestion>;
      const type = isSuggestionType(suggestion.type) ? suggestion.type : "task";
      const title = typeof suggestion.title === "string" && suggestion.title.trim() ? suggestion.title.trim() : "";
      const summary = typeof suggestion.summary === "string" && suggestion.summary.trim() ? suggestion.summary.trim() : title;
      if (!title) {
        return undefined;
      }

      const linkedCaseId =
        typeof suggestion.linkedCaseId === "string" && request.cases.some((researchCase) => researchCase.id === suggestion.linkedCaseId)
          ? suggestion.linkedCaseId
          : request.selectedCaseId;

      return {
        id: suggestion.id ?? `sugg-provider-${index + 1}-${slugify(title)}`,
        type,
        title,
        summary,
        linkedCaseId,
        contextRefs: Array.isArray(suggestion.contextRefs) ? suggestion.contextRefs.map(String) : [],
        confidence: normalizeConfidence(typeof suggestion.confidence === "number" ? suggestion.confidence : 0.5)
      };
    })
    .filter(Boolean) as AIStagedSuggestion[];

  return normalized.length ? normalized.slice(0, 8) : fallback;
}

function normalizeContextReferences(value: unknown): AIContextReference[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return (value
    .map((item) => {
      if (!item || typeof item !== "object") {
        return undefined;
      }
      const reference = item as Partial<AIContextReference>;
      if (!reference.id || !reference.type || !reference.label) {
        return undefined;
      }
      return {
        id: String(reference.id),
        type: reference.type,
        label: String(reference.label),
        summary: typeof reference.summary === "string" ? reference.summary : undefined
      };
    })
    .filter(Boolean) as AIContextReference[]);
}

function buildDeterministicSuggestions(request: AIAnalysisRequest, anomalies: StructuredAnomaly[]): AIStagedSuggestion[] {
  const selectedCase = request.selectedCaseId ? request.cases.find((researchCase) => researchCase.id === request.selectedCaseId) : undefined;
  const activeCase = selectedCase ?? request.cases.find((researchCase) => researchCase.status === "active") ?? request.cases[0];
  const suggestions: AIStagedSuggestion[] = [];
  const topHypothesis = [...request.dnaHypotheses].sort((left, right) => right.confidence - left.confidence)[0];
  const missingSource = anomalies.find((anomaly) => anomaly.type === "missing_source");
  const privacyRisk = anomalies.find((anomaly) => anomaly.type === "privacy_risk");

  if (topHypothesis) {
    suggestions.push({
      id: `sugg-task-${slugify(topHypothesis.matchId)}`,
      type: "task",
      title: `Verify ${topHypothesis.likelyBranch} with primary evidence`,
      summary: topHypothesis.explanation,
      linkedCaseId: activeCase?.id,
      contextRefs: [topHypothesis.matchId, `hyp-${topHypothesis.matchId}`],
      confidence: topHypothesis.confidence
    });
  }

  if (missingSource) {
    suggestions.push({
      id: `sugg-source-${slugify(missingSource.title)}`,
      type: "source_gap",
      title: `Resolve source gap: ${missingSource.title}`,
      summary: missingSource.evidence.join("; "),
      linkedCaseId: activeCase?.id,
      contextRefs: [`anomaly-${slugify(missingSource.title)}`],
      confidence: 0.72
    });
  }

  if (privacyRisk) {
    suggestions.push({
      id: `sugg-privacy-${slugify(privacyRisk.title)}`,
      type: "privacy_review",
      title: `Review publication privacy: ${privacyRisk.title}`,
      summary: privacyRisk.evidence.join("; "),
      linkedCaseId: activeCase?.id,
      contextRefs: [`anomaly-${slugify(privacyRisk.title)}`],
      confidence: 0.9
    });
  }

  if (activeCase && activeCase.evidence.length === 0) {
    suggestions.push({
      id: `sugg-evidence-${slugify(activeCase.id)}`,
      type: "evidence_check",
      title: `Add first evidence item for ${activeCase.title}`,
      summary: `The case question is "${activeCase.question}" but no evidence is linked yet.`,
      linkedCaseId: activeCase.id,
      contextRefs: [activeCase.id],
      confidence: 0.64
    });
  }

  return suggestions.slice(0, 5);
}

function buildLocalAnalysis(request: Omit<AIAnalysisRequest, "provider"> & { anomalies: StructuredAnomaly[] }): string {
  const topHypothesis = [...request.dnaHypotheses].sort((left, right) => right.confidence - left.confidence)[0];
  const activeCase = request.selectedCaseId
    ? request.cases.find((researchCase) => researchCase.id === request.selectedCaseId)
    : request.cases.find((researchCase) => researchCase.status === "active") ?? request.cases[0];
  const highRisk = request.anomalies.filter((anomaly) => anomaly.severity === "high");
  const missingSources = request.anomalies.filter((anomaly) => anomaly.type === "missing_source");
  const linkedSources = activeCase ? request.sources.filter((source) => source.linkedCaseId === activeCase.id) : [];

  const recommendation = topHypothesis
    ? `Start with ${topHypothesis.likelyBranch}. ${topHypothesis.explanation}`
    : "Start by creating or importing DNA matches with known surnames, places, and shared matches so KinSleuth can rank connection hypotheses.";

  const corroboration = activeCase
    ? `Tie that work back to "${activeCase.title}" and test whether the next evidence item supports or weakens the current case question: ${activeCase.question}`
    : "Create a focused research case before doing broad tree work, so each source check has a decision to support or weaken.";

  const sourceWork = missingSources.length
    ? `Before publishing, resolve the highest-value source gaps first: ${missingSources.slice(0, 3).map((item) => item.title).join("; ")}.`
    : linkedSources.length
      ? `Review the ${linkedSources.length} source item${linkedSources.length === 1 ? "" : "s"} already linked to the selected case before adding new conclusions.`
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

function rankCases(cases: ResearchCase[], question: string, selectedCaseId?: string): ResearchCase[] {
  return [...cases].sort((left, right) => scoreCase(right, question, selectedCaseId) - scoreCase(left, question, selectedCaseId));
}

function scoreCase(researchCase: ResearchCase, question: string, selectedCaseId?: string): number {
  return [
    researchCase.id === selectedCaseId ? 100 : 0,
    researchCase.status === "active" ? 20 : 0,
    termScore([researchCase.title, researchCase.question, researchCase.focus], question)
  ].reduce((sum, value) => sum + value, 0);
}

function rankPeople(people: PersonSummary[], question: string, selectedCase?: ResearchCase): PersonSummary[] {
  const caseText = selectedCase
    ? [
        selectedCase.title,
        selectedCase.question,
        selectedCase.focus,
        ...selectedCase.evidence.flatMap((item) => [item.title, item.summary, item.linkedPersonId ?? ""])
      ].join(" ")
    : question;

  return [...people].sort((left, right) => {
    const rightScore = termScore([right.displayName, right.surname ?? "", right.birthPlace ?? "", right.deathPlace ?? "", right.notes ?? ""], caseText);
    const leftScore = termScore([left.displayName, left.surname ?? "", left.birthPlace ?? "", left.deathPlace ?? "", left.notes ?? ""], caseText);
    return rightScore - leftScore;
  });
}

function rankSources(sources: SourceDocument[], question: string, selectedCaseId?: string): SourceDocument[] {
  return [...sources].sort((left, right) => {
    const rightScore = (right.linkedCaseId === selectedCaseId ? 100 : 0) + termScore([right.title, right.repository ?? "", right.transcript ?? "", right.notes ?? ""], question);
    const leftScore = (left.linkedCaseId === selectedCaseId ? 100 : 0) + termScore([left.title, left.repository ?? "", left.transcript ?? "", left.notes ?? ""], question);
    return rightScore - leftScore;
  });
}

function rankDnaMatches(
  matches: DnaMatch[],
  hypotheses: DnaConnectionHypothesis[],
  question: string
): Array<{ match: DnaMatch; hypothesis?: DnaConnectionHypothesis }> {
  const hypothesesByMatch = new Map(hypotheses.map((hypothesis) => [hypothesis.matchId, hypothesis]));
  return matches
    .map((match) => ({ match, hypothesis: hypothesesByMatch.get(match.id) }))
    .sort((left, right) => {
      const rightScore = (right.hypothesis?.confidence ?? 0) * 100 + termScore([right.match.displayName, right.match.surnames.join(" "), right.match.places.join(" "), right.match.notes], question);
      const leftScore = (left.hypothesis?.confidence ?? 0) * 100 + termScore([left.match.displayName, left.match.surnames.join(" "), left.match.places.join(" "), left.match.notes], question);
      return rightScore - leftScore;
    });
}

function termScore(values: string[], question: string): number {
  const terms = question
    .toLowerCase()
    .split(/[^a-z0-9@-]+/)
    .filter((term) => term.length > 2);
  const haystack = values.join(" ").toLowerCase();
  return terms.reduce((score, term) => score + (haystack.includes(term) ? 4 : 0), 0);
}

function providerLabel(baseUrl: string): string {
  try {
    return new URL(baseUrl).hostname;
  } catch {
    return baseUrl || "provider";
  }
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : [];
}

function isSuggestionType(value: unknown): value is AIStagedSuggestion["type"] {
  return value === "task" || value === "evidence_check" || value === "source_gap" || value === "privacy_review";
}

function normalizeConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.5;
  }
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

function extractYear(dateText?: string): number | undefined {
  const match = dateText?.match(/(\d{4})/);
  return match ? Number(match[1]) : undefined;
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function stripJsonFence(value: string): string {
  return value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item";
}
