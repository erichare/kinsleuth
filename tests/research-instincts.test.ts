import { describe, expect, it, vi } from "vitest";

import {
  RESEARCH_INSTINCTS_PROGRESS_VERSION,
  RESEARCH_INSTINCTS_STORAGE_KEY,
  createEmptyResearchInstinctsProgress,
  isResearchInstinctsSelectionComplete,
  nextResearchInstinctsSelection,
  researchInstinctsCases,
  resetResearchInstinctsProgress,
  sanitizeResearchInstinctsProgress,
  scoreResearchInstinctsCase,
  scoreResearchInstinctsChallenge
} from "@/lib/research-instincts";

import {
  EXPECTED_IMMERSIVE_RECORDS,
  IMMERSIVE_CASE_ID,
  type ImmersiveCaseContract
} from "./research-instincts-immersive-contract";

const expectedCaseIds = [
  "mercer-march-identity",
  "blue-tin-timeline",
  "harbor-photo",
  "two-malias",
  "dna-clusters"
] as const;

const expectedLore = [
  [/Samuel Mercer/i, /Samuel March/i, /Maeve/i],
  [/Amalia/i, /1922/i, /1907/i],
  [/Northstar Cove/i, /1906/i, /Samuel/i, /Maeve/i, /Jonah/i, /\bAR\b/i, /Clara/i],
  [/Amalia Rose/i, /seven[- ]year[- ]old/i, /sibling/i],
  [/M\. Alder/i, /T\. Pike/i, /Elowen Rowan/i, /R\. Solari/i, /Bellandi/i, /cM/i]
] as const;

type ChallengeCase = (typeof researchInstinctsCases)[number];
type ChallengeQuestion = ChallengeCase["questions"][number];
type Selections = Record<"conclusion" | "evidence" | "caution", string[]>;

function questionFor(challengeCase: ChallengeCase, questionId: keyof Selections) {
  const question = challengeCase.questions.find((candidate) => candidate.id === questionId);
  if (!question) throw new Error(`Missing ${String(questionId)} question for ${challengeCase.id}`);
  return question;
}

function correctSelections(challengeCase: ChallengeCase): Selections {
  return {
    conclusion: [...questionFor(challengeCase, "conclusion").answerOptionIds],
    evidence: [...questionFor(challengeCase, "evidence").answerOptionIds],
    caution: [...questionFor(challengeCase, "caution").answerOptionIds]
  };
}

function incorrectOptionIds(question: ChallengeQuestion): string[] {
  const answerOptionIds: readonly string[] = question.answerOptionIds;
  return question.options
    .map((option) => option.id)
    .filter((optionId) => !answerOptionIds.includes(optionId));
}

function wrongSelections(challengeCase: ChallengeCase): Selections {
  return {
    conclusion: incorrectOptionIds(questionFor(challengeCase, "conclusion")).slice(0, 1),
    evidence: incorrectOptionIds(questionFor(challengeCase, "evidence")).slice(0, 2),
    caution: incorrectOptionIds(questionFor(challengeCase, "caution")).slice(0, 1)
  };
}

