"use client";

/* eslint-disable @next/next/no-img-element -- Fixed local demo records are shared by two independently installed Next packages. */

import type { FormEvent } from "react";

import {
  RESEARCH_INSTINCTS_STORAGE_KEY,
  createEmptyResearchInstinctsProgress,
  isResearchInstinctsSelectionComplete,
  nextResearchInstinctsSelection,
  researchInstinctsCases,
  resetResearchInstinctsProgress,
  sanitizeResearchInstinctsProgress,
  scoreResearchInstinctsCase,
  scoreResearchInstinctsChallenge
} from "./research-instincts";

type QuestionId = "conclusion" | "evidence" | "caution";
type DraftSelections = Partial<Record<QuestionId, string[]>>;
type CompleteSelections = Parameters<typeof scoreResearchInstinctsCase>[1];
type ChallengeAnswers = Parameters<typeof scoreResearchInstinctsChallenge>[0];
type ReactHooks = Pick<typeof import("react"), "useEffect" | "useMemo" | "useRef" | "useState">;
type ReactHookRuntime = Record<keyof ReactHooks, unknown>;

const minimumRecordZoom = 75;
const maximumRecordZoom = 200;
const recordZoomStep = 25;

function dossierAssessment(score: number) {
  if (score >= 450) return "Archive sleuth";
  if (score >= 350) return "Careful investigator";
  if (score >= 250) return "Promising researcher";
  return "Curious apprentice";
}

