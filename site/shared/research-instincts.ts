import { blueTinTimelineCase, harborPhotoCase } from "./research-instincts-archive-cases-08-09";
import { dnaClustersCase, twoMaliasCase } from "./research-instincts-archive-cases-10-11";

export const RESEARCH_INSTINCTS_PROGRESS_VERSION = 3 as const;
export const RESEARCH_INSTINCTS_STORAGE_KEY = "kinresolve:research-instincts:v3";

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

export type ResearchInstinctsTableTranscript = {
  kind: "table";
  columns: readonly string[];
  rows: readonly (readonly string[])[];
};

export type ResearchInstinctsLetterTranscript = {
  kind: "letter";
  paragraphs: readonly string[];
};

export type ResearchInstinctsRecord = {
  id: string;
  catalogId: string;
  title: string;
  kind: string;
  date: string;
  image: {
    src: string;
    alt: string;
    width: number;
    height: number;
  };
  metadata: readonly {
    label: string;
    value: string;
  }[];
  transcript: ResearchInstinctsTableTranscript | ResearchInstinctsLetterTranscript;
  clueIds: readonly string[];
};

export type ResearchInstinctsNotebookClue = {
  id: string;
  label: string;
  recordIds: readonly string[];
};

export type ResearchInstinctsCase = {
  id: string;
  title: string;
  kicker: string;
  skill: string;
  brief: string;
  clues: readonly string[];
  records?: readonly ResearchInstinctsRecord[];
  notebookClues?: readonly ResearchInstinctsNotebookClue[];
  questions: readonly ResearchInstinctsQuestion[];
};

export type ResearchInstinctsSelections = Record<ResearchInstinctsQuestionId, string[]>;
export type ResearchInstinctsDraftSelections = Partial<ResearchInstinctsSelections>;

export type ResearchInstinctsRecordDeskProgress = {
  activeRecordId: string;
  reviewedRecordIds: string[];
  notebookClueIds: string[];
};

