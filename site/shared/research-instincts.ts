export const RESEARCH_INSTINCTS_PROGRESS_VERSION = 1 as const;
export const RESEARCH_INSTINCTS_STORAGE_KEY = "kinresolve:research-instincts:v1";

export type ResearchInstinctsQuestionId = "conclusion" | "evidence" | "caution";

export type ResearchInstinctsOption = {
  id: string;
  label: string;
};

export type ResearchInstinctsQuestion = {
  id: ResearchInstinctsQuestionId;
  prompt: string;
  points: number;
  pickCount: number;
  options: readonly ResearchInstinctsOption[];
  answerOptionIds: readonly string[];
  explanation: string;
};

export type ResearchInstinctsCase = {
  id: string;
  title: string;
  kicker: string;
  brief: string;
  clues: readonly string[];
  questions: readonly ResearchInstinctsQuestion[];
};

export type ResearchInstinctsSelections = Record<ResearchInstinctsQuestionId, string[]>;
export type ResearchInstinctsDraftSelections = Partial<ResearchInstinctsSelections>;

export type ResearchInstinctsProgress = {
  version: typeof RESEARCH_INSTINCTS_PROGRESS_VERSION;
  activeCaseId: string;
  answers: Record<string, ResearchInstinctsDraftSelections>;
  completedCaseIds: string[];
};

export function isResearchInstinctsSelectionComplete(
  selected: readonly string[],
  pickCount: number
) {
  return (
    (selected.length === 1 && selected[0] === "not-sure") ||
    (selected.length === pickCount && !selected.includes("not-sure"))
  );
}

export function nextResearchInstinctsSelection(
  selected: readonly string[],
  optionId: string,
  pickCount: number
): string[] {
  if (pickCount === 1) return [optionId];

  if (optionId === "not-sure") {
    return selected.includes("not-sure") ? [] : ["not-sure"];
  }

  const current = selected.includes("not-sure") ? [] : [...selected];
  if (current.includes(optionId)) {
    return current.filter((selectedId) => selectedId !== optionId);
  }
  if (current.length >= pickCount) return current;
  return [...current, optionId];
}

