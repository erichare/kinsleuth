import { describe, expect, it } from "vitest";

import {
  researchInstinctsCases,
  scoreResearchInstinctsChallenge
} from "@/lib/research-instincts";

const allQuestions = researchInstinctsCases.flatMap((challengeCase) =>
  challengeCase.questions.map((question) => ({ challengeCase, question }))
);

function substantiveOptions(question: (typeof allQuestions)[number]["question"]) {
  return question.options.filter(({ id }) => id !== "not-sure");
}

function wordCount(label: string) {
  return label.trim().split(/\s+/).length;
}

function average(values: readonly number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

describe("research instincts answer-bias contract", () => {
  function scoreShortcut(
    rankOptions: (options: ReturnType<typeof substantiveOptions>) => ReturnType<typeof substantiveOptions>
  ) {
    const answers = Object.fromEntries(researchInstinctsCases.map((challengeCase) => [
      challengeCase.id,
      Object.fromEntries(challengeCase.questions.map((question) => [
        question.id,
        rankOptions(substantiveOptions(question))
          .slice(0, question.pickCount)
          .map(({ id }) => id)
      ]))
    ])) as Parameters<typeof scoreResearchInstinctsChallenge>[0];

    return scoreResearchInstinctsChallenge(answers).total;
  }

  it("varies canonical positions instead of teaching a first-option pattern", () => {
    const firstOptionAnswerCount = allQuestions.filter(({ question }) =>
      question.answerOptionIds.includes(question.options[0].id)
    ).length;

    expect(allQuestions).toHaveLength(15);
    expect(firstOptionAnswerCount, "some answers should still appear first").toBeGreaterThanOrEqual(4);
    expect(firstOptionAnswerCount, "first position must not reveal the answer key").toBeLessThanOrEqual(7);

    for (const challengeCase of researchInstinctsCases) {
      const firstOptionAnswers = challengeCase.questions.filter((question) =>
        question.answerOptionIds.includes(question.options[0].id)
      );
      expect(firstOptionAnswers.length, `${challengeCase.id} first-option answers`).toBeLessThan(3);
    }

    const evidenceQuestionsWithBothAnswersFirst = allQuestions.filter(({ question }) => {
      if (question.pickCount !== 2) return false;
      return question.options.slice(0, 2).every(({ id }) => question.answerOptionIds.includes(id));
    });
    expect(evidenceQuestionsWithBothAnswersFirst).toHaveLength(0);
  });

  it("keeps uncertainty last while distributing substantive choices", () => {
    for (const { challengeCase, question } of allQuestions) {
      expect(question.options.at(-1)?.id, `${challengeCase.id}/${question.id}`).toBe("not-sure");
      expect(new Set(question.options.map(({ id }) => id)).size).toBe(question.options.length);
      expect(question.answerOptionIds).not.toContain("not-sure");
    }
  });

  it("removes absolutist giveaway language from competing hypotheses", () => {
    const giveawayPattern = /\b(?:always|cannot|identifies|must|never|no longer|proven?|proves?)\b|\bshould be merged\b|\bbecome proof\b/i;

    for (const { challengeCase, question } of allQuestions) {
      const distractors = substantiveOptions(question).filter(
        ({ id }) => !question.answerOptionIds.includes(id)
      );
      for (const distractor of distractors) {
        expect(
          distractor.label,
          `${challengeCase.id}/${question.id}/${distractor.id} sounds like an answer-key giveaway`
        ).not.toMatch(giveawayPattern);
      }
    }
  });

  it("keeps correct and competing choices within a comparable detail range", () => {
    let canonicalWordTotal = 0;
    let canonicalOptionCount = 0;
    let distractorWordTotal = 0;
    let distractorOptionCount = 0;
    let questionsWhereAnswersAreLonger = 0;

    for (const { challengeCase, question } of allQuestions) {
      const substantive = substantiveOptions(question);
      const canonicalLengths = substantive
        .filter(({ id }) => question.answerOptionIds.includes(id))
        .map(({ label }) => wordCount(label));
      const distractorLengths = substantive
        .filter(({ id }) => !question.answerOptionIds.includes(id))
        .map(({ label }) => wordCount(label));
      const canonicalAverage = average(canonicalLengths);
      const distractorAverage = average(distractorLengths);

      expect(
        Math.abs(canonicalAverage - distractorAverage),
        `${challengeCase.id}/${question.id} option-detail imbalance`
      ).toBeLessThanOrEqual(5);

      if (canonicalAverage > distractorAverage) questionsWhereAnswersAreLonger += 1;
      canonicalWordTotal += canonicalLengths.reduce((sum, value) => sum + value, 0);
      canonicalOptionCount += canonicalLengths.length;
      distractorWordTotal += distractorLengths.reduce((sum, value) => sum + value, 0);
      distractorOptionCount += distractorLengths.length;
    }

    expect(questionsWhereAnswersAreLonger).toBeLessThanOrEqual(8);
    const overallLengthRatio = (canonicalWordTotal / canonicalOptionCount) /
      (distractorWordTotal / distractorOptionCount);
    expect(overallLengthRatio).toBeGreaterThanOrEqual(0.85);
    expect(overallLengthRatio).toBeLessThanOrEqual(1.15);
  });

  it("makes position and answer-length shortcuts perform poorly", () => {
    const firstChoiceScore = scoreShortcut((options) => options);
    const longestChoiceScore = scoreShortcut((options) =>
      [...options].sort((left, right) => right.label.length - left.label.length)
    );

    expect(firstChoiceScore).toBeLessThanOrEqual(200);
    expect(longestChoiceScore).toBeLessThanOrEqual(300);
  });
});