export type ResearchInstinctsProgress = {
  version: typeof RESEARCH_INSTINCTS_PROGRESS_VERSION;
  activeCaseId: string;
  answers: Record<string, ResearchInstinctsDraftSelections>;
  completedCaseIds: string[];
  recordDesk: Record<string, ResearchInstinctsRecordDeskProgress>;
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

const mercerMarchRecords: readonly ResearchInstinctsRecord[] = [
  {
    id: "northstar-household-1901",
    catalogId: "KR-DEMO-C07-R1",
    title: "1901 Northstar Cove household schedule",
    kind: "Household schedule",
    date: "1901",
    image: {
      src: "/assets/challenge/kr-demo-c07-r1-household-schedule.webp",
      alt: "Fictional 1901 household schedule listing Jonah, Maeve, and Samuel Mercer",
      width: 1536,
      height: 1024
    },
    metadata: [
      { label: "Creator", value: "Northstar Cove enumerator" },
      { label: "Informant", value: "Not recorded" },
      { label: "Record type", value: "Clerk-created household schedule" },
      { label: "Research limit", value: "Establishes the Mercer household, but does not mention March." }
    ],
    transcript: {
      kind: "table",
      columns: ["Name", "Relation", "Born", "Age", "Occupation"],
      rows: [
        ["Jonah S. Mercer", "Head", "9 Jan 1859", "42", "Harbor signal keeper"],
        ["Maeve L. Mercer", "Wife", "6 May 1863", "37", "—"],
        ["Samuel R. Mercer", "Son", "18 Feb 1886", "15", "Apprentice, lantern works"]
      ]
    },
    clueIds: ["baseline-mercer-identity", "rare-lantern-trade"]
  },
  {
    id: "maeve-letter-1906",
    catalogId: "KR-DEMO-C07-R2",
    title: "Maeve Mercer’s 1906 letter",
    kind: "Family correspondence",
    date: "14 Nov 1906",
    image: {
      src: "/assets/challenge/kr-demo-c07-r2-maeve-letter.webp",
      alt: "Fictional handwritten letter from Maeve mentioning Mercer and March",
      width: 1024,
      height: 1536
    },
    metadata: [
      { label: "Creator", value: "Maeve Lenora Rowan Mercer" },
      { label: "Recipient", value: "Elowen Rowan" },
      { label: "Record type", value: "Private family letter" },
      { label: "Research limit", value: "Maeve reports what she observed, but gives no reason for the two names." }
    ],
    transcript: {
      kind: "letter",
      paragraphs: [
        "Northstar Cove · 14 November 1906",
        "Dear Elowen,",
        "Samuel practices his hand after supper—‘Mercer,’ then ‘March,’ again and again. Jonah asked what business he has with two names. Samuel folded the paper and would not answer. He speaks still of going west before spring.",
        "Your loving sister, Maeve"
      ]
    },
    clueIds: ["both-surnames-before-departure"]
  },
  {
    id: "northstar-departure-1907",
    catalogId: "KR-DEMO-C07-R3",
    title: "Northstar Cove departure ledger",
    kind: "Harbor ledger",
    date: "1 May 1907",
    image: {
      src: "/assets/challenge/kr-demo-c07-r3-departure-ledger.webp",
      alt: "Fictional harbor ledger with water damage obscuring a traveler’s surname",
      width: 1536,
      height: 1024
    },
    metadata: [
      { label: "Creator", value: "Northstar Cove harbor clerk" },
      { label: "Informant", value: "Unknown" },
      { label: "Record type", value: "Bound departure ledger" },
      { label: "Research limit", value: "Water loss hides most of the surname and part of the destination." }
    ],
    transcript: {
      kind: "table",
      columns: ["Date", "Certificate", "Traveler", "Age", "Trade", "Destination", "Baggage"],
      rows: [
        ["24 Apr", "367", "A. Pritchard", "32", "Cooper", "Greyhaven", "Two crates"],
        ["26 Apr", "372", "N. Whitmore", "27", "Seamstress", "Whitecap Point", "One valise"],
        ["1 May", "418", "S. M[—]", "21", "Lamp mechanic", "Lantern B[—]", "One trunk"],
        ["3 May", "426", "C. Calder", "45", "Ship’s cook", "Saltedge", "One chest"]
      ]
    },
    clueIds: ["certificate-418-continuity", "rare-lantern-trade", "damaged-surname"]
  },
  {
    id: "lantern-passenger-declaration-1907",
    catalogId: "KR-DEMO-C07-R4",
    title: "Lantern Packet passenger declaration",
    kind: "Passenger declaration",
    date: "4 May 1907",
    image: {
      src: "/assets/challenge/kr-demo-c07-r4-passenger-declaration.webp",
      alt: "Fictional passenger declaration signed Samuel March",
      width: 1536,
      height: 1024
    },
    metadata: [
      { label: "Creator", value: "Lantern Packet Company; signed by the traveler" },
      { label: "Route", value: "Northstar Cove to Lantern Bay" },
      { label: "Record type", value: "Passenger declaration" },
      { label: "Research limit", value: "Most particulars are self-reported; parents and a middle name are absent." }
    ],
    transcript: {
      kind: "table",
      columns: ["Field", "Entry"],
      rows: [
        ["Certificate", "418"],
        ["Name", "March, Samuel"],
        ["Age", "21"],
        ["Condition", "Single"],
        ["Occupation", "Lamp repairer"],
        ["Birthplace", "Northstar Cove, N.S."],
        ["Destination contact", "E. T. Hartwell, 14 Dock Street"],
        ["Signature", "Samuel March"]
      ]
    },
    clueIds: ["certificate-418-continuity", "rare-lantern-trade", "hartwell-associate", "signature-features"]
  },
  {
    id: "lantern-directory-1908",
    catalogId: "KR-DEMO-C07-R5",
    title: "1908–1909 Lantern Bay city directory",
    kind: "City directory",
    date: "1908–1909",
    image: {
      src: "/assets/challenge/kr-demo-c07-r5-city-directory.webp",
      alt: "Fictional city directory listing Samuel March and Samuel Mercer at 14 Dock",
      width: 1024,
      height: 1536
    },
    metadata: [
      { label: "Creator", value: "Lantern Bay Directory Company" },
      { label: "Informant", value: "Door-to-door canvass; exact dates unknown" },
      { label: "Record type", value: "Derivative commercial directory" },
      { label: "Research limit", value: "The two entries may describe two men, a duplicate canvass, or an alternate name." }
    ],
    transcript: {
      kind: "table",
      columns: ["Name", "Listing"],
      rows: [
        ["Alden, Cyrus", "carter, r 8 Mill"],
        ["Bellamy, Ira F.", "grocer, r 23 Union"],
        ["Clarke, Edith L.", "dressmkr., r 7 Pine"],
        ["Dover, J. H.", "clk., r 31 Water"],
        ["March, Samuel", "lab., bds 14 Dock"],
        ["Mercer, Samuel R.", "lamp repr., r 14 Dock"],
        ["Paine, Oscar", "tailor, r 19 Cedar"],
        ["Vaughn, Lottie", "milliner, r 12 Church"]
      ]
    },
    clueIds: ["directory-conflict"]
  },
  {
    id: "lantern-marriage-1909",
    catalogId: "KR-DEMO-C07-R6",
    title: "1909 Lantern Bay marriage ledger",
    kind: "Marriage ledger",
    date: "19 Oct 1909",
    image: {
      src: "/assets/challenge/kr-demo-c07-r6-marriage-ledger.webp",
      alt: "Fictional marriage ledger for Samuel Mercer and Nora Hartwell",
      width: 1536,
      height: 1024
    },
    metadata: [
      { label: "Creator", value: "Lantern Bay civil clerk; signed by bride and groom" },
      { label: "Informants", value: "Samuel Rowan Mercer and Nora Elise Hartwell" },
      { label: "Record type", value: "Civil marriage ledger" },
      { label: "Research limit", value: "Later and partly self-reported; it never explicitly says ‘also known as March.’" }
    ],
    transcript: {
      kind: "table",
      columns: ["Field", "Entry"],
      rows: [
        ["Date", "19 Oct 1909"],
        ["Groom", "Samuel Rowan Mercer, age 23"],
        ["Occupation", "Lantern repairer"],
        ["Born", "Northstar Cove, Nova Scotia"],
        ["Parents", "Jonah Silas Mercer and Maeve Lenora Rowan"],
        ["Bride", "Nora Elise Hartwell, age 20"],
        ["Witness", "Elias T. Hartwell"],
        ["Groom signature", "Samuel R. Mercer"],
        ["Bride signature", "Nora E. Hartwell"]
      ]
    },
    clueIds: ["baseline-mercer-identity", "rare-lantern-trade", "hartwell-associate", "signature-features"]
  }
];

const mercerMarchNotebookClues: readonly ResearchInstinctsNotebookClue[] = [
  {
    id: "baseline-mercer-identity",
    label: "The 1901 household and 1909 marriage ledger agree on Samuel’s birth, parents, and Northstar Cove identity.",
    recordIds: ["northstar-household-1901", "lantern-marriage-1909"]
  },
  {
    id: "both-surnames-before-departure",
    label: "Maeve independently saw Samuel practice both ‘Mercer’ and ‘March’ before he left Northstar Cove.",
    recordIds: ["maeve-letter-1906"]
  },
  {
    id: "certificate-418-continuity",
    label: "Certificate 418 links the damaged Northstar departure entry to Samuel March’s Lantern Bay declaration.",
    recordIds: ["northstar-departure-1907", "lantern-passenger-declaration-1907"]
  },
  {
    id: "rare-lantern-trade",
    label: "Lantern work follows Samuel from his 1901 apprenticeship through the 1907 and 1909 records.",
    recordIds: [
      "northstar-household-1901",
      "northstar-departure-1907",
      "lantern-passenger-declaration-1907",
      "lantern-marriage-1909"
    ]
  },
  {
    id: "hartwell-associate",
    label: "Elias Hartwell is the 1907 destination contact and the 1909 marriage witness.",
    recordIds: ["lantern-passenger-declaration-1907", "lantern-marriage-1909"]
  },
  {
    id: "signature-features",
    label: "The two Samuel signatures share a flattened capital S and an unusually tall final stroke, with small differences preserved.",
    recordIds: ["lantern-passenger-declaration-1907", "lantern-marriage-1909"]
  },
  {
    id: "directory-conflict",
    label: "The directory prints March and Mercer as two entries at 14 Dock; it could be duplication, an alias, or two men.",
    recordIds: ["lantern-directory-1908"]
  },
  {
    id: "damaged-surname",
    label: "Water damage leaves the Northstar surname unreadable beyond ‘M,’ so that ledger cannot settle Mercer versus March.",
    recordIds: ["northstar-departure-1907"]
  }
];

const mercerMarchCase: ResearchInstinctsCase =
  {
    id: "mercer-march-identity",
    title: "Mercer or March? The man who signed twice",
    kicker: "Identity",
    skill: "Identity correlation across independent records",
    brief: "Six fictional records follow a lamp worker from Northstar Cove to Lantern Bay. One names Samuel March; another names Samuel Mercer. Work the documents, preserve the conflict, and decide whether they follow one man or two.",
    clues: [
      "The passenger declaration records Samuel March, age 21, traveling from Northstar Cove to Lantern Bay on 4 May 1907.",
      "The passenger-declaration signature and Samuel Mercer’s fictional 1909 marriage signature share the same unusually tall final stroke.",
      "A 1906 letter from Maeve Mercer says Samuel practiced signing both Mercer and March, without explaining why.",
      "The similar age and route make a useful lead, but neither characteristic identifies a person by itself."
    ],
    records: mercerMarchRecords,
    notebookClues: mercerMarchNotebookClues,
    questions: [
      {
        id: "conclusion",
        prompt: "What is the best-supported working conclusion?",
        points: 40,
        pickCount: 1,
        options: [
          { id: "different-people", label: "The records are more consistent with two closely connected men at 14 Dock than with one man using two surnames." },
          { id: "same-person", label: "The records strongly support one man using Mercer and March, although the reason for the second surname remains unresolved." },
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
          { id: "signature-match", label: "The self-signed passenger and marriage records share a distinctive flattened S and unusually tall final stroke." },
          { id: "age-conflict", label: "The 1907 and 1909 ages fit the same birth year once the reporting dates are considered." },
          { id: "route-wording", label: "Certificate 418 and the Northstar–Lantern route connect the two 1907 migration entries to one journey." },
          { id: "maeve-letter", label: "Maeve’s pre-departure letter independently places both surnames in Samuel’s own handwriting." },
          { id: "not-sure", label: "I’m not sure which clues matter most." }
        ],
        answerOptionIds: ["signature-match", "maeve-letter"],
        explanation: "The unusual signature feature is a distinctive identifier, and Maeve independently connects Samuel with both names. Age and route are useful search clues, but many travelers could share them."
      },
      {
        id: "caution",
        prompt: "Which statement best separates identity from alias status?",
        points: 20,
        pickCount: 1,
        options: [
          { id: "ignore-conflicts", label: "The matching signatures and Maeve’s letter settle both identity and alias status; only the directory duplication and canvass timing remain unresolved." },
          { id: "corroborate-alias", label: "The records strongly support one identity, but they do not establish March’s legal status or explain when and why Samuel used it." },
          { id: "not-sure", label: "I’m not sure what to flag." }
        ],
        answerOptionIds: ["corroborate-alias"],
        explanation: "Identity evidence can support one person without establishing the legal or social status of March. Preserve the directory duplication and keep when, why, and under what authority Samuel used the surname open."
      }
    ]
  };

export const researchInstinctsCases: readonly ResearchInstinctsCase[] = [
  mercerMarchCase,
  blueTinTimelineCase,
  harborPhotoCase,
  twoMaliasCase,
  dnaClustersCase
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
  const firstCase = researchInstinctsCases[0];
  const recordDesk = Object.fromEntries(
    researchInstinctsCases.flatMap((challengeCase) => {
      const firstRecord = challengeCase.records?.[0];
      return firstRecord
        ? [[challengeCase.id, {
            activeRecordId: firstRecord.id,
            reviewedRecordIds: [firstRecord.id],
            notebookClueIds: []
          }]]
        : [];
    })
  );

  return {
    version: RESEARCH_INSTINCTS_PROGRESS_VERSION,
    activeCaseId: firstCase.id,
    answers: {},
    completedCaseIds: [],
    recordDesk
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

function sanitizeRecordDesk(
  rawRecordDesk: unknown,
  defaults: Record<string, ResearchInstinctsRecordDeskProgress>
): Record<string, ResearchInstinctsRecordDeskProgress> {
  const sanitized: Record<string, ResearchInstinctsRecordDeskProgress> = {};
  const rawByCase = isObject(rawRecordDesk) ? rawRecordDesk : {};

  for (const challengeCase of researchInstinctsCases) {
    const records = challengeCase.records ?? [];
    if (records.length === 0) continue;

    const defaultDesk = defaults[challengeCase.id] ?? {
      activeRecordId: records[0].id,
      reviewedRecordIds: [records[0].id],
      notebookClueIds: []
    };
    const rawDesk = rawByCase[challengeCase.id];
    if (!isObject(rawDesk)) {
      sanitized[challengeCase.id] = defaultDesk;
      continue;
    }

    const validRecordIds = new Set(records.map((record) => record.id));
    const validClueIds = new Set((challengeCase.notebookClues ?? []).map((clue) => clue.id));
    const activeRecordId = typeof rawDesk.activeRecordId === "string" && validRecordIds.has(rawDesk.activeRecordId)
      ? rawDesk.activeRecordId
      : defaultDesk.activeRecordId;
    const reviewedRecordIds = Array.isArray(rawDesk.reviewedRecordIds)
      ? [...new Set(rawDesk.reviewedRecordIds.filter(
          (recordId): recordId is string => typeof recordId === "string" && validRecordIds.has(recordId)
        ))]
      : [...defaultDesk.reviewedRecordIds];
    if (!reviewedRecordIds.includes(activeRecordId)) reviewedRecordIds.unshift(activeRecordId);
    const notebookClueIds = Array.isArray(rawDesk.notebookClueIds)
      ? [...new Set(rawDesk.notebookClueIds.filter(
          (clueId): clueId is string => typeof clueId === "string" && validClueIds.has(clueId)
        ))]
      : [...defaultDesk.notebookClueIds];

    sanitized[challengeCase.id] = { activeRecordId, reviewedRecordIds, notebookClueIds };
  }

  return sanitized;
}

function hasCompleteRecordDesk(
  challengeCase: ResearchInstinctsCase,
  desk: ResearchInstinctsRecordDeskProgress | undefined
) {
  const records = challengeCase.records ?? [];
  if (records.length === 0) return true;
  return Boolean(
    desk &&
    records.every((record) => desk.reviewedRecordIds.includes(record.id)) &&
    desk.notebookClueIds.length >= 2
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

  const recordDesk = sanitizeRecordDesk(rawProgress.recordDesk, empty.recordDesk);

  const completedCaseIds: string[] = [];
  if (Array.isArray(rawProgress.completedCaseIds)) {
    for (const rawCaseId of rawProgress.completedCaseIds) {
      if (typeof rawCaseId !== "string" || completedCaseIds.includes(rawCaseId)) continue;
      const challengeCase = researchInstinctsCases.find((candidate) => candidate.id === rawCaseId);
      if (
        challengeCase &&
        hasCompleteSelections(challengeCase, answers[rawCaseId]) &&
        hasCompleteRecordDesk(challengeCase, recordDesk[rawCaseId])
      ) {
        completedCaseIds.push(rawCaseId);
      }
    }
  }

  return {
    version: RESEARCH_INSTINCTS_PROGRESS_VERSION,
    activeCaseId,
    answers,
    completedCaseIds,
    recordDesk
  };
}

export function resetResearchInstinctsProgress(storage: Pick<Storage, "removeItem">) {
  storage.removeItem(RESEARCH_INSTINCTS_STORAGE_KEY);
}