describe("research instincts fictional challenge data", () => {
  it("publishes exactly five unique cases in the intended story order", () => {
    const ids = researchInstinctsCases.map((challengeCase) => challengeCase.id);

    expect(ids).toEqual(expectedCaseIds);
    expect(new Set(ids).size).toBe(5);
  });

  it("defines the six canonical records for the immersive Mercer–March case", () => {
    const challengeCase = researchInstinctsCases.find(({ id }) => id === IMMERSIVE_CASE_ID) as
      | (ChallengeCase & ImmersiveCaseContract)
      | undefined;
    const records = challengeCase?.records ?? [];

    expect(challengeCase, IMMERSIVE_CASE_ID).toBeDefined();
    expect(records).toHaveLength(EXPECTED_IMMERSIVE_RECORDS.length);
    expect(records.map(({ catalogId }) => catalogId)).toEqual(
      EXPECTED_IMMERSIVE_RECORDS.map(({ catalogId }) => catalogId)
    );
    expect(records.map(({ image }) => image.src)).toEqual(
      EXPECTED_IMMERSIVE_RECORDS.map(({ assetPath }) => assetPath)
    );
    expect(new Set(records.map(({ id }) => id)).size, "record ids").toBe(records.length);
    expect(new Set(records.map(({ catalogId }) => catalogId)).size, "catalog ids").toBe(records.length);

    records.forEach((record, index) => {
      const expected = EXPECTED_IMMERSIVE_RECORDS[index];
      expect(record.id.trim(), `${record.catalogId} id`).not.toBe("");
      expect(record.title, `${record.catalogId} title`).toMatch(expected.titlePattern);
      expect(record.kind.trim(), `${record.catalogId} kind`).not.toBe("");
      expect(record.date.trim(), `${record.catalogId} date`).not.toBe("");
      expect(record.image.alt.trim(), `${record.catalogId} image alt`).not.toBe("");
      expect(record.image.width, `${record.catalogId} image width`).toBeGreaterThan(0);
      expect(record.image.height, `${record.catalogId} image height`).toBeGreaterThan(0);
      expect(record.transcript.kind, `${record.catalogId} transcript kind`).toBe(expected.transcriptKind);
    });
  });

  it("provides complete metadata and structurally valid transcripts for every immersive record", () => {
    const challengeCase = researchInstinctsCases.find(({ id }) => id === IMMERSIVE_CASE_ID) as
      | (ChallengeCase & ImmersiveCaseContract)
      | undefined;
    const records = challengeCase?.records ?? [];

    expect(records).toHaveLength(EXPECTED_IMMERSIVE_RECORDS.length);
    for (const record of records) {
      expect(record.metadata.length, `${record.catalogId} metadata`).toBeGreaterThan(0);
      for (const item of record.metadata) {
        expect(item.label.trim(), `${record.catalogId} metadata label`).not.toBe("");
        expect(item.value.trim(), `${record.catalogId}/${item.label} metadata value`).not.toBe("");
      }

      if (record.transcript.kind === "letter") {
        expect(record.transcript.paragraphs.length, `${record.catalogId} transcript paragraphs`).toBeGreaterThan(0);
        expect(
          record.transcript.paragraphs.every((paragraph) => paragraph.trim().length > 0),
          `${record.catalogId} transcript paragraphs`
        ).toBe(true);
      } else {
        expect(record.transcript.kind, `${record.catalogId} transcript kind`).toBe("table");
        expect(record.transcript.columns.length, `${record.catalogId} transcript columns`).toBeGreaterThan(0);
        expect(record.transcript.rows.length, `${record.catalogId} transcript rows`).toBeGreaterThan(0);
        expect(
          record.transcript.columns.every((column) => column.trim().length > 0),
          `${record.catalogId} transcript columns`
        ).toBe(true);
        for (const row of record.transcript.rows) {
          expect(row, `${record.catalogId} transcript row width`).toHaveLength(record.transcript.columns.length);
          expect(
            row.every((cell) => cell.trim().length > 0),
            `${record.catalogId} transcript row cells`
          ).toBe(true);
        }
      }
    }
  });

  it("keeps record clues and notebook references unique, resolvable, and bidirectional", () => {
    const challengeCase = researchInstinctsCases.find(({ id }) => id === IMMERSIVE_CASE_ID) as
      | (ChallengeCase & ImmersiveCaseContract)
      | undefined;
    const records = challengeCase?.records ?? [];
    const notebookClues = challengeCase?.notebookClues ?? [];

    expect(records).toHaveLength(EXPECTED_IMMERSIVE_RECORDS.length);
    expect(notebookClues.length, "notebook clues").toBeGreaterThan(0);

    const recordsById = new Map(records.map((record) => [record.id, record]));
    const cluesById = new Map(notebookClues.map((clue) => [clue.id, clue]));
    expect(recordsById.size, "unique record ids").toBe(records.length);
    expect(cluesById.size, "unique notebook clue ids").toBe(notebookClues.length);

    for (const record of records) {
      expect(record.clueIds.length, `${record.catalogId} clue references`).toBeGreaterThan(0);
      expect(new Set(record.clueIds).size, `${record.catalogId} unique clue references`).toBe(
        record.clueIds.length
      );
      for (const clueId of record.clueIds) {
        const clue = cluesById.get(clueId);
        expect(clue, `${record.catalogId} references known notebook clue ${clueId}`).toBeDefined();
        expect(clue?.recordIds, `${clueId} links back to ${record.id}`).toContain(record.id);
      }
    }

    for (const clue of notebookClues) {
      expect(clue.id.trim(), "notebook clue id").not.toBe("");
      expect(clue.label.trim(), `${clue.id} label`).not.toBe("");
      expect(clue.recordIds.length, `${clue.id} record references`).toBeGreaterThan(0);
      expect(new Set(clue.recordIds).size, `${clue.id} unique record references`).toBe(clue.recordIds.length);
      for (const recordId of clue.recordIds) {
        const record = recordsById.get(recordId);
        expect(record, `${clue.id} references known record ${recordId}`).toBeDefined();
        expect(record?.clueIds, `${recordId} links back to ${clue.id}`).toContain(clue.id);
      }
    }
  });

  it("keeps every case anchored to the fictional Hartwell–Mercer lore", () => {
    researchInstinctsCases.forEach((challengeCase, index) => {
      const serializedCase = JSON.stringify(challengeCase);
      for (const expectedClue of expectedLore[index]) {
        expect(serializedCase, `${challengeCase.id} is missing ${expectedClue}`).toMatch(expectedClue);
      }
    });
  });

  it("uses the same facts as the canonical demo cases instead of forking the family lore", () => {
    const canonicalDetails = [
      ["4 May 1907", "1909 marriage", "Maeve Mercer", "1906 letter"],
      ["1984", "1921 repair receipt", "Amalia Bellandi", "Nora Hartwell"],
      ["North Star Chandlery", "September through November 1906", "image quality", "after 1928"],
      ["Luca Bellandi", "Mira Solari", "Rosa", "Ettore", "7 July 1861", "1883"],
      ["M. Alder", "T. Pike", "R. Solari", "86 cM", "54 cM", "37 cM", "Elowen Rowan", "Rosa Bellandi", "provisional"]
    ] as const;

    researchInstinctsCases.forEach((challengeCase, index) => {
      const serializedCase = JSON.stringify(challengeCase);
      for (const detail of canonicalDetails[index]) {
        expect(serializedCase, `${challengeCase.id} is missing canonical detail ${detail}`).toContain(detail);
      }
    });

    expect(JSON.stringify(researchInstinctsCases)).not.toMatch(
      /Maeve Hartwell|Tomaso Bellandi|Pietro|Luisa|injured left thumb/i
    );
  });

  it("uses a canonical 40/40/20 rubric worth exactly 100 points per case", () => {
    for (const challengeCase of researchInstinctsCases) {
      expect(challengeCase.questions.map((question) => question.id)).toEqual([
        "conclusion",
        "evidence",
        "caution"
      ]);
      expect(challengeCase.questions.map((question) => question.points)).toEqual([40, 40, 20]);
      expect(challengeCase.questions.map((question) => question.pickCount)).toEqual([1, 2, 1]);
      expect(challengeCase.questions.reduce((sum, question) => sum + question.points, 0)).toBe(100);
    }
  });

  it("has unique option ids, exact answer counts, and an explicit uncertainty choice", () => {
    for (const challengeCase of researchInstinctsCases) {
      for (const question of challengeCase.questions) {
        const optionIds = question.options.map((option) => option.id);

        expect(new Set(optionIds).size, `${challengeCase.id}/${question.id} option ids`).toBe(optionIds.length);
        expect(question.answerOptionIds, `${challengeCase.id}/${question.id} answer count`).toHaveLength(
          question.pickCount
        );
        expect(question.answerOptionIds.every((optionId) => optionIds.includes(optionId))).toBe(true);
        expect(optionIds, `${challengeCase.id}/${question.id} uncertainty choice`).toContain("not-sure");
        expect(incorrectOptionIds(question).length).toBeGreaterThanOrEqual(question.pickCount);
      }
    }
  });
});

