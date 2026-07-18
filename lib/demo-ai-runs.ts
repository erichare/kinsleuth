import type { AIAnalysisRun } from "./models";

export const demoAiRuns = [
  {
    id: "demo-seeded-ai-mercer-march",
    question: "Does the record set currently support treating Samuel March as Samuel Rowan Mercer?",
    answer:
      "The shared age, route, trade, address, and signature features make one person the stronger working explanation. The 1908–1909 directory still prints Samuel March and Samuel R. Mercer as separate entries at the same address, so the identity should remain a hypothesis rather than a merged conclusion.",
    status: "ready",
    evidenceUsed: [
      "1901 Northstar Cove household schedule naming Samuel R. Mercer",
      "1907 passenger list naming Samuel March",
      "1908–1909 Lantern Bay directory with two same-address entries",
      "1909 marriage signature comparison"
    ],
    uncertainty: [
      "The damaged departure entry does not preserve a complete surname.",
      "A shared address can indicate one person recorded twice, but it can also indicate two boarders or a directory carryover.",
      "The signature resemblance is suggestive and has not been independently authenticated."
    ],
    anomalyCount: 2,
    suggestions: [
      {
        id: "demo-suggestion-mercer-march-lodging-register",
        type: "source_gap",
        title: "Check the 14 Dock Street lodging register",
        summary: "Look for a dated household or rent record that could distinguish a duplicate directory entry from two residents.",
        linkedCaseId: "case-mercer-march-identity",
        contextRefs: [
          "case-mercer-march-identity",
          "p-samuel-mercer",
          "ev-fictional-lantern-directory"
        ],
        confidence: 0.78
      }
    ],
    contextReferences: [
      {
        id: "p-samuel-mercer",
        type: "person",
        label: "Samuel Rowan Mercer",
        summary: "Also recorded as Samuel March in the fictional 1907 passenger list."
      },
      {
        id: "case-mercer-march-identity",
        type: "case",
        label: "The Mercer–March passenger mystery"
      },
      {
        id: "ev-fictional-passenger-list",
        type: "evidence",
        label: "Fictional 1907 passenger list"
      },
      {
        id: "ev-fictional-lantern-directory",
        type: "evidence",
        label: "Fictional 1908–1909 Lantern Bay directory"
      },
      {
        id: "ev-fictional-marriage-signature",
        type: "evidence",
        label: "Fictional 1909 marriage signature"
      }
    ],
    providerStatus: "not_configured",
    linkedCaseId: "case-mercer-march-identity",
    createdAt: "2026-06-12T16:20:00.000Z",
    completedAt: "2026-06-12T16:20:00.000Z"
  },
  {
    id: "demo-seeded-ai-amalia-malia",
    question: "Are the Amalia and Malia Bellandi records describing the same fictional woman?",
    answer:
      "The sibling order, exact 7 July 1861 birth date, permit and ticket number 612, and the 1885 application signed “Malia Bellandi” form a strong chain from Amalia Rose to the familiar name Malia. The second younger Malia in the 1868 household pages prevents name matching alone from resolving the identity.",
    status: "ready",
    evidenceUsed: [
      "Ceraluna Alta sibling register naming Amalia Rose",
      "1868 household pages containing two Malia Bellandi entries",
      "1883 departure permit and passenger ledger numbered 612",
      "1885 marriage application printed Amalia and signed Malia"
    ],
    uncertainty: [
      "The passenger ledger reports age 22, while the documented birth date implies age 21.",
      "The derivative name index omits parents and cannot distinguish the two Malia candidates.",
      "The permit-to-ticket link is strong but still requires checking that number 612 was unique in both series."
    ],
    anomalyCount: 2,
    suggestions: [
      {
        id: "demo-suggestion-amalia-ticket-sequence",
        type: "evidence_check",
        title: "Audit the permit and ticket sequences",
        summary: "Verify whether 612 is a unique cross-reference and document how the clerk calculated the passenger's age.",
        linkedCaseId: "case-bellandi-ceraluna-alta",
        contextRefs: [
          "case-bellandi-ceraluna-alta",
          "p-amalia-bellandi",
          "ev-fictional-malia-passenger-ledger",
          "ev-fictional-amalia-marriage-application"
        ],
        confidence: 0.81
      }
    ],
    contextReferences: [
      {
        id: "p-amalia-bellandi",
        type: "person",
        label: "Amalia Rose Bellandi",
        summary: "Recorded as Malia in the household, passenger, and signature evidence."
      },
      {
        id: "case-bellandi-ceraluna-alta",
        type: "case",
        label: "Amalia Bellandi's Ceraluna Alta origins"
      },
      {
        id: "ev-fictional-bellandi-household-list",
        type: "evidence",
        label: "Fictional 1868 Ceraluna Alta household pages"
      },
      {
        id: "ev-fictional-malia-passenger-ledger",
        type: "evidence",
        label: "Fictional 1883 Ceraluna–Lantern passenger ledger"
      },
      {
        id: "ev-fictional-amalia-marriage-application",
        type: "evidence",
        label: "Fictional 1885 Lantern Bay marriage application"
      }
    ],
    providerStatus: "not_configured",
    linkedCaseId: "case-bellandi-ceraluna-alta",
    createdAt: "2026-06-13T15:05:00.000Z",
    completedAt: "2026-06-13T15:05:00.000Z"
  },
  {
    id: "demo-seeded-ai-harbor-photo",
    question: "What does Clara's violet caption change about the harbor photograph mystery?",
    answer:
      "The violet writing should be treated as a later family interpretation, not a contemporary caption. Its post-1928 pencil stock and similarities to Clara's 1930s handwriting explain who may have labeled the image, while the 1906 awning and inspection-seal evidence still favors Northstar Cove and leaves the three people only provisionally identified.",
    status: "ready",
    evidenceUsed: [
      "Undated fictional harbor photograph and violet-pencil verso",
      "1906 North Star Chandlery catalog",
      "1906 Northstar Cove lantern inspection-seal register",
      "Violet-pencil and Clara handwriting comparison study"
    ],
    uncertainty: [
      "The handwriting comparison is feature-based and not a definitive authorship finding.",
      "Clara could have copied an earlier oral account rather than identified the scene herself.",
      "Low image resolution prevents conclusive facial identification."
    ],
    anomalyCount: 1,
    suggestions: [
      {
        id: "demo-suggestion-photo-envelope",
        type: "source_gap",
        title: "Search for an original envelope or duplicate print",
        summary: "An independent contemporary caption would test both Clara's later interpretation and the provisional Northstar Cove identification.",
        linkedCaseId: "case-harbor-photograph",
        contextRefs: [
          "case-harbor-photograph",
          "p-clara-mercer",
          "ev-fictional-photo-verso",
          "ev-fictional-violet-pencil-study"
        ],
        confidence: 0.84
      }
    ],
    contextReferences: [
      {
        id: "p-clara-mercer",
        type: "person",
        label: "Clara Juniper Mercer",
        summary: "Probable later annotator of the fictional photograph."
      },
      {
        id: "case-harbor-photograph",
        type: "case",
        label: "Who is in the harbor photograph?"
      },
      {
        id: "ev-fictional-photo-verso",
        type: "evidence",
        label: "Fictional photograph verso"
      },
      {
        id: "ev-fictional-violet-pencil-study",
        type: "evidence",
        label: "Fictional violet-pencil and handwriting study"
      },
      {
        id: "ev-fictional-lantern-inspection-seal",
        type: "evidence",
        label: "Fictional 1906 lantern inspection seal register"
      }
    ],
    providerStatus: "not_configured",
    linkedCaseId: "case-harbor-photograph",
    createdAt: "2026-06-14T14:40:00.000Z",
    completedAt: "2026-06-14T14:40:00.000Z"
  },
  {
    id: "demo-seeded-ai-blue-tin",
    question: "Who most likely assembled the surviving blue-tin collection, and when?",
    answer:
      "The box and its surviving contents cannot have traveled together in 1907: the tin design and repair receipt date to 1921. Amalia is the best-supported assembler in 1922 because her notebook describes placing Samuel's older papers with Nora's photograph, and Nora independently calls it “Amalia's tin.” Later additions listed in 1984 should remain attributed only to the collection, not automatically to Amalia.",
    status: "ready",
    evidenceUsed: [
      "1907 passenger notice retained among the contents",
      "1921 repair receipt and blue-tin trade circular",
      "1922 Amalia Bellandi notebook margin note",
      "1922 Nora Hartwell journal entry",
      "1984 Tobias Mercer inventory"
    ],
    uncertainty: [
      "The notebook and journal describe assembly but do not inventory every surviving object.",
      "Fold patterns show that papers were stored together, not exactly when each item entered the tin.",
      "The brass key and violet thread still lack a documented contributor."
    ],
    anomalyCount: 1,
    suggestions: [
      {
        id: "demo-suggestion-blue-tin-item-provenance",
        type: "evidence_check",
        title: "Separate the provenance of each object",
        summary: "Track manufacture date, first family mention, and first confirmed appearance in the tin as three different fields.",
        linkedCaseId: "case-blue-tin",
        contextRefs: [
          "case-blue-tin",
          "p-nora-hartwell",
          "ev-fictional-amalia-notebook",
          "ev-fictional-nora-journal",
          "ev-fictional-blue-tin-inventory"
        ],
        confidence: 0.9
      }
    ],
    contextReferences: [
      {
        id: "p-nora-hartwell",
        type: "person",
        label: "Nora Elise Hartwell",
        summary: "Her 1922 journal distinguishes Samuel's older papers from Amalia's assembly of the tin."
      },
      {
        id: "case-blue-tin",
        type: "case",
        label: "What belonged in the blue tin?"
      },
      {
        id: "ev-fictional-blue-tin-circular",
        type: "evidence",
        label: "Fictional 1921 blue-tin trade circular"
      },
      {
        id: "ev-fictional-amalia-notebook",
        type: "evidence",
        label: "Fictional Amalia Bellandi recipe notebook"
      },
      {
        id: "ev-fictional-nora-journal",
        type: "evidence",
        label: "Fictional 1922 journal entry by Nora Hartwell"
      },
      {
        id: "ev-fictional-blue-tin-inventory",
        type: "evidence",
        label: "Fictional 1984 blue-tin inventory"
      }
    ],
    providerStatus: "not_configured",
    linkedCaseId: "case-blue-tin",
    createdAt: "2026-06-15T17:10:00.000Z",
    completedAt: "2026-06-15T17:10:00.000Z"
  }
] satisfies readonly AIAnalysisRun[];

