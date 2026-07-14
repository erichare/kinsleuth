"use client";

import { useState, useSyncExternalStore } from "react";
import { Icons } from "@/components/icons";
import { Confidence, Metric, Status } from "@/components/ui";
import type { AIAnalysisResult, StructuredAnomaly } from "@/lib/ai";
import type { AIAnalysisRun, AIStagedSuggestion, DnaConnectionHypothesis, ResearchCase } from "@/lib/models";

type Props = {
  initialQuestion: string;
  cases: ResearchCase[];
  initialRuns: AIAnalysisRun[];
  anomalies: StructuredAnomaly[];
  counts: {
    people: number;
    cases: number;
    dnaHypotheses: number;
  };
  dnaHypotheses: DnaConnectionHypothesis[];
};

type AIAnalysisResponse = AIAnalysisResult & {
  run?: AIAnalysisRun;
};

const suggestedQuestions = [
  "Which DNA lead should I investigate next?",
  "What privacy or publication risks should block sharing?",
  "Which vital events need better source coverage?"
];

export function AIAnalystWorkspace({ initialQuestion, cases, initialRuns, anomalies, counts, dnaHypotheses }: Props) {
  const [question, setQuestion] = useState(initialQuestion);
  const [result, setResult] = useState<AIAnalysisResult | null>(null);
  const [runs, setRuns] = useState(initialRuns);
  const [selectedCaseId, setSelectedCaseId] = useState(cases[0]?.id ?? "");
  const [taskTitle, setTaskTitle] = useState("Verify the AI Analyst recommendation against primary evidence.");
  const [taskMessage, setTaskMessage] = useState("");
  const [taskMessageRole, setTaskMessageRole] = useState<"alert" | "status">("status");
  const [error, setError] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [isCreatingTask, setIsCreatingTask] = useState(false);
  const [busySuggestionId, setBusySuggestionId] = useState("");
  const [confirmedSuggestionIds, setConfirmedSuggestionIds] = useState<string[]>([]);
  const [pendingSuggestion, setPendingSuggestion] = useState("");
  const visibleAnomalies = anomalies.slice(0, 75);
  const hiddenAnomalyCount = anomalies.length - visibleAnomalies.length;

  function applySuggestedQuestion(suggestion: string) {
    const currentQuestion = question.trim();
    const hasCustomQuestion = currentQuestion !== "" && currentQuestion !== initialQuestion.trim() && currentQuestion !== suggestion;

    if (hasCustomQuestion && pendingSuggestion !== suggestion) {
      setPendingSuggestion(suggestion);
      return;
    }

    setQuestion(suggestion);
    setPendingSuggestion("");
  }

  async function runAnalysis(event?: React.FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const trimmedQuestion = question.trim();

    if (!trimmedQuestion) {
      setError("Add a research question first.");
      return;
    }

    setIsRunning(true);
    setError("");

    try {
      const response = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: trimmedQuestion, caseId: selectedCaseId || undefined })
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error ?? "AI analysis failed");
      }

      const nextResult = body as AIAnalysisResponse;
      setResult(nextResult);
      if (nextResult.run) {
        setRuns((current) => [nextResult.run as AIAnalysisRun, ...current.filter((run) => run.id !== nextResult.run?.id)].slice(0, 25));
        setTaskTitle(createTaskTitle(nextResult));
      }
      setTaskMessage("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "AI analysis failed");
    } finally {
      setIsRunning(false);
    }
  }

  async function createSuggestedTask(suggestion: AIStagedSuggestion) {
    const targetCaseId = suggestion.linkedCaseId || selectedCaseId;
    if (!targetCaseId) {
      setTaskMessage("Choose a case before adding this suggestion as a task.");
      setTaskMessageRole("alert");
      return;
    }

    setBusySuggestionId(suggestion.id);
    setTaskMessage("");

    try {
      const response = await fetch(`/api/cases/${encodeURIComponent(targetCaseId)}/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: suggestion.title })
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error ?? "Task creation failed");
      }

      setConfirmedSuggestionIds((current) => [...new Set([...current, suggestion.id])]);
      setTaskMessage("Suggested task added to case.");
      setTaskMessageRole("status");
    } catch (requestError) {
      setTaskMessage(requestError instanceof Error ? requestError.message : "Task creation failed");
      setTaskMessageRole("alert");
    } finally {
      setBusySuggestionId("");
    }
  }

  async function createCaseTask() {
    if (!selectedCaseId || !result) {
      setTaskMessage("Choose a case and run analysis first.");
      setTaskMessageRole("alert");
      return;
    }

    setIsCreatingTask(true);
    setTaskMessage("");

    try {
      const response = await fetch(`/api/cases/${encodeURIComponent(selectedCaseId)}/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: taskTitle })
      });
      const body = await response.json();

      if (!response.ok) {
        throw new Error(body.error ?? "Task creation failed");
      }

      setTaskMessage("Task added to case.");
      setTaskMessageRole("status");
    } catch (requestError) {
      setTaskMessage(requestError instanceof Error ? requestError.message : "Task creation failed");
      setTaskMessageRole("alert");
    } finally {
      setIsCreatingTask(false);
    }
  }

  return (
    <div className="ai-workspace">
      <div className="metric-row ai-metric-row">
        <Metric label="People indexed" value={counts.people.toLocaleString()} detail="available to local checks" />
        <Metric label="Cases" value={counts.cases.toLocaleString()} detail="research questions" />
        <Metric label="DNA hypotheses" value={counts.dnaHypotheses.toLocaleString()} detail="ranked leads" />
        <Metric label="Structured flags" value={anomalies.length.toLocaleString()} detail="privacy and source checks" />
      </div>

      <div className="app-grid ai-grid">
        <section className="app-card analyst-panel">
          <div className="app-card-header">
            <div>
              <h2>Ask the analyst</h2>
              <p className="muted">Runs deterministic checks, sends full private workspace context when configured, and stages follow-up work for review.</p>
            </div>
            <Status tone={result?.status === "ready" ? "ok" : result?.status === "provider_error" ? "warning" : "private"}>
              {result?.status === "ready" ? "Provider answered" : result?.status === "provider_error" ? "Provider fallback" : "Local mode"}
            </Status>
          </div>

          <form aria-busy={isRunning} onSubmit={runAnalysis}>
            <label className="field">
              <span>Case context</span>
              <select value={selectedCaseId} onChange={(event) => setSelectedCaseId(event.target.value)}>
                <option value="">No case selected</option>
                {cases.map((researchCase) => (
                  <option key={researchCase.id} value={researchCase.id}>
                    {researchCase.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Research question</span>
              <textarea
                aria-describedby={error ? "ai-analysis-error" : undefined}
                aria-invalid={Boolean(error) && !question.trim()}
                value={question}
                onChange={(event) => {
                  setQuestion(event.target.value);
                  setPendingSuggestion("");
                }}
              />
            </label>
            <div className="prompt-row" aria-label="Suggested research questions">
              {suggestedQuestions.map((suggestion) => (
                <button
                  aria-label={pendingSuggestion === suggestion ? `Replace current question with: ${suggestion}` : undefined}
                  className="prompt-chip"
                  key={suggestion}
                  onClick={() => applySuggestedQuestion(suggestion)}
                  type="button"
                >
                  {pendingSuggestion === suggestion ? "Replace current question?" : suggestion}
                </button>
              ))}
            </div>
            <div className="hero-actions">
              <button aria-busy={isRunning} className="button" disabled={isRunning} type="submit">
                <Icons.Brain size={16} aria-hidden />
                {isRunning ? "Analyzing..." : "Run analysis"}
              </button>
              <Status tone="private">Owner/Admin only</Status>
            </div>
            {error ? <p aria-atomic="true" className="form-error" id="ai-analysis-error" role="alert">{error}</p> : null}
          </form>

          <AnalysisResult result={result} />
          <TaskAction
            cases={cases}
            isCreating={isCreatingTask}
            message={taskMessage}
            messageRole={taskMessageRole}
            result={result}
            selectedCaseId={selectedCaseId}
            taskTitle={taskTitle}
            busySuggestionId={busySuggestionId}
            confirmedSuggestionIds={confirmedSuggestionIds}
            onCreateTask={createCaseTask}
            onCreateSuggestionTask={createSuggestedTask}
            onTaskTitleChange={setTaskTitle}
          />
        </section>

        <aside className="app-card">
          <div className="app-card-header">
            <div>
              <h2>Structured checks</h2>
              <p className="muted">Deterministic findings that feed the recommendation.</p>
            </div>
            <Icons.FileSearch size={18} aria-hidden />
          </div>
          <div className="evidence-list">
            {anomalies.length > 0 ? (
              <>
                {visibleAnomalies.map((anomaly, index) => (
                  <AnomalyItem anomaly={anomaly} key={`${anomaly.type}-${anomaly.title}-${index}`} />
                ))}
                {hiddenAnomalyCount > 0 ? (
                  <div className="evidence-item">
                    <strong>{hiddenAnomalyCount.toLocaleString()} more checks are included in analysis context</strong>
                    <p className="muted">The sidebar is capped so large GEDCOM imports stay readable. Use Quality Reports for the paginated review queue.</p>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="evidence-item">
                <strong>No high-risk anomalies in demo data</strong>
                <p className="muted">
                  {counts.people.toLocaleString()} people, {counts.cases.toLocaleString()} cases, and {counts.dnaHypotheses.toLocaleString()} DNA hypotheses checked.
                </p>
              </div>
            )}
          </div>
        </aside>
      </div>

      <section className="app-card">
        <div className="app-card-header">
          <div>
            <h2>Recent analyst runs</h2>
            <p className="muted">Saved from the current workspace so prior recommendations do not disappear after refresh.</p>
          </div>
          <Status tone="private">{runs.length.toLocaleString()} saved</Status>
        </div>
        <div className="analysis-run-list">
          {runs.length > 0 ? (
            runs.slice(0, 6).map((run) => (
              <div className="evidence-item analysis-run-item" key={run.id}>
                <div className="evidence-item-heading">
                  <strong>{run.question}</strong>
                  <Status tone={run.status === "ready" ? "ok" : "warning"}>{formatAnalysisStatus(run.status)}</Status>
                </div>
                <p>{summarizeAnswer(run.answer)}</p>
                <p className="muted">
                  <ClientDate value={run.createdAt} /> · {run.provider ?? "local"} · {run.evidenceUsed.length.toLocaleString()} evidence notes · {run.suggestions.length.toLocaleString()} staged
                </p>
              </div>
            ))
          ) : (
            <p className="muted empty-state">No saved analyst runs yet.</p>
          )}
        </div>
      </section>

      <section className="app-card">
        <div className="app-card-header">
          <div>
            <h2>Connection hypotheses</h2>
            <p className="muted">Current DNA leads ranked before an external provider is involved.</p>
          </div>
          <Icons.Dna size={18} aria-hidden />
        </div>
        <div className="hypothesis-grid">
          {dnaHypotheses.map((hypothesis) => (
            <div className="hypothesis-panel" key={hypothesis.matchId}>
              <strong>{hypothesis.likelyBranch}</strong>
              <p>{hypothesis.explanation}</p>
              <div className="evidence-inline">
                <Confidence value={hypothesis.confidence} />
                <span className="muted">{hypothesis.likelyGeneration}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function TaskAction({
  cases,
  isCreating,
  message,
  messageRole,
  result,
  selectedCaseId,
  taskTitle,
  busySuggestionId,
  confirmedSuggestionIds,
  onCreateTask,
  onCreateSuggestionTask,
  onTaskTitleChange
}: {
  cases: ResearchCase[];
  isCreating: boolean;
  message: string;
  messageRole: "alert" | "status";
  result: AIAnalysisResult | null;
  selectedCaseId: string;
  taskTitle: string;
  busySuggestionId: string;
  confirmedSuggestionIds: string[];
  onCreateTask: () => void;
  onCreateSuggestionTask: (suggestion: AIStagedSuggestion) => void;
  onTaskTitleChange: (title: string) => void;
}) {
  if (!result) {
    return null;
  }

  const selectedCase = cases.find((researchCase) => researchCase.id === selectedCaseId);

  return (
    <div className="analysis-task-panel">
      <div>
        <strong>Create case task</strong>
        <p className="muted">{selectedCase ? `Add a todo to ${selectedCase.title}.` : "Choose a case before creating a task."}</p>
      </div>
      {result.suggestions.length ? (
        <div className="analysis-suggestion-list">
          {result.suggestions.map((suggestion, index) => {
            const targetCase = cases.find((researchCase) => researchCase.id === (suggestion.linkedCaseId || selectedCaseId));
            const confirmed = confirmedSuggestionIds.includes(suggestion.id);
            return (
              <div className="analysis-suggestion-card" key={`${suggestion.id}-${index}`}>
                <div>
                  <div className="evidence-item-heading">
                    <strong>{suggestion.title}</strong>
                    <Status tone={suggestion.type === "privacy_review" ? "warning" : "private"}>{formatSuggestionType(suggestion.type)}</Status>
                  </div>
                  <p className="muted">{suggestion.summary}</p>
                  <p className="muted">
                    {targetCase ? targetCase.title : "No case selected"} · {Math.round(suggestion.confidence * 100)}% confidence
                  </p>
                </div>
                <button
                  aria-busy={busySuggestionId === suggestion.id}
                  className="button-secondary"
                  disabled={confirmed || Boolean(busySuggestionId) || !targetCase}
                  onClick={() => onCreateSuggestionTask(suggestion)}
                  type="button"
                >
                  {confirmed ? "Added" : busySuggestionId === suggestion.id ? "Adding..." : "Add task"}
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
      <label className="field">
        <span>Task title</span>
        <input value={taskTitle} onChange={(event) => onTaskTitleChange(event.target.value)} />
      </label>
      <div className="hero-actions">
        <button aria-busy={isCreating} className="button-secondary" disabled={isCreating || !selectedCaseId || !taskTitle.trim()} onClick={onCreateTask} type="button">
          {isCreating ? "Adding..." : "Add task"}
        </button>
        {selectedCaseId ? (
          <a className="button-ghost" href={`/app/cases/${encodeURIComponent(selectedCaseId)}`}>
            View case
          </a>
        ) : null}
      </div>
      {message ? <p aria-atomic="true" className={messageRole === "alert" ? "form-error" : "muted"} role={messageRole}>{message}</p> : null}
    </div>
  );
}

function AnalysisResult({ result }: { result: AIAnalysisResult | null }) {
  if (!result) {
    return (
      <div className="analysis-empty">
        <Icons.Brain size={24} aria-hidden />
        <div>
          <strong>Ready for a local pass</strong>
          <p className="muted">Run analysis to get a recommended lead, evidence hygiene notes, publication safety checks, and uncertainty.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="analysis-result">
      <div aria-atomic="true" aria-live="polite" className="analysis-result-header">
        <h2>Recommendation</h2>
        <Status tone={result.status === "ready" ? "ok" : "warning"}>{formatAnalysisStatus(result.status)}</Status>
      </div>
      <p className="muted">
        {result.provider} · {result.model} · {result.providerStatus === "completed" ? "provider response saved" : result.providerStatus === "failed" ? "local fallback saved" : "local analysis saved"}
      </p>
      <div className="analysis-answer">
        {result.answer.split("\n\n").map((paragraph, index) => (
          <p key={`answer-${index}`}>{paragraph}</p>
        ))}
      </div>
      <div className="analysis-columns">
        <ResultList title="Evidence used" items={result.evidenceUsed} />
        <ResultList title="Uncertainty" items={result.uncertainty} />
      </div>
      {result.contextReferences.length ? (
        <div className="analysis-list analysis-context-list">
          <strong>Cited context</strong>
          <ul>
            {result.contextReferences.slice(0, 8).map((reference, index) => (
              <li key={`${reference.type}-${reference.id}-${index}`}>
                {reference.label} <span className="muted">({reference.type})</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function ResultList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="analysis-list">
      <strong>{title}</strong>
      <ul>
        {items.map((item, index) => (
          <li key={`${title}-${index}`}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function AnomalyItem({ anomaly }: { anomaly: StructuredAnomaly }) {
  return (
    <div className="evidence-item">
      <div className="evidence-item-heading">
        <strong>{anomaly.title}</strong>
        <Status tone={anomaly.severity === "high" ? "warning" : "private"}>{anomaly.severity}</Status>
      </div>
      <p className="muted">{anomaly.evidence.join(" · ")}</p>
    </div>
  );
}

const subscribeToNothing = () => () => {};

function ClientDate({ value }: { value: string }) {
  const mounted = useSyncExternalStore(subscribeToNothing, () => true, () => false);

  if (!mounted) {
    return <>{value.slice(0, 10)}</>;
  }

  return <>{new Date(value).toLocaleString()}</>;
}

function createTaskTitle(result: AIAnalysisResult): string {
  const firstTaskSuggestion = result.suggestions.find((suggestion) => suggestion.type === "task") ?? result.suggestions[0];
  if (firstTaskSuggestion) {
    return firstTaskSuggestion.title.length > 120 ? `${firstTaskSuggestion.title.slice(0, 117)}...` : firstTaskSuggestion.title;
  }

  const recommendation = result.answer
    .split("\n\n")
    .find((paragraph) => paragraph.startsWith("Recommendation:"))
    ?.replace("Recommendation:", "")
    .trim();

  if (!recommendation) {
    return "Review AI Analyst recommendation against primary evidence.";
  }

  return recommendation.length > 120 ? `${recommendation.slice(0, 117)}...` : recommendation;
}

function summarizeAnswer(answer: string): string {
  const recommendation = answer
    .split("\n\n")
    .find((paragraph) => paragraph.startsWith("Recommendation:"));

  return recommendation ?? answer.split("\n\n")[0] ?? "No recommendation text saved.";
}

function formatAnalysisStatus(status: AIAnalysisRun["status"] | AIAnalysisResult["status"]): string {
  if (status === "ready") return "ready";
  if (status === "provider_error") return "fallback";
  return "needs key";
}

function formatSuggestionType(type: AIStagedSuggestion["type"]): string {
  return type.replace(/_/g, " ");
}