describe("research instincts scoring", () => {
  it("awards 100 points for the canonical answer and ignores selected-answer ordering", () => {
    for (const challengeCase of researchInstinctsCases) {
      const selections = correctSelections(challengeCase);
      const expectedScore = {
        caseId: challengeCase.id,
        scores: { conclusion: 40, evidence: 40, caution: 20 },
        total: 100,
        maximum: 100
      };

      expect(scoreResearchInstinctsCase(challengeCase.id, selections)).toEqual(expectedScore);
      expect(
        scoreResearchInstinctsCase(challengeCase.id, {
          ...selections,
          evidence: [...selections.evidence].reverse()
        })
      ).toEqual(expectedScore);
    }
  });

  it("awards deterministic partial credit without rewarding a wrong caution", () => {
    for (const challengeCase of researchInstinctsCases) {
      const correct = correctSelections(challengeCase);
      const wrong = wrongSelections(challengeCase);

      expect(
        scoreResearchInstinctsCase(challengeCase.id, {
          conclusion: correct.conclusion,
          evidence: [correct.evidence[0], wrong.evidence[0]],
          caution: wrong.caution
        })
      ).toEqual({
        caseId: challengeCase.id,
        scores: { conclusion: 40, evidence: 20, caution: 0 },
        total: 60,
        maximum: 100
      });
    }
  });

  it("scores wrong and explicit not-sure answers as zero", () => {
    for (const challengeCase of researchInstinctsCases) {
      const wrong = wrongSelections(challengeCase);
      const unknown: Selections = {
        conclusion: ["not-sure"],
        evidence: ["not-sure"],
        caution: ["not-sure"]
      };

      expect(scoreResearchInstinctsCase(challengeCase.id, wrong).total).toBe(0);
      expect(scoreResearchInstinctsCase(challengeCase.id, unknown)).toMatchObject({
        scores: { conclusion: 0, evidence: 0, caution: 0 },
        total: 0,
        maximum: 100
      });
    }
  });

  it("allows explicit uncertainty to stand alone without an arbitrary second clue", () => {
    expect(isResearchInstinctsSelectionComplete(["not-sure"], 2)).toBe(true);
    expect(isResearchInstinctsSelectionComplete(["one-clue"], 2)).toBe(false);
    expect(nextResearchInstinctsSelection([], "not-sure", 2)).toEqual(["not-sure"]);
    expect(nextResearchInstinctsSelection(["not-sure"], "lead-clue", 2)).toEqual(["lead-clue"]);
    expect(nextResearchInstinctsSelection(["lead-clue"], "not-sure", 2)).toEqual(["not-sure"]);
    expect(nextResearchInstinctsSelection(["lead-clue", "second-clue"], "not-sure", 2)).toEqual([
      "not-sure"
    ]);
  });

  it("scores all five cases deterministically out of 500 in canonical order", () => {
    const answers = Object.fromEntries(
      researchInstinctsCases.map((challengeCase) => [challengeCase.id, correctSelections(challengeCase)])
    );

    const first = scoreResearchInstinctsChallenge(answers);
    const second = scoreResearchInstinctsChallenge(structuredClone(answers));

    expect(first).toEqual(second);
    expect(first.total).toBe(500);
    expect(first.maximum).toBe(500);
    expect(first.caseScores.map((score) => score.caseId)).toEqual(expectedCaseIds);
  });

  it("rejects unknown cases, question ids, option ids, duplicate picks, and wrong pick counts", () => {
    const challengeCase = researchInstinctsCases[0];
    const valid = correctSelections(challengeCase);

    expect(() => scoreResearchInstinctsCase("unknown-case", valid)).toThrow(/unknown case/i);
    expect(() =>
      scoreResearchInstinctsCase(challengeCase.id, { ...valid, conclusion: [] })
    ).toThrow(/conclusion.*exactly 1|exactly 1.*conclusion/i);
    expect(() =>
      scoreResearchInstinctsCase(challengeCase.id, { ...valid, evidence: [valid.evidence[0], valid.evidence[0]] })
    ).toThrow(/evidence.*unique|unique.*evidence/i);
    expect(() =>
      scoreResearchInstinctsCase(challengeCase.id, { ...valid, evidence: ["not-sure", valid.evidence[0]] })
    ).toThrow(/not-sure.*alone|alone.*not-sure/i);
    expect(() =>
      scoreResearchInstinctsCase(challengeCase.id, { ...valid, caution: ["invented-option"] })
    ).toThrow(/caution.*option|option.*caution/i);
    expect(() =>
      scoreResearchInstinctsCase(challengeCase.id, { ...valid, bonus: ["invented"] } as Selections)
    ).toThrow(/unknown question|question.*bonus|bonus.*question/i);
  });
});