const demoAiRunById = new Map(demoAiRuns.map((run) => [run.id, run]));
const persistedDemoAiRunById = new Map(demoAiRuns.map((run) => [
  run.id,
  { ...run, provider: "local", model: "local" }
]));

export function createDemoAiRuns(): AIAnalysisRun[] {
  return demoAiRuns.map(cloneDemoAiRun);
}

/**
 * Fail closed when DNA is disabled: only exact, repository-owned fixture runs
 * may cross the person-page server boundary in the fictional demo dataset.
 */
export function isDemoSeededAnalysisRun(run: AIAnalysisRun): boolean {
  return projectDemoSeededAnalysisRun(run) !== undefined;
}

/**
 * Return a clean fixture copy after exact validation. The row store normalizes
 * absent provider/model values to "local"; that one persistence shape is
 * accepted, then removed so storage details never become profile metadata.
 */
export function projectDemoSeededAnalysisRun(run: AIAnalysisRun): AIAnalysisRun | undefined {
  const expected = demoAiRunById.get(run.id);
  const persistedExpected = persistedDemoAiRunById.get(run.id);
  if (!expected || !persistedExpected) {
    return undefined;
  }

  const serializedRun = stableSerialize(run);
  if (
    serializedRun !== stableSerialize(expected)
    && serializedRun !== stableSerialize(persistedExpected)
  ) {
    return undefined;
  }

  return cloneDemoAiRun(expected);
}

function cloneDemoAiRun(run: AIAnalysisRun): AIAnalysisRun {
  return {
    ...run,
    evidenceUsed: [...run.evidenceUsed],
    uncertainty: [...run.uncertainty],
    suggestions: run.suggestions.map((suggestion) => ({
      ...suggestion,
      contextRefs: [...suggestion.contextRefs]
    })),
    contextReferences: run.contextReferences.map((reference) => ({ ...reference }))
  };
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