export const researchInstinctsCases: readonly ResearchInstinctsCase[] = [
  {
    id: "mercer-march-identity",
    title: "Mercer or March?",
    kicker: "Identity",
    brief: "A fictional 1907 passenger list names Samuel March. A 1909 Lantern Bay marriage record names Samuel Mercer. Decide whether the records follow one man or two.",
    clues: [
      "The passenger list records Samuel March, age 21, traveling from Northstar Cove to Lantern Bay on 4 May 1907.",
      "The passenger-list signature and Samuel Mercer’s fictional 1909 marriage signature share the same unusually tall final stroke.",
      "A 1906 letter from Maeve Mercer says Samuel practiced signing both Mercer and March, without explaining why.",
      "The similar age and route make a useful lead, but neither characteristic identifies a person by itself."
    ],
    questions: [
      {
        id: "conclusion",
        prompt: "What is the best-supported working conclusion?",
        points: 40,
        pickCount: 1,
        options: [
          { id: "same-person", label: "Samuel Mercer and Samuel March are probably the same person." },
          { id: "different-people", label: "They must be two different people because the surnames differ." },
          { id: "not-sure", label: "I’m not sure yet." }
        ],
        answerOptionIds: ["same-person"],
        explanation: "The matching signatures and Maeve’s independent reference to both surnames support one working identity. Similar age and route help locate the records, but do not prove the conclusion. Treat it as strong, not absolute, until another independent record agrees."
      },
      {
        id: "evidence",
        prompt: "Which two clues do the most work?",
        points: 40,
        pickCount: 2,
        options: [
          { id: "signature-match", label: "The passenger-list and 1909 marriage signatures share an unusual final stroke." },
          { id: "maeve-letter", label: "Maeve’s 1906 letter says Samuel practiced signing both surnames." },
          { id: "age-conflict", label: "The passenger-list traveler is about the expected age." },
          { id: "route-wording", label: "Both records can be associated with the Northstar Cove–Lantern Bay route." },
          { id: "not-sure", label: "I’m not sure which clues matter most." }
        ],
        answerOptionIds: ["signature-match", "maeve-letter"],
        explanation: "The unusual signature feature is a distinctive identifier, and Maeve independently connects Samuel with both names. Age and route are useful search clues, but many travelers could share them."
      },
      {
        id: "caution",
        prompt: "What caution belongs in the research log?",
        points: 20,
        pickCount: 1,
        options: [
          { id: "corroborate-alias", label: "A surname variation is not proof by itself; seek another record that explicitly joins the names." },
          { id: "ignore-conflicts", label: "Once signatures match, age and route details no longer need to be recorded." },
          { id: "not-sure", label: "I’m not sure what to flag." }
        ],
        answerOptionIds: ["corroborate-alias"],
        explanation: "Identity work should preserve discrepancies and state the remaining uncertainty. A matching signature is powerful, but the alias conclusion still benefits from explicit corroboration."
      }
    ]
  },
  {
    id: "blue-tin-timeline",
    title: "Who assembled the blue tin?",
    kicker: "Provenance",
    brief: "Family lore credits Samuel, while Nora Hartwell’s journal calls it Amalia’s tin. Reconstruct the object’s timeline instead of voting on the stories.",
    clues: [
      "Samuel Mercer brought a folded 1907 passenger notice and the harbor photograph to Lantern Bay.",
      "A fictional 1984 inventory lists a brass key, the 1907 notice, a 1921 repair receipt, violet thread, and the photograph inside the blue tin.",
      "A 1922 margin note in Amalia Bellandi’s recipe notebook says, ‘Put Samuel’s papers in the blue tin with Nora’s photograph.’",
      "Nora Hartwell’s 1922 journal calls it ‘Amalia’s tin’ and separates the two items Samuel carried in 1907 from later keepsakes Amalia added."
    ],
    questions: [
      {
        id: "conclusion",
        prompt: "Which provenance statement best fits the evidence?",
        points: 40,
        pickCount: 1,
        options: [
          { id: "amalia-assembled", label: "Amalia assembled the collection in 1922 from items that included Samuel’s 1907 papers." },
          { id: "samuel-assembled", label: "Samuel assembled the finished tin in 1907." },
          { id: "nora-assembled", label: "Nora assembled the tin after inheriting it." },
          { id: "not-sure", label: "I’m not sure yet." }
        ],
        answerOptionIds: ["amalia-assembled"],
        explanation: "Samuel supplied two early items, but Amalia’s notebook and Nora’s journal place their assembly with later keepsakes in 1922. Contribution and assembly are different claims."
      },
      {
        id: "evidence",
        prompt: "Which two clues establish the assembly timeline?",
        points: 40,
        pickCount: 2,
        options: [
          { id: "inventory-grouping", label: "Amalia’s 1922 notebook says to put Samuel’s papers in the blue tin." },
          { id: "nora-labeling", label: "Nora’s 1922 journal distinguishes Samuel’s two older items from Amalia’s later keepsakes." },
          { id: "ferry-notice-date", label: "The passenger notice itself is dated 1907." },
          { id: "tin-color", label: "The 1984 inventory describes the container as a blue tin." },
          { id: "not-sure", label: "I’m not sure which clues matter most." }
        ],
        answerOptionIds: ["inventory-grouping", "nora-labeling"],
        explanation: "Amalia’s note describes putting the papers into the tin, while Nora independently separates Samuel’s older contributions from Amalia’s 1922 assembly. The 1907 notice dates one ingredient, not the finished collection."
      },
      {
        id: "caution",
        prompt: "What should a careful caption avoid?",
        points: 20,
        pickCount: 1,
        options: [
          { id: "separate-claims", label: "Do not confuse an item’s date with the date it entered the tin, or a contributor with the person who assembled the collection." },
          { id: "pick-favorite", label: "Choose the most repeated family version and omit the competing account." },
          { id: "not-sure", label: "I’m not sure what to flag." }
        ],
        answerOptionIds: ["separate-claims"],
        explanation: "Object provenance often contains several roles: creator, owner, contributor, organizer, and donor. A safe timeline records both the date of each item and the evidence for when it entered the container."
      }
    ]
  },
  {
    id: "harbor-photo",
    title: "Where and when was the harbor photograph taken?",
    kicker: "Photograph",
    brief: "Three figures stand at a harbor beneath a cropped ‘AR.’ A violet note appears on the back, but it is not contemporary with the image.",
    clues: [
      "The image shows three people, a striped awning, a lantern rack, and a partly obscured sign ending in ‘AR.’",
      "The autumn 1906 North Star Chandlery catalog from Northstar Cove shows the same stripe order, lantern rack, and surviving ‘STAR’ letters.",
      "The rack’s diamond inspection seal was issued only from September through November 1906 in Northstar Cove.",
      "Independent portrait comparisons are consistent with Maeve, Samuel, and Jonah, but image quality prevents a conclusive identification.",
      "The violet pencil stock dates after 1928 and the handwriting resembles Clara’s labels from the 1930s, making the note a later interpretation."
    ],
    questions: [
      {
        id: "conclusion",
        prompt: "What is the strongest current identification?",
        points: 40,
        pickCount: 1,
        options: [
          { id: "northstar-1906", label: "Probably Samuel, Maeve, and Jonah at Northstar Cove in autumn 1906." },
          { id: "lantern-bay-1930s", label: "Clara took the photograph in Lantern Bay during the 1930s." },
          { id: "ceraluna-1907", label: "The “AR” proves the photograph was taken in Ceraluna Alta in 1907." },
          { id: "not-sure", label: "I’m not sure yet." }
        ],
        answerOptionIds: ["northstar-1906"],
        explanation: "The chandlery details and inspection seal support Northstar Cove in autumn 1906. Portrait comparisons make Maeve, Samuel, and Jonah reasonable identifications, but the image cannot establish them conclusively."
      },
      {
        id: "evidence",
        prompt: "Which two clues best locate and date the image?",
        points: 40,
        pickCount: 2,
        options: [
          { id: "awning-directory", label: "The striped awning, lantern rack, and surviving ‘STAR’ letters match the North Star Chandlery catalog." },
          { id: "inspection-seal", label: "The diamond inspection seal was used in Northstar Cove only from September through November 1906." },
          { id: "violet-ink", label: "The later note is written in violet pencil." },
          { id: "portrait-comparison", label: "The figures resemble independently dated portraits of Maeve, Samuel, and Jonah." },
          { id: "not-sure", label: "I’m not sure which clues matter most." }
        ],
        answerOptionIds: ["awning-directory", "inspection-seal"],
        explanation: "The chandlery match supplies the place, and the bounded inspection-seal issue dates supply the season. Portrait resemblance informs identity, while the violet pencil dates the note rather than the photograph."
      },
      {
        id: "caution",
        prompt: "Which limitation must remain attached to the identification?",
        points: 20,
        pickCount: 1,
        options: [
          { id: "later-annotation", label: "The three people remain probable, not proven, and Clara’s later note cannot independently date or locate the photograph." },
          { id: "crop-is-complete", label: "The cropped letters should be treated as a complete place name." },
          { id: "not-sure", label: "I’m not sure what to flag." }
        ],
        answerOptionIds: ["later-annotation"],
        explanation: "Low-resolution resemblance remains uncertain. A later annotation is also a separate source with its own date, author, and access to family knowledge; it cannot be treated as a contemporary caption."
      }
    ]
  },
  {
    id: "two-malias",
    title: "Which Malia belongs to this branch?",
    kicker: "Family reconstruction",
    brief: "Two Ceraluna Alta index entries use the name Malia Bellandi. Rebuild their sibling groups before attaching either record.",
    clues: [
      "The fictional parish register records Rosa in 1859, Amalia Rose on 7 July 1861, and Ettore in 1864 to Luca Bellandi and Mira Solari.",
      "One 1868 household lists Rosa, 9; seven-year-old Malia; and Ettore, 4, preserving that sibling order.",
      "A second Malia, age 3, appears with different parents on another household page.",
      "An 1883 departure entry names Amalia Rose Bellandi, born 7 July 1861, and Rosa Bellandi as her local contact.",
      "The name index contains both girls but names neither set of parents."
    ],
    questions: [
      {
        id: "conclusion",
        prompt: "Who is the seven-year-old Malia in the 1868 household?",
        points: 40,
        pickCount: 1,
        options: [
          { id: "amalia-rose", label: "Amalia Rose Bellandi, daughter of Luca Bellandi and Mira Solari." },
          { id: "giacomo-daughter", label: "The three-year-old Malia in the other Bellandi household." },
          { id: "merge-both", label: "Both entries should be merged because Malia is a form of Amalia." },
          { id: "not-sure", label: "I’m not sure yet." }
        ],
        answerOptionIds: ["amalia-rose"],
        explanation: "Rosa, Malia, and Ettore match the independently reconstructed children of Luca Bellandi and Mira Solari in both age and sibling order. The other Malia belongs to different parents."
      },
      {
        id: "evidence",
        prompt: "Which two clues distinguish the girls?",
        points: 40,
        pickCount: 2,
        options: [
          { id: "school-siblings", label: "The 1868 household preserves the Rosa–Malia–Ettore sibling order and expected ages." },
          { id: "baptism-siblings", label: "The 1883 departure entry independently joins Amalia Rose’s full birth date to Rosa Bellandi." },
          { id: "same-surname", label: "Both girls use the Bellandi surname." },
          { id: "malia-variant", label: "Malia can be a familiar form of Amalia." },
          { id: "not-sure", label: "I’m not sure which clues matter most." }
        ],
        answerOptionIds: ["school-siblings", "baptism-siblings"],
        explanation: "The reconstructed sibling cluster is more discriminating than a shared surname or name variant. The departure entry independently links Amalia Rose’s full birth date to the older sister in that household."
      },
      {
        id: "caution",
        prompt: "What is the safest research practice here?",
        points: 20,
        pickCount: 1,
        options: [
          { id: "keep-separate", label: "Keep the two Malias separate; the name index alone cannot identify either child without household evidence." },
          { id: "merge-name", label: "Merge same-name people first and split them only if a contradiction appears." },
          { id: "not-sure", label: "I’m not sure what to flag." }
        ],
        answerOptionIds: ["keep-separate"],
        explanation: "Same-name records should not be merged on name and approximate age alone. Build each family group first and preserve unresolved identities."
      }
    ]
  },
  {
    id: "dna-clusters",
    title: "What do the DNA clusters actually support?",
    kicker: "DNA reasoning",
    brief: "Three wholly fictional DNA matches share useful amounts of DNA with the tester, but their trees and shared-match groups point toward different ancestral lines.",
    clues: [
      "M. Alder shares 86 cM and T. Pike shares 54 cM; they share each other and both carry Northstar Cove–Rowan clues.",
      "Northstar Cove records place Maeve Rowan Mercer and younger sister Elowen Rowan in the same parental household.",
      "Two documentary paths run from Elowen’s children toward the Alder and Pike trees, with one provisional parent-child link in each path.",
      "R. Solari shares 37 cM, does not join the Alder–Pike shared-match group, and supplies Bellandi and Ceraluna Alta clues but no usable tree.",
      "A separate documentary path traces the Solari profile toward Rosa Bellandi, Amalia’s sister.",
      "The 86 cM, 54 cM, and 37 cM totals each fit several relationships and cannot identify a branch by themselves."
    ],
    questions: [
      {
        id: "conclusion",
        prompt: "Which hypothesis should guide the next round of research?",
        points: 40,
        pickCount: 1,
        options: [
          { id: "two-clusters", label: "Treat M. Alder and T. Pike as an Elowen Rowan cluster, and investigate R. Solari separately through Bellandi records." },
          { id: "one-cluster", label: "Combine every match into one cluster because all share DNA with the tester." },
          { id: "highest-cm", label: "Assign every match to the ancestor suggested by the highest cM value." },
          { id: "not-sure", label: "I’m not sure yet." }
        ],
        answerOptionIds: ["two-clusters"],
        explanation: "Shared-match structure and provisional documentary paths support two lines of inquiry: M. Alder and T. Pike through Elowen Rowan, and R. Solari through Rosa Bellandi’s line. That is a research hypothesis, not proof of exact relationships."
      },
      {
        id: "evidence",
        prompt: "Which two clues justify separating the clusters?",
        points: 40,
        pickCount: 2,
        options: [
          { id: "alder-pike-shared", label: "M. Alder and T. Pike share each other, while the descendant chart points both paths toward Elowen Rowan." },
          { id: "solari-bellandi", label: "R. Solari sits outside that shared-match group, while separate records point toward Rosa Bellandi." },
          { id: "cm-rank", label: "One match has the largest cM total." },
          { id: "surname-hints", label: "The three cM totals all fall within overlapping cousin ranges." },
          { id: "not-sure", label: "I’m not sure which clues matter most." }
        ],
        answerOptionIds: ["alder-pike-shared", "solari-bellandi"],
        explanation: "The best cluster evidence combines genetic grouping with documentary paths. The remaining provisional links must stay labeled, and cM rank cannot supply a missing ancestor."
      },
      {
        id: "caution",
        prompt: "Which limitation belongs in every DNA hypothesis?",
        points: 20,
        pickCount: 1,
        options: [
          { id: "cm-not-identity", label: "A cM total cannot identify a branch on its own, and the provisional parent-child links still require independent confirmation." },
          { id: "tree-is-proof", label: "A match’s public tree can be treated as proof once its names fit the family." },
          { id: "not-sure", label: "I’m not sure what to flag." }
        ],
        answerOptionIds: ["cm-not-identity"],
        explanation: "DNA amounts are compatible with ranges of relationships. Shared matches and records narrow hypotheses, but each claimed path still needs documentary and genetic corroboration."
      }
    ]
  }
];

