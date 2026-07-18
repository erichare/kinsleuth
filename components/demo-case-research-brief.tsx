import type {
  ResearchCase,
  ResearchHypothesis,
  ResearchSearchScope,
  ResearchTask,
  ResearchTaskOutcome
} from "@/lib/models";
import { Confidence, Status } from "@/components/ui";

export function DemoCaseResearchBrief({ researchCase }: { researchCase: ResearchCase }) {
  const completedAssignments = researchCase.tasks.filter((task) => task.status === "done").length;

  return (
    <section
      aria-labelledby="demo-case-research-brief-heading"
      className="case-research-workspace demo-case-research-brief"
    >
      <div className="research-guide-card demo-case-research-brief__summary">
        <div className="research-guide-header">
          <div>
            <span className="card-kicker">Read-only research brief</span>
            <h2 id="demo-case-research-brief-heading">Follow the clues, disagreements, and next searches</h2>
          </div>
          <Status tone={caseStatusTone(researchCase.status)}>{researchCase.status}</Status>
        </div>

        <p className="research-guide-reason">
          This fictional case preserves competing explanations and the searches already tried, including negative and inconclusive results. Nothing in this brief changes the shared demo archive.
        </p>

        <div aria-label="Case research progress" className="research-progress demo-case-research-brief__progress">
          <div><strong>{researchCase.hypotheses.length}</strong><span>working hypotheses</span></div>
          <div><strong>{researchCase.evidence.length}</strong><span>evidence notes</span></div>
          <div><strong>{completedAssignments}</strong><span>assignments done</span></div>
        </div>

        <p className="research-readonly-note demo-case-research-brief__readonly-note">
          Explore the reasoning below. Demo visitors can review the saved research trail without adding tasks, changing a hypothesis, or overwriting a result.
        </p>
      </div>

      <div className="research-detail-grid demo-case-research-brief__grid">
        <section
          aria-labelledby="demo-case-hypotheses-heading"
          className="app-card research-hypotheses demo-case-research-brief__hypotheses"
        >
          <div className="app-card-header">
            <div>
              <span className="card-kicker">Possibilities, not facts</span>
              <h2 id="demo-case-hypotheses-heading">Working hypotheses</h2>
              <p className="muted">Compare confidence and status, then inspect the reasons a possibility changed.</p>
            </div>
            <Status tone="private">{researchCase.hypotheses.length}</Status>
          </div>

          <div className="research-hypothesis-list demo-case-research-brief__hypothesis-list">
            {researchCase.hypotheses.map((hypothesis) => (
              <DemoHypothesis key={hypothesis.id} hypothesis={hypothesis} />
            ))}
          </div>
          {researchCase.hypotheses.length === 0 ? (
            <p className="muted empty-state">No hypotheses have been recorded for this fictional case yet.</p>
          ) : null}
        </section>

        <section
          aria-labelledby="demo-case-tasks-heading"
          className="app-card research-trail demo-case-research-brief__tasks"
        >
          <div className="app-card-header">
            <div>
              <span className="card-kicker">Assignments and latest results</span>
              <h2 id="demo-case-tasks-heading">Research trail</h2>
              <p className="muted">Each scope shows exactly where, when, and how the fictional archive was searched.</p>
            </div>
            <Status tone="private">{researchCase.tasks.length}</Status>
          </div>

          <div className="research-task-list demo-case-research-brief__task-list">
            {researchCase.tasks.map((task) => (
              <DemoResearchTask
                hypotheses={researchCase.hypotheses}
                key={task.id}
                task={task}
              />
            ))}
          </div>
          {researchCase.tasks.length === 0 ? (
            <p className="muted empty-state">No assignments have been recorded for this fictional case yet.</p>
          ) : null}
        </section>
      </div>
    </section>
  );
}