describe("research instincts local progress", () => {
  it("uses the isolated, versioned v1 browser storage key", () => {
    expect(RESEARCH_INSTINCTS_PROGRESS_VERSION).toBe(1);
    expect(RESEARCH_INSTINCTS_STORAGE_KEY).toBe("kinresolve:research-instincts:v1");
    expect(createEmptyResearchInstinctsProgress()).toEqual({
      version: 1,
      activeCaseId: expectedCaseIds[0],
      answers: {},
      completedCaseIds: []
    });
  });

  it.each([null, undefined, 17, "progress", [], {}, { version: 1, answers: null }])(
    "fails closed for malformed stored progress %#",
    (rawProgress) => {
      expect(sanitizeResearchInstinctsProgress(rawProgress)).toEqual(createEmptyResearchInstinctsProgress());
    }
  );

  it("fails closed when stored progress has a different schema version", () => {
    const validCase = researchInstinctsCases[0];

    expect(
      sanitizeResearchInstinctsProgress({
        version: 2,
        activeCaseId: validCase.id,
        answers: { [validCase.id]: correctSelections(validCase) },
        completedCaseIds: [validCase.id]
      })
    ).toEqual(createEmptyResearchInstinctsProgress());
  });

  it("sanitizes partial progress by known case, question, option, pick count, and completion", () => {
    const firstCase = researchInstinctsCases[0];
    const secondCase = researchInstinctsCases[1];
    const firstCorrect = correctSelections(firstCase);
    const secondCorrect = correctSelections(secondCase);

    expect(
      sanitizeResearchInstinctsProgress({
        version: 1,
        activeCaseId: "invented-case",
        answers: {
          [firstCase.id]: {
            conclusion: [firstCorrect.conclusion[0], "invented-option", firstCorrect.conclusion[0]],
            evidence: [firstCorrect.evidence[0], "invented-option", firstCorrect.evidence[0], firstCorrect.evidence[1]],
            caution: "not-an-array",
            bonus: ["invented-option"]
          },
          [secondCase.id]: secondCorrect,
          "invented-case": secondCorrect
        },
        completedCaseIds: [firstCase.id, secondCase.id, secondCase.id, "invented-case"],
        score: 500,
        answerKey: "must not survive"
      })
    ).toEqual({
      version: 1,
      activeCaseId: expectedCaseIds[0],
      answers: {
        [firstCase.id]: {
          conclusion: [firstCorrect.conclusion[0]],
          evidence: firstCorrect.evidence
        },
        [secondCase.id]: secondCorrect
      },
      completedCaseIds: [secondCase.id]
    });
  });

  it("resets only the challenge key and leaves neighboring local data untouched", () => {
    const removeItem = vi.fn();
    const storage = { removeItem };

    resetResearchInstinctsProgress(storage);

    expect(removeItem).toHaveBeenCalledOnce();
    expect(removeItem).toHaveBeenCalledWith(RESEARCH_INSTINCTS_STORAGE_KEY);
    expect(removeItem).not.toHaveBeenCalledWith("kinresolve:workspace");
    expect(removeItem).not.toHaveBeenCalledWith("kinresolve:research-instincts:v2");
  });
});
