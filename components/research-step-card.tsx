"use client";

import type { ResearchTask } from "@/lib/models";
import type { ResearchGuidePlan } from "@/lib/research-guide";
import { Icons } from "./icons";
import { Status } from "./ui";

export function ResearchStepCard({
  plan,
  task,
  canWrite,
  busy,
  outcomeOpen,
  onAccept,
  onAlreadyTried,
  onStart,
  onRecord
}: {
  plan: ResearchGuidePlan;
  task?: ResearchTask;
  canWrite: boolean;
  busy: boolean;
  outcomeOpen: boolean;
  onAccept: (alreadyTried: boolean, trigger?: HTMLButtonElement) => void;
  onAlreadyTried: (task: ResearchTask, trigger: HTMLButtonElement) => void;
  onStart: (task: ResearchTask) => void;
  onRecord: (task: ResearchTask, trigger: HTMLButtonElement) => void;
}) {
  const assignment = plan.assignment;

  return (
    <section className="research-guide-card" aria-labelledby="research-guide-heading">
      <div className="research-private-banner">
        <Icons.Lock aria-hidden size={17} />
        <div>
          <strong>Private research guide</strong>
          <span>Uses only this case’s saved research. The guide does not post to a group or send data to an AI provider.</span>
        </div>
      </div>

      <div className="research-guide-header">
        <div>
          <span className="card-kicker">One useful next step</span>
          <h2 id="research-guide-heading" tabIndex={-1}>{assignment?.title ?? phaseHeading(plan)}</h2>
        </div>
        <Status tone={plan.phase === "resolved" ? "ok" : plan.phase === "paused" ? "warning" : "private"}>
          {phaseLabel(plan)}
        </Status>
      </div>

      <p className="research-guide-reason">{phaseReason(plan)}</p>

      <div className="research-progress" aria-label="Case research progress">
        <div><strong>{plan.progress.evidenceCollected}</strong><span>evidence notes</span></div>
        <div><strong>{plan.progress.completedAssignments}</strong><span>assignments done</span></div>
        <div><strong>{plan.progress.ruledOut}</strong><span>paths ruled out with reasons</span></div>
      </div>

      {assignment ? (
        <div className="research-assignment">
          <div>
            <span className="research-assignment-label">Why this first</span>
            <p>{assignment.guidance === assignment.title ? "This assignment is already in this case’s plan." : assignment.guidance}</p>
          </div>
          {assignment.targetHypothesisId ? <span className="research-context-pill">Tests one working hypothesis</span> : null}
          {canWrite ? (
            <div className="research-assignment-actions">
              {assignment.source === "generated" ? (
                <>
                  <button className="button" disabled={busy || outcomeOpen} onClick={(event) => onAccept(false, event.currentTarget)} type="button">{busy ? "Adding..." : "Add to my plan"}</button>
                  <button className="button-ghost" disabled={busy || outcomeOpen} onClick={(event) => onAccept(true, event.currentTarget)} type="button">I already tried this</button>
                </>
              ) : task?.status === "doing" ? (
                <button className="button" disabled={busy || outcomeOpen} onClick={(event) => onRecord(task, event.currentTarget)} type="button">Record what happened</button>
              ) : task ? (
                <>
                  <button className="button" disabled={busy || outcomeOpen} onClick={() => onStart(task)} type="button">{busy ? "Starting..." : "Start assignment"}</button>
                  <button className="button-ghost" disabled={busy || outcomeOpen} onClick={(event) => onAlreadyTried(task, event.currentTarget)} type="button">I already tried this</button>
                </>
              ) : null}
            </div>
          ) : (
            <p className="research-readonly-note">An editor can update this case. You can review its plan and research memory.</p>
          )}
        </div>
      ) : null}
    </section>
  );
}

function phaseReason(plan: ResearchGuidePlan): string {
  if (plan.phase === "paused") {
    return "This case is paused. Its research memory remains available below, but case status cannot be changed from this page yet.";
  }
  return plan.reason;
}

function phaseHeading(plan: ResearchGuidePlan): string {
  if (plan.phase === "needs_hypothesis") return "Add a testable possibility";
  if (plan.phase === "paused") return "This case is paused";
  if (plan.phase === "resolved") return "This case is resolved";
  return "Choose a more specific search";
}

function phaseLabel(plan: ResearchGuidePlan): string {
  if (plan.phase === "resume") return "in progress";
  if (plan.phase === "needs_hypothesis") return "needs hypothesis";
  return plan.phase;
}