function DemoHypothesis({ hypothesis }: { hypothesis: ResearchHypothesis }) {
  const latestDecision = hypothesis.decisions?.at(-1);

  return (
    <article className={`research-hypothesis-card demo-case-research-brief__hypothesis${hypothesis.status === "rejected" ? " is-ruled-out" : ""}`}>
      <div className="research-hypothesis-heading">
        <strong>{hypothesis.statement}</strong>
        <Status tone={hypothesisStatusTone(hypothesis.status)}>{hypothesisStatusLabel(hypothesis.status)}</Status>
      </div>
      <Confidence value={hypothesis.confidence} />

      {latestDecision ? (
        <div className="research-history-entry demo-case-research-brief__decision">
          <div className="research-history-meta">
            <span>Latest decision · {hypothesisStatusLabel(latestDecision.fromStatus)} to {hypothesisStatusLabel(latestDecision.toStatus)}</span>
            <time dateTime={latestDecision.createdAt}>{formatResearchDate(latestDecision.createdAt)}</time>
          </div>
          <p>{latestDecision.reason}</p>
          <small>{latestDecision.actorName}</small>
        </div>
      ) : hypothesis.status !== "open" ? (
        <p className="research-legacy-note">This path was marked {hypothesisStatusLabel(hypothesis.status)} before a decision reason was recorded.</p>
      ) : null}
    </article>
  );
}

function DemoResearchTask({
  task,
  hypotheses
}: {
  task: ResearchTask;
  hypotheses: ResearchHypothesis[];
}) {
  const latestOutcome = task.outcomes?.at(-1);
  const targetHypothesis = task.targetHypothesisId
    ? hypotheses.find((hypothesis) => hypothesis.id === task.targetHypothesisId)
    : undefined;

  return (
    <article className="research-task-row demo-case-research-brief__task">
      <div className="research-task-heading">
        <strong>{task.title}</strong>
        <Status tone={taskStatusTone(task.status)}>{task.status}</Status>
      </div>

      {task.guidance ? (
        <div className="demo-case-research-brief__guidance">
          <span className="research-assignment-label">Research guidance</span>
          <p className="muted">{task.guidance}</p>
        </div>
      ) : null}

      {targetHypothesis ? (
        <p className="research-context-pill demo-case-research-brief__target">
          Tests: {targetHypothesis.statement}
        </p>
      ) : null}

      {latestOutcome ? (
        <LatestOutcome outcome={latestOutcome} taskTitle={task.title} />
      ) : task.status === "done" ? (
        <p className="research-legacy-note">Completed before result notes were recorded.</p>
      ) : (
        <p className="research-action-note">No result recorded yet. This remains an open line of inquiry.</p>
      )}
    </article>
  );
}

function LatestOutcome({ outcome, taskTitle }: { outcome: ResearchTaskOutcome; taskTitle: string }) {
  const scopeDetails = researchScopeDetails(outcome.searchScope);

  return (
    <ol aria-label={`Latest result for ${taskTitle}`} className="research-history-list research-result-history demo-case-research-brief__latest-outcome">
      <li className="research-history-entry">
        <div className="research-history-meta">
          <span>Latest result · {outcomeLabel(outcome.type)}</span>
          <time dateTime={outcome.createdAt}>{formatResearchDate(outcome.createdAt)}</time>
        </div>
        <p>{outcome.note}</p>
        {scopeDetails.length > 0 ? (
          <dl className="research-history-scope demo-case-research-brief__scope">
            {scopeDetails.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        <small>{outcome.actorName}</small>
      </li>
    </ol>
  );
}

function caseStatusTone(status: ResearchCase["status"]): "ok" | "warning" | "private" {
  if (status === "resolved") return "ok";
  if (status === "planning" || status === "paused") return "warning";
  return "private";
}

function hypothesisStatusTone(status: ResearchHypothesis["status"]): "ok" | "warning" | "private" | "danger" {
  if (status === "supported") return "ok";
  if (status === "weakened") return "warning";
  if (status === "rejected") return "danger";
  return "private";
}

function hypothesisStatusLabel(status: ResearchHypothesis["status"]): string {
  return status === "rejected" ? "ruled out" : status;
}

function taskStatusTone(status: ResearchTask["status"]): "ok" | "warning" | "private" {
  if (status === "done") return "ok";
  if (status === "doing") return "warning";
  return "private";
}

function outcomeLabel(outcome: ResearchTaskOutcome["type"]): string {
  return outcome.replaceAll("_", " ");
}

function researchScopeDetails(scope?: ResearchSearchScope): Array<[string, string]> {
  if (!scope) return [];
  return [
    ["Repository", scope.repository],
    ["Collection", scope.collection],
    ["Place", scope.place],
    ["Date range", scope.dateRange],
    ["Query", scope.query]
  ].filter((item): item is [string, string] => Boolean(item[1]));
}

function formatResearchDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recorded previously";
  return `${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date)} UTC`;
}
