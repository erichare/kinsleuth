"use client";

import { useState } from "react";
import type { ResearchCase } from "@/lib/models";
import { Status } from "./ui";

type CaseTask = ResearchCase["tasks"][number];

const activeStatusOptions: CaseTask["status"][] = ["todo", "doing"];
const manualStatusOptions: CaseTask["status"][] = [...activeStatusOptions, "done"];

export function CaseTaskList({
  caseId,
  initialTasks,
  canWrite,
  allowManualCompletion = false
}: {
  caseId: string;
  initialTasks: CaseTask[];
  canWrite: boolean;
  allowManualCompletion?: boolean;
}) {
  const [tasks, setTasks] = useState(initialTasks);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [messageRole, setMessageRole] = useState<"alert" | "status">("status");
  const [busyTaskId, setBusyTaskId] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  async function addTask() {
    if (!canWrite) return;
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setMessage("Add a task title first.");
      setMessageRole("alert");
      return;
    }

    setIsAdding(true);
    setMessage("");

    try {
      const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: trimmedTitle })
      });
      const body = await response.json();

      if (!response.ok || !body.task) {
        throw new Error(body.error ?? "Task creation failed");
      }

      setTasks((current) => [body.task as CaseTask, ...current]);
      setTitle("");
      setMessage("Task added.");
      setMessageRole("status");
    } catch (requestError) {
      setMessage(requestError instanceof Error ? requestError.message : "Task creation failed");
      setMessageRole("alert");
    } finally {
      setIsAdding(false);
    }
  }

  async function updateStatus(task: CaseTask, status: CaseTask["status"]) {
    if (!canWrite) return;
    if (!task.updatedAt) {
      setMessage("Refresh this case before changing the task.");
      setMessageRole("alert");
      return;
    }
    setBusyTaskId(task.id);
    setMessage("");

    try {
      const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/tasks/${encodeURIComponent(task.id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status, expectedUpdatedAt: task.updatedAt })
      });
      const body = await response.json();

      if (!response.ok || !body.task) {
        throw new Error(body.error ?? "Task update failed");
      }

      setTasks((current) => current.map((item) => (item.id === task.id ? (body.task as CaseTask) : item)));
    } catch (requestError) {
      setMessage(requestError instanceof Error ? requestError.message : "Task update failed");
      setMessageRole("alert");
    } finally {
      setBusyTaskId((current) => (current === task.id ? "" : current));
    }
  }

  return (
    <div aria-busy={isAdding || Boolean(busyTaskId)} className="case-task-workspace">
      {canWrite ? (
        <div className="task-add-row">
          <label className="field">
            <span>New task</span>
            <input placeholder="Compare the fictional blue-tin receipts with the harbor payroll..." value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <button aria-busy={isAdding} className="button-secondary" disabled={isAdding} onClick={addTask} type="button">
            {isAdding ? "Adding..." : "Add"}
          </button>
        </div>
      ) : (
        <p className="research-readonly-note">An editor can update manual tasks for this case.</p>
      )}

      <div className="task-list">
        {tasks.map((task) => (
          <div className="task-item" key={task.id}>
            <div>
              <strong>{task.title}</strong>
              <Status tone={task.status === "done" ? "ok" : task.status === "doing" ? "warning" : "private"}>{task.status}</Status>
            </div>
            {canWrite && task.status !== "done" ? (
              <div className="segmented-control" aria-label={`Update ${task.title} status`} role="group">
                {(allowManualCompletion && (task.origin ?? "manual") === "manual"
                  ? manualStatusOptions
                  : activeStatusOptions
                ).map((status) => (
                  <button
                    aria-busy={busyTaskId === task.id}
                    aria-pressed={task.status === status}
                    className={task.status === status ? "active" : undefined}
                    disabled={busyTaskId === task.id || !task.updatedAt}
                    key={status}
                    onClick={() => updateStatus(task, status)}
                    type="button"
                  >
                    {status}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {tasks.length === 0 ? <p className="muted empty-state">No tasks yet.</p> : null}
      {message ? <p aria-atomic="true" className={messageRole === "alert" ? "form-error" : "muted"} role={messageRole}>{message}</p> : null}
    </div>
  );
}