export function createResearchInstinctsChallenge(runtime: ReactHookRuntime) {
  // The product and marketing packages install React independently. Keep the
  // package boundary structural, then type the known React hooks internally.
  const { useEffect, useMemo, useRef, useState } = runtime as ReactHooks;

  return function ResearchInstinctsChallenge() {
    const [progress, setProgress] = useState(createEmptyResearchInstinctsProgress);
    const [hydrated, setHydrated] = useState(false);
    const [confirmReset, setConfirmReset] = useState(false);
    const [announcement, setAnnouncement] = useState("");
    const [focusResult, setFocusResult] = useState(false);
    const [focusCaseRequest, setFocusCaseRequest] = useState(0);
    const [recordZoom, setRecordZoom] = useState(100);
    const resultRef = useRef<HTMLElement>(null);
    const caseTitleRef = useRef<HTMLHeadingElement>(null);
    const resetConfirmRef = useRef<HTMLButtonElement>(null);
    const resetTriggerRef = useRef<HTMLButtonElement>(null);
    const restoreResetFocusRef = useRef(false);

    useEffect(() => {
      let active = true;
      queueMicrotask(() => {
        if (!active) return;

        let restored = createEmptyResearchInstinctsProgress();
        try {
          const stored = window.localStorage.getItem(RESEARCH_INSTINCTS_STORAGE_KEY);
          restored = sanitizeResearchInstinctsProgress(stored ? JSON.parse(stored) : null);
        } catch {
          restored = createEmptyResearchInstinctsProgress();
        }

        setProgress(restored);
        setHydrated(true);
        if (restored.completedCaseIds.length > 0) {
          setAnnouncement(`Restored progress for ${restored.completedCaseIds.length} completed case${restored.completedCaseIds.length === 1 ? "" : "s"}.`);
        }
      });

      return () => {
        active = false;
      };
    }, []);

    useEffect(() => {
      if (!hydrated) return;

      try {
        window.localStorage.setItem(RESEARCH_INSTINCTS_STORAGE_KEY, JSON.stringify(progress));
      } catch {
        queueMicrotask(() => {
          setAnnouncement("Your answers are available for this visit, but browser progress could not be saved.");
        });
      }
    }, [hydrated, progress]);

    const activeCaseIndex = Math.max(
      0,
      researchInstinctsCases.findIndex((challengeCase) => challengeCase.id === progress.activeCaseId)
    );
    const activeCase = researchInstinctsCases[activeCaseIndex] ?? researchInstinctsCases[0];
    const caseRecords = activeCase.records ?? [];
    const caseNotebookClues = activeCase.notebookClues ?? [];
    const hasRecordDesk = caseRecords.length > 0;
    const activeDesk = progress.recordDesk[activeCase.id];
    const activeRecordId = activeDesk?.activeRecordId ?? caseRecords[0]?.id ?? "";
    const reviewedRecordIds = activeDesk?.reviewedRecordIds ?? [];
    const notebookClueIds = activeDesk?.notebookClueIds ?? [];
    const activeRecord = caseRecords.find((record) => record.id === activeRecordId) ?? caseRecords[0];
    const activeRecordClues = activeRecord
      ? caseNotebookClues.filter((clue) => activeRecord.clueIds.includes(clue.id))
      : [];
    const savedNotebookClues = caseNotebookClues.filter((clue) => notebookClueIds.includes(clue.id));
    const reviewedRecordCount = caseRecords.filter((record) => reviewedRecordIds.includes(record.id)).length;
    const allCaseRecordsReviewed = !hasRecordDesk || reviewedRecordCount === caseRecords.length;
    const notebookReady = !hasRecordDesk || notebookClueIds.length >= 2;
    const selections = (progress.answers[activeCase.id] ?? {}) as DraftSelections;
    const submitted = progress.completedCaseIds.includes(activeCase.id);
    const completedCount = progress.completedCaseIds.length;
    const allComplete = completedCount === researchInstinctsCases.length;
    const caseScore = submitted
      ? scoreResearchInstinctsCase(activeCase.id, selections as CompleteSelections)
      : null;
    const nextIncompleteCase = researchInstinctsCases.find(
      (challengeCase) => !progress.completedCaseIds.includes(challengeCase.id)
    );
    const dossierScore = useMemo(
      () => (allComplete ? scoreResearchInstinctsChallenge(progress.answers as ChallengeAnswers) : null),
      [allComplete, progress.answers]
    );

    const questionsComplete = activeCase.questions.every(
      (question) => isResearchInstinctsSelectionComplete(
        selections[question.id] ?? [],
        question.pickCount
      )
    );
    const firstIncompleteQuestion = activeCase.questions.find(
      (question) => !isResearchInstinctsSelectionComplete(
        selections[question.id] ?? [],
        question.pickCount
      )
    );
    const readyToSubmit = questionsComplete && allCaseRecordsReviewed && notebookReady;

    const questionCompletionHint = firstIncompleteQuestion
      ? (() => {
          const selectedCount = (selections[firstIncompleteQuestion.id] ?? []).length;
          if (firstIncompleteQuestion.pickCount === 1) {
            return `Choose an answer for “${firstIncompleteQuestion.prompt}”`;
          }
          const remaining = Math.max(1, firstIncompleteQuestion.pickCount - selectedCount);
          return `Choose ${remaining} more clue${remaining === 1 ? "" : "s"} for “${firstIncompleteQuestion.prompt}” (${selectedCount} of ${firstIncompleteQuestion.pickCount} selected), or choose “I’m not sure.”`;
        })()
      : "Answer all three prompts to submit.";

    useEffect(() => {
      if (focusResult && submitted) {
        resultRef.current?.focus();
      }
    }, [focusResult, submitted]);

    useEffect(() => {
      if (focusCaseRequest > 0) {
        caseTitleRef.current?.focus();
      }
    }, [activeCase.id, focusCaseRequest]);

    useEffect(() => {
      if (confirmReset) {
        resetConfirmRef.current?.focus();
      } else if (restoreResetFocusRef.current) {
        restoreResetFocusRef.current = false;
        resetTriggerRef.current?.focus();
      }
    }, [confirmReset]);

    function updateSelection(questionId: QuestionId, optionId: string, pickCount: number) {
      if (submitted) return;

      const selected = selections[questionId] ?? [];
      const nextSelection = nextResearchInstinctsSelection(selected, optionId, pickCount);

      setProgress((current) =>
        sanitizeResearchInstinctsProgress({
          ...current,
          activeCaseId: activeCase.id,
          answers: {
            ...current.answers,
            [activeCase.id]: {
              ...(current.answers[activeCase.id] ?? {}),
              [questionId]: nextSelection
            }
          }
        })
      );
      const question = activeCase.questions.find((candidate) => candidate.id === questionId);
      const selectionStatus = nextSelection.includes("not-sure")
        ? "Uncertainty selected."
        : `${nextSelection.length} of ${pickCount} selected.${
            nextSelection.length < pickCount
              ? ` Choose ${pickCount - nextSelection.length} more.`
              : ""
          }`;
      setAnnouncement(`${question?.prompt ?? "Question"} ${selectionStatus}`);
    }

    function openRecord(recordId: string) {
      const record = caseRecords.find((candidate) => candidate.id === recordId);
      if (!record) return;

      setProgress((current) => {
        const currentDesk = current.recordDesk[activeCase.id] ?? {
          activeRecordId: record.id,
          reviewedRecordIds: [],
          notebookClueIds: []
        };
        return sanitizeResearchInstinctsProgress({
          ...current,
          activeCaseId: activeCase.id,
          recordDesk: {
            ...current.recordDesk,
            [activeCase.id]: {
              ...currentDesk,
              activeRecordId: record.id,
              reviewedRecordIds: currentDesk.reviewedRecordIds.includes(record.id)
                ? currentDesk.reviewedRecordIds
                : [...currentDesk.reviewedRecordIds, record.id]
            }
          }
        });
      });
      setRecordZoom(100);
      setAnnouncement(`Opened ${record.catalogId}: ${record.title}.`);
    }

    function changeRecordZoom(nextZoom: number) {
      const boundedZoom = Math.min(maximumRecordZoom, Math.max(minimumRecordZoom, nextZoom));
      setRecordZoom(boundedZoom);
      setAnnouncement(`Record zoom set to ${boundedZoom} percent.`);
    }

    function toggleNotebookClue(clueId: string) {
      const clue = caseNotebookClues.find((candidate) => candidate.id === clueId);
      if (!clue) return;

      const removing = notebookClueIds.includes(clueId);
      setProgress((current) => {
        const currentDesk = current.recordDesk[activeCase.id];
        if (!currentDesk) return current;
        return sanitizeResearchInstinctsProgress({
          ...current,
          recordDesk: {
            ...current.recordDesk,
            [activeCase.id]: {
              ...currentDesk,
              notebookClueIds: removing
                ? currentDesk.notebookClueIds.filter((savedId) => savedId !== clueId)
                : [...currentDesk.notebookClueIds, clueId]
            }
          }
        });
      });
      setAnnouncement(`${removing ? "Removed" : "Added"} clue ${removing ? "from" : "to"} your notebook.`);
    }

    function submitCase(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      if (!readyToSubmit || submitted) return;

      scoreResearchInstinctsCase(activeCase.id, selections as CompleteSelections);
      setProgress((current) =>
        sanitizeResearchInstinctsProgress({
          ...current,
          activeCaseId: activeCase.id,
          completedCaseIds: [...current.completedCaseIds, activeCase.id]
        })
      );
      setAnnouncement(`Case ${activeCaseIndex + 1} submitted. Your answer is now locked.`);
      setFocusResult(true);
    }

    function continueChallenge() {
      if (!nextIncompleteCase) return;

      setProgress((current) =>
        sanitizeResearchInstinctsProgress({
          ...current,
          activeCaseId: nextIncompleteCase.id
        })
      );
      setRecordZoom(100);
      setAnnouncement(`Opened ${nextIncompleteCase.title}.`);
      setFocusCaseRequest((request) => request + 1);
    }

    function confirmChallengeReset() {
      try {
        resetResearchInstinctsProgress(window.localStorage);
      } catch {
        // State still resets for this visit when browser storage is unavailable.
      }
      setProgress(createEmptyResearchInstinctsProgress());
      setRecordZoom(100);
      setConfirmReset(false);
      setAnnouncement("Challenge progress reset. Case one is ready.");
      setFocusCaseRequest((request) => request + 1);
    }

    function cancelChallengeReset() {
      restoreResetFocusRef.current = true;
      setConfirmReset(false);
    }

    return (
      <section className="challenge-shell" aria-label="Research instincts challenge">
        <div className="challenge-progress-card">
          <div className="challenge-progress-copy">
            <strong>Five-case dossier</strong>
            <span>{completedCount} of {researchInstinctsCases.length} cases complete</span>
          </div>
          <div
            aria-label={`${completedCount} of ${researchInstinctsCases.length} cases complete`}
            aria-valuemax={researchInstinctsCases.length}
            aria-valuemin={0}
            aria-valuenow={completedCount}
            className="challenge-progress-track"
            role="progressbar"
          >
            <div
              className="challenge-progress-fill"
              style={{ width: `${(completedCount / researchInstinctsCases.length) * 100}%` }}
            />
          </div>
        </div>

        <article className="challenge-case-card">
          <header className="challenge-case-header">
            <span className="challenge-case-count">Case {activeCaseIndex + 1} of {researchInstinctsCases.length} · {activeCase.kicker}</span>
            <h2 ref={caseTitleRef} tabIndex={-1}>{activeCase.title}</h2>
            <p>{activeCase.brief}</p>
            <p className="challenge-case-skill"><strong>Research skill</strong><span>{activeCase.skill}</span></p>
          </header>

          {hasRecordDesk && activeRecord ? (
            <section className="challenge-record-desk" aria-labelledby={`record-desk-${activeCase.id}`}>
              <header className="challenge-record-desk-header">
                <div>
                  <span className="challenge-record-kicker">Immersive case file</span>
                  <h3 id={`record-desk-${activeCase.id}`}>Investigate the source trail</h3>
                  <p>Open every record, compare the image with its transcript, and save the clues you would carry into a research log. Everything needed is inside the case file; some reference exhibits only become useful when compared with another source.</p>
                </div>
                <p className="challenge-record-review-count">
                  <strong>{reviewedRecordCount} of {caseRecords.length}</strong>
                  records reviewed
                </p>
              </header>

              <nav aria-label="Case records" className="challenge-record-nav">
                {caseRecords.map((record, index) => {
                  const selected = activeRecord.id === record.id;
                  const reviewed = reviewedRecordIds.includes(record.id);

                  return (
                    <button
                      aria-current={selected ? "page" : undefined}
                      aria-pressed={selected}
                      className="challenge-record-tab"
                      key={record.id}
                      onClick={() => openRecord(record.id)}
                      type="button"
                    >
                      <span>Record {index + 1}{reviewed ? " · Reviewed" : ""}</span>
                      <strong>{record.catalogId}</strong>
                      <small>{record.kind} · {record.date}</small>
                    </button>
                  );
                })}
              </nav>

              <div className="challenge-record-layout">
                <section
                  aria-labelledby={`record-title-${activeRecord.id}`}
                  className="challenge-record-inspector"
                  data-challenge-region="record-inspector"
                >
                  <header className="challenge-record-inspector-header">
                    <span>{activeRecord.catalogId}</span>
                    <h3 id={`record-title-${activeRecord.id}`}>{activeRecord.title}</h3>
                    <p>{activeRecord.kind} · {activeRecord.date}</p>
                  </header>

                  <div aria-label="Record image controls" className="challenge-record-toolbar" role="group">
                    <button
                      aria-label="Zoom out"
                      disabled={recordZoom <= minimumRecordZoom}
                      onClick={() => changeRecordZoom(recordZoom - recordZoomStep)}
                      type="button"
                    >
                      <span aria-hidden="true">−</span>
                    </button>
                    <output aria-live="polite">{recordZoom}%</output>
                    <button
                      aria-label="Zoom in"
                      disabled={recordZoom >= maximumRecordZoom}
                      onClick={() => changeRecordZoom(recordZoom + recordZoomStep)}
                      type="button"
                    >
                      <span aria-hidden="true">+</span>
                    </button>
                    <button
                      aria-label="Reset zoom"
                      className="challenge-record-reset-zoom"
                      disabled={recordZoom === 100}
                      onClick={() => changeRecordZoom(100)}
                      type="button"
                    >
                      Reset
                    </button>
                  </div>

                  <figure className="challenge-record-figure">
                    <div
                      aria-label={`Scrollable image of ${activeRecord.title}`}
                      className="challenge-record-viewport"
                      key={activeRecord.id}
                      role="region"
                      tabIndex={0}
                    >
                      <img
                        alt={activeRecord.image.alt}
                        decoding="async"
                        draggable={false}
                        height={activeRecord.image.height}
                        src={activeRecord.image.src}
                        style={{ transform: `scale(${recordZoom / 100})` }}
                        width={activeRecord.image.width}
                      />
                    </div>
                    <figcaption>
                      Synthetic exhibit {activeRecord.catalogId}. The permanent fictional-demo mark is part of the image.
                    </figcaption>
                  </figure>

                  <dl className="challenge-record-metadata">
                    {activeRecord.metadata.map((item) => (
                      <div key={item.label}>
                        <dt>{item.label}</dt>
                        <dd>{item.value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>

                <section
                  aria-labelledby={`transcript-${activeRecord.id}`}
                  className="challenge-transcript"
                  data-challenge-region="transcript"
                >
                  <header>
                    <span>Accessible reading copy</span>
                    <h3 id={`transcript-${activeRecord.id}`}>Transcript</h3>
                    <p>Use the image for visual clues and this research transcript for names, dates, and damaged text.</p>
                  </header>

                  {activeRecord.transcript.kind === "table" ? (
                    <div
                      aria-label={`Scrollable transcript table for ${activeRecord.title}`}
                      className="challenge-transcript-table-wrap"
                      role="region"
                      tabIndex={0}
                    >
                      <table>
                        <caption>{activeRecord.title}</caption>
                        <thead>
                          <tr>
                            {activeRecord.transcript.columns.map((column) => <th key={column} scope="col">{column}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {activeRecord.transcript.rows.map((row, rowIndex) => (
                            <tr key={`${activeRecord.id}-row-${rowIndex}`}>
                              {row.map((cell, cellIndex) => (
                                cellIndex === 0
                                  ? <th key={`${cell}-${cellIndex}`} scope="row">{cell}</th>
                                  : <td key={`${cell}-${cellIndex}`}>{cell}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="challenge-letter-transcript">
                      {activeRecord.transcript.paragraphs.map((paragraph, index) => (
                        <p key={`${activeRecord.id}-paragraph-${index}`}>{paragraph}</p>
                      ))}
                    </div>
                  )}
                </section>
              </div>

              <aside
                aria-labelledby={`notebook-${activeCase.id}`}
                className="challenge-clue-notebook"
                data-challenge-region="clue-notebook"
              >
                <header className="challenge-clue-notebook-header">
                  <div>
                    <span>Working research log</span>
                    <h3 id={`notebook-${activeCase.id}`}>Clue notebook</h3>
                  </div>
                  <p><strong>{savedNotebookClues.length}</strong> clues saved</p>
                </header>
                <p className="challenge-clue-notebook-instruction">
                  Save at least two useful observations. Good notes cite their records and preserve conflicts instead of explaining them away.
                </p>

                <div className="challenge-clue-notebook-layout">
                  <section aria-labelledby={`available-clues-${activeRecord.id}`}>
                    <h4 id={`available-clues-${activeRecord.id}`}>Clues in {activeRecord.catalogId}</h4>
                    <div className="challenge-clue-candidates">
                      {activeRecordClues.map((clue) => {
                        const saved = notebookClueIds.includes(clue.id);
                        return (
                          <button
                            aria-pressed={saved}
                            className="challenge-clue-candidate"
                            key={clue.id}
                            onClick={() => toggleNotebookClue(clue.id)}
                            type="button"
                          >
                            <span>{clue.label}</span>
                            <strong>{saved ? "Remove from notebook" : "Add to notebook"}</strong>
                          </button>
                        );
                      })}
                    </div>
                  </section>

                  <section aria-labelledby={`saved-clues-${activeCase.id}`} className="challenge-saved-clues">
                    <h4 id={`saved-clues-${activeCase.id}`}>Saved observations</h4>
                    {savedNotebookClues.length > 0 ? (
                      <ol>
                        {savedNotebookClues.map((clue) => (
                          <li key={clue.id}>
                            <p>{clue.label}</p>
                            <span>
                              Cites {clue.recordIds
                                .map((recordId) => caseRecords.find((record) => record.id === recordId)?.catalogId)
                                .filter(Boolean)
                                .join(" · ")}
                            </span>
                            <button
                              aria-label={`Remove clue: ${clue.label}`}
                              onClick={() => toggleNotebookClue(clue.id)}
                              type="button"
                            >
                              Remove
                            </button>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <p className="challenge-notebook-empty">Your notebook is empty. Open a record and save an observation that changes—or limits—your theory.</p>
                    )}
                  </section>
                </div>
              </aside>
            </section>
          ) : (
            <section className="challenge-clue-board" aria-labelledby={`clues-${activeCase.id}`}>
              <h3 id={`clues-${activeCase.id}`}>Evidence board</h3>
              <ul>
                {activeCase.clues.map((clue) => <li key={clue}>{clue}</li>)}
              </ul>
            </section>
          )}

          <form
            className="challenge-form challenge-conclusion"
            data-challenge-region="conclusion"
            onSubmit={submitCase}
          >
            <header className="challenge-conclusion-header">
              <span>{hasRecordDesk ? "Your working theory" : "Case questions"}</span>
              <h3>{hasRecordDesk ? "State your conclusion" : "Resolve the case"}</h3>
              <p>{hasRecordDesk ? "Weigh identity, evidence, and uncertainty as separate judgments." : "Choose the conclusion, evidence, and caution that best fit the record."}</p>
            </header>
            {activeCase.questions.map((question) => {
              const selected = selections[question.id] ?? [];
              const instructionId = `${activeCase.id}-${question.id}-instruction`;

              return (
                <fieldset
                  aria-describedby={instructionId}
                  className="challenge-question"
                  key={question.id}
                >
                  <legend>{question.prompt}</legend>
                  <p className="challenge-question-instruction" id={instructionId}>
                    {question.pickCount === 2 ? "Choose exactly two clues, or choose I’m not sure" : "Choose one answer"} · {question.points} points · {selected.includes("not-sure") ? "Uncertainty selected" : `${selected.length} of ${question.pickCount} selected`}
                  </p>
                  <div className="challenge-options">
                    {question.options.map((option) => {
                      const checked = selected.includes(option.id);
                      const atLimit = question.pickCount > 1 && selected.length >= question.pickCount;
                      const isUncertaintyOption = option.id === "not-sure";
                      const isCanonicalAnswer = question.answerOptionIds.includes(option.id);
                      const inputId = `${activeCase.id}-${question.id}-${option.id}`;

                      return (
                        <label className="challenge-option" htmlFor={inputId} key={option.id}>
                          <input
                            checked={checked}
                            disabled={submitted || (!checked && atLimit && !isUncertaintyOption)}
                            id={inputId}
                            name={`${activeCase.id}-${question.id}`}
                            onChange={() => updateSelection(question.id, option.id, question.pickCount)}
                            type={question.pickCount === 1 ? "radio" : "checkbox"}
                            value={option.id}
                          />
                          <span className="challenge-option-text">
                            {option.label}
                            {submitted && isCanonicalAnswer ? (
                              <span className="challenge-option-feedback">Answer-key selection</span>
                            ) : null}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              );
            })}

            {!submitted ? (
              <div className="challenge-form-actions">
                <button className="button" disabled={!readyToSubmit} type="submit">Submit this case</button>
                <p className="challenge-form-hint">
                  {!allCaseRecordsReviewed
                    ? `Review all ${caseRecords.length} records before submitting.`
                    : !notebookReady
                      ? "Save at least two clues to your notebook before submitting."
                    : !questionsComplete
                        ? questionCompletionHint
                        : "Ready for review. Submitting locks this case."}
                </p>
              </div>
            ) : null}

            <div aria-live="polite" className="challenge-announcer" role="status">
              {announcement}
            </div>

            {caseScore ? (
              <section aria-labelledby={`result-${activeCase.id}`} className="challenge-result" ref={resultRef} tabIndex={-1}>
                <h3 id={`result-${activeCase.id}`}>Case review</h3>
                <p className="challenge-result-score">{caseScore.total} / {caseScore.maximum} points</p>
                <dl className="challenge-result-list">
                  {activeCase.questions.map((question) => (
                    <div key={question.id}>
                      <dt>{question.points === caseScore.scores[question.id] ? "Full credit" : `${caseScore.scores[question.id]} of ${question.points} points`} · {question.prompt}</dt>
                      <dd>{question.explanation}</dd>
                    </div>
                  ))}
                </dl>
                {nextIncompleteCase ? (
                  <button className="button" onClick={continueChallenge} type="button">Continue to next case</button>
                ) : null}
              </section>
            ) : null}

            {dossierScore ? (
              <section aria-labelledby="challenge-dossier-title" className="challenge-dossier">
                <span className="card-kicker">Dossier complete</span>
                <h3 id="challenge-dossier-title">{dossierAssessment(dossierScore.total)}</h3>
                <p className="challenge-dossier-score">{dossierScore.total} / 500 points</p>
                <p>You followed evidence across identity, provenance, photographs, sibling groups, and DNA without treating uncertainty as proof.</p>
                <div className="challenge-dossier-actions">
                  <a className="button" href="https://demo.kinresolve.com/">Try Kin Resolve</a>
                  <a className="button-secondary" href="https://kinresolve.com/beta">Apply for the private beta</a>
                </div>
              </section>
            ) : null}

            <div className="challenge-reset">
              {!confirmReset ? (
                <button
                  className="button-ghost"
                  onClick={() => setConfirmReset(true)}
                  ref={resetTriggerRef}
                  type="button"
                >
                  Reset challenge progress
                </button>
              ) : (
                <div role="group" aria-label="Confirm challenge reset">
                  <p>Start over? This clears only this challenge’s progress in this browser.</p>
                  <div className="challenge-reset-actions">
                    <button
                      className="button-secondary"
                      onClick={confirmChallengeReset}
                      ref={resetConfirmRef}
                      type="button"
                    >
                      Yes, reset
                    </button>
                    <button className="button-ghost" onClick={cancelChallengeReset} type="button">Keep my progress</button>
                  </div>
                </div>
              )}
            </div>
          </form>
        </article>
      </section>
    );
  };
}