const questionIds: readonly ResearchInstinctsQuestionId[] = ["conclusion", "evidence", "caution"];

function caseById(caseId: string) {
  const challengeCase = researchInstinctsCases.find((candidate) => candidate.id === caseId);
  if (!challengeCase) throw new Error(`Unknown case: ${caseId}`);
  return challengeCase;
}

function validateSelections(challengeCase: ResearchInstinctsCase, selections: ResearchInstinctsSelections) {
  if (!selections || typeof selections !== "object" || Array.isArray(selections)) {
    throw new Error("Case selections must be an object");
  }

  for (const suppliedQuestionId of Object.keys(selections)) {
    if (!questionIds.includes(suppliedQuestionId as ResearchInstinctsQuestionId)) {
      throw new Error(`Unknown question: ${suppliedQuestionId}`);
    }
  }

  for (const question of challengeCase.questions) {
    const selected = selections[question.id];
    if (!Array.isArray(selected)) {
      throw new Error(`${question.id} must contain exactly ${question.pickCount} selection${question.pickCount === 1 ? "" : "s"}`);
    }
    if (selected.includes("not-sure") && (selected.length !== 1 || selected[0] !== "not-sure")) {
      throw new Error(`${question.id} must select not-sure alone`);
    }
    if (!isResearchInstinctsSelectionComplete(selected, question.pickCount)) {
      throw new Error(`${question.id} must contain exactly ${question.pickCount} selection${question.pickCount === 1 ? "" : "s"}, or not-sure alone`);
    }
    if (new Set(selected).size !== selected.length) {
      throw new Error(`${question.id} selections must be unique`);
    }

    const validOptionIds = new Set(question.options.map((option) => option.id));
    if (selected.some((optionId) => !validOptionIds.has(optionId))) {
      throw new Error(`${question.id} contains an unknown option`);
    }
  }
}

