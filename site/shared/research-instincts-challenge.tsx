"use client";

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

    const readyToSubmit = activeCase.questions.every(
      (question) => isResearchInstinctsSelectionComplete(
        selections[question.id] ?? [],
        question.pickCount
      )
    );

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
      setAnnouncement("");
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
          </header>

          <section className="challenge-clue-board" aria-labelledby={`clues-${activeCase.id}`}>
            <h3 id={`clues-${activeCase.id}`}>Evidence board</h3>
            <ul>
              {activeCase.clues.map((clue) => <li key={clue}>{clue}</li>)}
            </ul>
          </section>

          <form className="challenge-form" onSubmit={submitCase}>
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
                    {question.pickCount === 2 ? "Choose exactly two clues, or choose I’m not sure" : "Choose one answer"} · {question.points} points
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
                  {readyToSubmit ? "Ready for review. Submitting locks this case." : "Answer all three prompts to submit."}
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
