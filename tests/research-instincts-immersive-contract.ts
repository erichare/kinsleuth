export const IMMERSIVE_CASE_ID = "mercer-march-identity";

export const EXPECTED_IMMERSIVE_RECORDS = [
  {
    catalogId: "KR-DEMO-C07-R1",
    assetPath: "/assets/challenge/kr-demo-c07-r1-household-schedule.webp",
    titlePattern: /household.*schedule|census.*schedule|household.*census/i,
    transcriptKind: "table"
  },
  {
    catalogId: "KR-DEMO-C07-R2",
    assetPath: "/assets/challenge/kr-demo-c07-r2-maeve-letter.webp",
    titlePattern: /Maeve.*letter|letter.*Maeve/i,
    transcriptKind: "letter"
  },
  {
    catalogId: "KR-DEMO-C07-R3",
    assetPath: "/assets/challenge/kr-demo-c07-r3-departure-ledger.webp",
    titlePattern: /departure.*ledger/i,
    transcriptKind: "table"
  },
  {
    catalogId: "KR-DEMO-C07-R4",
    assetPath: "/assets/challenge/kr-demo-c07-r4-passenger-declaration.webp",
    titlePattern: /passenger.*declaration/i,
    transcriptKind: "table"
  },
  {
    catalogId: "KR-DEMO-C07-R5",
    assetPath: "/assets/challenge/kr-demo-c07-r5-city-directory.webp",
    titlePattern: /city.*directory/i,
    transcriptKind: "table"
  },
  {
    catalogId: "KR-DEMO-C07-R6",
    assetPath: "/assets/challenge/kr-demo-c07-r6-marriage-ledger.webp",
    titlePattern: /marriage.*ledger/i,
    transcriptKind: "table"
  }
] as const;

export const IMMERSIVE_CHALLENGE_REGIONS = [
  "record-inspector",
  "transcript",
  "clue-notebook",
  "conclusion"
] as const;

export type ImmersiveTableTranscript = {
  kind: "table";
  columns: readonly string[];
  rows: readonly (readonly string[])[];
};

export type ImmersiveLetterTranscript = {
  kind: "letter";
  paragraphs: readonly string[];
};

export type ImmersiveRecordContract = {
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
  transcript: ImmersiveTableTranscript | ImmersiveLetterTranscript;
  clueIds: readonly string[];
};

export type ImmersiveNotebookClueContract = {
  id: string;
  label: string;
  recordIds: readonly string[];
};

export type ImmersiveCaseContract = {
  records?: readonly ImmersiveRecordContract[];
  notebookClues?: readonly ImmersiveNotebookClueContract[];
};