export function scoreResearchInstinctsCase(caseId: string, selections: ResearchInstinctsSelections) {
  const challengeCase = caseById(caseId);
  validateSelections(challengeCase, selections);

  const scores = { conclusion: 0, evidence: 0, caution: 0 } satisfies Record<ResearchInstinctsQuestionId, number>;
  for (const question of challengeCase.questions) {
    const selected = selections[question.id];
    if (selected.includes("not-sure")) continue;

    const correctCount = selected.filter((optionId) => question.answerOptionIds.includes(optionId)).length;
    scores[question.id] = (question.points / question.pickCount) * correctCount;
  }

  return {
    caseId,
    scores,
    total: scores.conclusion + scores.evidence + scores.caution,
    maximum: 100
  };
}

export function scoreResearchInstinctsChallenge(answers: Record<string, ResearchInstinctsSelections>) {
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
    throw new Error("Challenge answers must be an object");
  }

  for (const suppliedCaseId of Object.keys(answers)) {
    caseById(suppliedCaseId);
  }

  const caseScores = researchInstinctsCases.map((challengeCase) => {
    const selections = answers[challengeCase.id];
    if (!selections) throw new Error(`Missing answers for case: ${challengeCase.id}`);
    return scoreResearchInstinctsCase(challengeCase.id, selections);
  });

  return {
    caseScores,
    total: caseScores.reduce((sum, score) => sum + score.total, 0),
    maximum: researchInstinctsCases.length * 100
  };
}

