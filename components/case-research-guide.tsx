"use client";

import { useMemo, useRef, useState } from "react";
import type { ResearchCase, ResearchHypothesis, ResearchSearchScope, ResearchTask, ResearchTaskOutcome } from "@/lib/models";
import { buildResearchGuide } from "@/lib/research-guide";
import { HypothesisWorkspace, type HypothesisDecisionSubmission } from "./hypothesis-workspace";
import { ResearchOutcomeForm, type ResearchOutcomeSubmission } from "./research-outcome-form";
import { ResearchStepCard } from "./research-step-card";
import { Status } from "./ui";

export function CaseResearchGuide({ initialCase, canWrite }: { initialCase: ResearchCase; canWrite: boolean }) {
  const [researchCase, setResearchCase] = useState(initialCase);
  const [busyId, setBusyId] = useState("");
  const [pendingOutcome, setPendingOutcome] = useState<{
    task: ResearchTask;
    initialOutcome?: ResearchTaskOutcome["type"];
    correctingOutcome?: ResearchTaskOutcome;
  }>();
  const [taskTitle, setTaskTitle] = useState("");
  const [message, setMessage] = useState("");
  const [messageRole, setMessageRole] = useState<"status" | "alert">("status");
  const [hasConflict, setHasConflict] = useState(false);
  const messageRef = useRef<HTMLParagraphElement>(null);
  const outcomeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const plan = useMemo(() => buildResearchGuide(researchCase), [researchCase]);
  const assignmentTask = plan.assignment?.taskId
    ? researchCase.tasks.find((task) => task.id === plan.assignment?.taskId)
    : undefined;
  const inProgressTask = researchCase.tasks.find((task) => task.status === "doing");

  async function acceptAssignment(alreadyTried: boolean, trigger?: HTMLButtonElement) {
    if (!plan.assignment?.guideKey) return;
    if (alreadyTried && trigger) outcomeTriggerRef.current = trigger;
    setBusyId("guide-assignment");
    setMessage("");
    setHasConflict(false);
    try {
      const body = await requestJson(`/api/cases/${encodeURIComponent(researchCase.id)}/guide/assignments`, {
        method: "POST",
        body: { guideKey: plan.assignment.guideKey }
      });
      const nextCase = body.case as ResearchCase;
      const task = body.task as ResearchTask;
      setResearchCase(nextCase);
      if (alreadyTried) {
        setPendingOutcome({ task, initialOutcome: "already_tried" });
      } else {
        setMessage("Assignment added to this case.");
        setMessageRole("status");
      }
    } catch (error) {
      showError(error);
    } finally {
      setBusyId("");
    }
  }

  async function startAssignment(task: ResearchTask) {
    setBusyId(task.id);
    setMessage("");
    setHasConflict(false);
    try {
      const body = await requestJson(
        `/api/cases/${encodeURIComponent(researchCase.id)}/tasks/${encodeURIComponent(task.id)}`,
        { method: "PATCH", body: { status: "doing", expectedUpdatedAt: task.updatedAt } }
      );
      setResearchCase(body.case as ResearchCase);
      setMessage("Assignment started. Come back here to record what happened.");
      setMessageRole("status");
    } catch (error) {
      showError(error);
    } finally {
      setBusyId("");
    }
  }

  async function saveOutcome(input: ResearchOutcomeSubmission) {
    if (!pendingOutcome) return;
    setBusyId(pendingOutcome.task.id);
    setMessage("");
    setHasConflict(false);
    try {
      const body = await requestJson(
        `/api/cases/${encodeURIComponent(researchCase.id)}/tasks/${encodeURIComponent(pendingOutcome.task.id)}/outcome`,
        { method: "POST", body: input }
      );
      setResearchCase(body.case as ResearchCase);
      setPendingOutcome(undefined);
      setMessage("Saved to this case. The guide will use this result when choosing the next step.");
      setMessageRole("status");
      restoreOutcomeFocus();
    } catch (error) {
      showError(error);
    } finally {
      setBusyId("");
    }
  }

  async function addManualTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!taskTitle.trim()) {
      setMessage("Add an assignment title first.");
      setMessageRole("alert");
      return;
    }
    setBusyId("new-task");
    setMessage("");
    setHasConflict(false);
    try {
      const body = await requestJson(`/api/cases/${encodeURIComponent(researchCase.id)}/tasks`, {
        method: "POST",
        body: { title: taskTitle.trim() }
      });
      setResearchCase(body.case as ResearchCase);
      setTaskTitle("");
      setMessage("Assignment added.");
      setMessageRole("status");
    } catch (error) {
      showError(error);
    } finally {
      setBusyId("");
    }
  }

  async function addHypothesis(statement: string) {
    setBusyId("new-hypothesis");
    setMessage("");
    setHasConflict(false);
    try {
      const body = await requestJson(`/api/cases/${encodeURIComponent(researchCase.id)}/hypotheses`, {
        method: "POST",
        body: { statement }
      });
      setResearchCase(body.case as ResearchCase);
      setMessage("Hypothesis added. The guide can now plan work that tests it.");
      setMessageRole("status");
    } catch (error) {
      showError(error);
      throw error;
    } finally {
      setBusyId("");
    }
  }

  async function decideHypothesis(hypothesis: ResearchHypothesis, input: HypothesisDecisionSubmission) {
    setBusyId(hypothesis.id);
    setMessage("");
    setHasConflict(false);
    try {
      const body = await requestJson(
        `/api/cases/${encodeURIComponent(researchCase.id)}/hypotheses/${encodeURIComponent(hypothesis.id)}`,
        { method: "PATCH", body: input }
      );
      setResearchCase(body.case as ResearchCase);
      setMessage("Decision saved with its reason.");
      setMessageRole("status");
    } catch (error) {
      showError(error);
      throw error;
    } finally {
      setBusyId("");
    }
  }

  function openOutcome(
    task: ResearchTask,
    options: { initialOutcome?: ResearchTaskOutcome["type"]; correctingOutcome?: ResearchTaskOutcome },
    trigger: HTMLButtonElement
  ) {
    outcomeTriggerRef.current = trigger;
    setMessage("");
    setHasConflict(false);
    setPendingOutcome({ task, ...options });
  }

  function closeOutcome() {
    setPendingOutcome(undefined);
    setHasConflict(false);
    restoreOutcomeFocus();
  }

  function restoreOutcomeFocus() {
    requestAnimationFrame(() => {
      const trigger = outcomeTriggerRef.current;
      if (trigger?.isConnected && !trigger.disabled) {
        trigger.focus();
        return;
      }
      if (messageRef.current) {
        messageRef.current.focus();
        return;
      }
      document.getElementById("research-guide-heading")?.focus();
    });
  }

  function showError(error: unknown) {
    const conflict = error instanceof ClientRequestError && error.status === 409;
    setHasConflict(conflict);
    setMessage(
      conflict
        ? "This case changed elsewhere. Nothing you entered on this page has been cleared."
        : error instanceof Error
          ? error.message
          : "The case could not be updated."
    );
    setMessageRole("alert");
    requestAnimationFrame(() => messageRef.current?.focus());
  }

  return (
    <div className="case-research-workspace">
      <ResearchStepCard
        busy={busyId === "guide-assignment" || busyId === assignmentTask?.id}
        canWrite={canWrite}
        onAccept={acceptAssignment}
        onAlreadyTried={(task, trigger) => openOutcome(task, { initialOutcome: "already_tried" }, trigger)}
        onRecord={(task, trigger) => openOutcome(task, {}, trigger)}
        onStart={startAssignment}
        outcomeOpen={Boolean(pendingOutcome)}
        plan={plan}
        task={assignmentTask}
      />

      {pendingOutcome ? (
        <section className="app-card research-outcome-card">
          <ResearchOutcomeForm
            correctingOutcome={pendingOutcome.correctingOutcome}
            hypotheses={researchCase.hypotheses}
            initialOutcome={pendingOutcome.initialOutcome}
            isSaving={busyId === pendingOutcome.task.id}
            key={`${pendingOutcome.task.id}:${pendingOutcome.correctingOutcome?.id ?? pendingOutcome.initialOutcome ?? "new"}`}
            onCancel={closeOutcome}
            onSubmit={saveOutcome}
            task={pendingOutcome.task}
          />
        </section>
      ) : null}

      {message ? (
        <p aria-atomic="true" className={messageRole === "alert" ? "form-error research-global-message" : "research-success-message"} ref={messageRef} role={messageRole} tabIndex={-1}>
          {message}
          {hasConflict ? (
            <span className="research-recovery-action">
              Keep this tab open to preserve the draft. <a href={`/app/cases/${encodeURIComponent(researchCase.id)}`} rel="noreferrer" target="_blank">Open the latest case in a new tab</a>, compare the changes, then copy the draft there after reconciling it.
            </span>
          ) : null}
        </p>
      ) : null}

      <div className="research-detail-grid">
        <HypothesisWorkspace
          busyId={busyId}
          canWrite={canWrite}
          hypotheses={researchCase.hypotheses}
          isLocked={Boolean(pendingOutcome)}
          onAdd={addHypothesis}
          onDecide={decideHypothesis}
        />

        <section className="app-card research-trail" aria-labelledby="research-trail-heading">
          <div className="app-card-header">
            <div>
              <span className="card-kicker">Assignments and results</span>
              <h2 id="research-trail-heading">Research trail</h2>
            </div>
            <Status tone="private">{researchCase.tasks.length}</Status>
          </div>

          {canWrite ? (
            <form className="research-task-add" onSubmit={addManualTask}>
              <label className="field">
                <span>Add your own assignment</span>
                <input disabled={Boolean(pendingOutcome)} maxLength={240} onChange={(event) => setTaskTitle(event.target.value)} placeholder="Compare the fictional 1912 payroll with the 1913 boarding ledger..." value={taskTitle} />
              </label>
              <button className="button-secondary" disabled={Boolean(pendingOutcome) || busyId === "new-task"} type="submit">{busyId === "new-task" ? "Adding..." : "Add"}</button>
            </form>
          ) : null}

          <div className="research-task-list">
            {researchCase.tasks.map((task) => {
              const outcomes = task.outcomes ?? [];
              const anotherAssignmentIsDoing = Boolean(inProgressTask && inProgressTask.id !== task.id);
              const actionsLocked = Boolean(pendingOutcome) || Boolean(busyId);
              return (
                <article className="research-task-row" key={task.id}>
                  <div className="research-task-heading">
                    <strong>{task.title}</strong>
                    <Status tone={task.status === "done" ? "ok" : task.status === "doing" ? "warning" : "private"}>{task.status}</Status>
                  </div>
                  {task.guidance ? <p className="muted">{task.guidance}</p> : null}
                  {outcomes.length > 0 ? (
                    <ol aria-label={`Result history for ${task.title}`} className="research-history-list research-result-history">
                      {outcomes.map((outcome, index) => {
                        const correctedResult = outcome.correctsOutcomeId
                          ? outcomes.findIndex((item) => item.id === outcome.correctsOutcomeId) + 1
                          : 0;
                        const scopeDetails = researchScopeDetails(outcome.searchScope);
                        return (
                          <li className="research-history-entry" key={outcome.id}>
                            <div className="research-history-meta">
                              <span>Result {index + 1} · {outcomeLabel(outcome.type)}</span>
                              <time dateTime={outcome.createdAt}>{formatResearchDate(outcome.createdAt)}</time>
                            </div>
                            {correctedResult > 0 ? <small className="research-correction-note">Correction to result {correctedResult}</small> : null}
                            <p>{outcome.note}</p>
                            {scopeDetails.length > 0 ? (
                              <dl className="research-history-scope">
                                {scopeDetails.map(([label, value]) => (
                                  <div key={label}>
                                    <dt>{label}</dt>
                                    <dd>{value}</dd>
                                  </div>
                                ))}
                              </dl>
                            ) : null}
                            <small>{outcome.actorName}</small>
                            {canWrite && task.status === "done" ? (
                              <button
                                className="button-ghost research-correction-button"
                                disabled={actionsLocked}
                                onClick={(event) => openOutcome(
                                  task,
                                  { initialOutcome: outcome.type, correctingOutcome: outcome },
                                  event.currentTarget
                                )}
                                type="button"
                              >
                                Correct this result
                              </button>
                            ) : null}
                          </li>
                        );
                      })}
                    </ol>
                  ) : task.status === "done" ? <p className="research-legacy-note">Completed before result notes were recorded.</p> : null}
                  {canWrite && task.status !== "done" ? (
                    <>
                      <div className="research-task-actions">
                        {task.status === "todo" ? (
                          <button className="button-ghost" disabled={actionsLocked || anotherAssignmentIsDoing} onClick={() => startAssignment(task)} type="button">Start</button>
                        ) : null}
                        <button className="button-ghost" disabled={actionsLocked} onClick={(event) => openOutcome(task, {}, event.currentTarget)} type="button">Record result</button>
                      </div>
                      {task.status === "todo" && anotherAssignmentIsDoing ? (
                        <p className="research-action-note">Finish the in-progress assignment before starting this one.</p>
                      ) : null}
                    </>
                  ) : null}
                </article>
              );
            })}
          </div>
          {researchCase.tasks.length === 0 ? <p className="muted empty-state">No assignments yet. The guide will suggest one when the case has a testable hypothesis.</p> : null}
        </section>
      </div>
    </div>
  );
}

async function requestJson(url: string, input: { method: "POST" | "PATCH"; body: unknown }): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: input.method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input.body)
  });
  let body: Record<string, unknown> = {};
  try {
    const value: unknown = await response.json();
    if (isRecord(value)) body = value;
  } catch {
    // Some infrastructure errors return HTML or an empty body. Preserve the
    // HTTP status so callers can still offer the right recovery path.
  }
  if (!response.ok) {
    throw new ClientRequestError(
      typeof body.error === "string" ? body.error : "The case could not be updated.",
      response.status
    );
  }
  return body;
}

class ClientRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ClientRequestError";
    this.status = status;
  }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