export function createEmptyResearchInstinctsProgress(): ResearchInstinctsProgress {
  return {
    version: RESEARCH_INSTINCTS_PROGRESS_VERSION,
    activeCaseId: researchInstinctsCases[0].id,
    answers: {},
    completedCaseIds: []
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sanitizeCaseSelections(
  challengeCase: ResearchInstinctsCase,
  rawSelections: unknown
): ResearchInstinctsDraftSelections | null {
  if (!isObject(rawSelections)) return null;

  const sanitized: ResearchInstinctsDraftSelections = {};
  for (const question of challengeCase.questions) {
    const rawSelected = rawSelections[question.id];
    if (!Array.isArray(rawSelected)) continue;

    const validOptionIds = new Set(question.options.map((option) => option.id));
    const validSelected = [...new Set(rawSelected.filter((optionId): optionId is string =>
      typeof optionId === "string" && validOptionIds.has(optionId)
    ))];
    const selected = validSelected.includes("not-sure")
      ? ["not-sure"]
      : validSelected.slice(0, question.pickCount);
    if (selected.length > 0) sanitized[question.id] = selected;
  }

  return Object.keys(sanitized).length > 0 ? sanitized : null;
}

function hasCompleteSelections(
  challengeCase: ResearchInstinctsCase,
  selections: ResearchInstinctsDraftSelections | undefined
): selections is ResearchInstinctsSelections {
  if (!selections) return false;
  return challengeCase.questions.every(
    (question) => isResearchInstinctsSelectionComplete(selections[question.id] ?? [], question.pickCount)
  );
}

export function sanitizeResearchInstinctsProgress(rawProgress: unknown): ResearchInstinctsProgress {
  const empty = createEmptyResearchInstinctsProgress();
  if (!isObject(rawProgress) || rawProgress.version !== RESEARCH_INSTINCTS_PROGRESS_VERSION) return empty;
  if (!isObject(rawProgress.answers)) return empty;

  const knownCaseIds = new Set(researchInstinctsCases.map((challengeCase) => challengeCase.id));
  const activeCaseId = typeof rawProgress.activeCaseId === "string" && knownCaseIds.has(rawProgress.activeCaseId)
    ? rawProgress.activeCaseId
    : empty.activeCaseId;
  const answers: Record<string, ResearchInstinctsDraftSelections> = {};

  for (const challengeCase of researchInstinctsCases) {
    const sanitized = sanitizeCaseSelections(challengeCase, rawProgress.answers[challengeCase.id]);
    if (sanitized) answers[challengeCase.id] = sanitized;
  }

  const completedCaseIds: string[] = [];
  if (Array.isArray(rawProgress.completedCaseIds)) {
    for (const rawCaseId of rawProgress.completedCaseIds) {
      if (typeof rawCaseId !== "string" || completedCaseIds.includes(rawCaseId)) continue;
      const challengeCase = researchInstinctsCases.find((candidate) => candidate.id === rawCaseId);
      if (challengeCase && hasCompleteSelections(challengeCase, answers[rawCaseId])) {
        completedCaseIds.push(rawCaseId);
      }
    }
  }

  return {
    version: RESEARCH_INSTINCTS_PROGRESS_VERSION,
    activeCaseId,
    answers,
    completedCaseIds
  };
}

export function resetResearchInstinctsProgress(storage: Pick<Storage, "removeItem">) {
  storage.removeItem(RESEARCH_INSTINCTS_STORAGE_KEY);
}
