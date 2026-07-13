import type { DnaMatch, PersonSummary, ResearchCase } from "./models";
import { createDnaConnectionHypothesis, scoreDnaMatch } from "./dna";

export const demoPeople: PersonSummary[] = [
  {
    id: "p-elizabeth-riemer",
    slug: "elizabeth-katherine-riemer",
    displayName: "Elizabeth Katherine Riemer",
    givenName: "Elizabeth Katherine",
    surname: "Riemer",
    birthDate: "12 Apr 1884",
    birthPlace: "Chicago, Cook County, Illinois, USA",
    deathDate: "17 Feb 1961",
    deathPlace: "Chicago, Cook County, Illinois, USA",
    sex: "F",
    livingStatus: "deceased",
    privacy: "public",
    published: true,
    relatives: ["p-mary-zajicek", "p-william-fletcher"],
    notes: "Published synthetic profile used to demonstrate KinSleuth's person workspace.",
    facts: [
      {
        id: "fact-1",
        type: "BIRT",
        date: "12 Apr 1884",
        place: "Chicago, Cook County, Illinois, USA",
        source: "Synthetic Chicago birth register",
        confidence: 0.92,
        privacy: "public"
      },
      {
        id: "fact-2",
        type: "MARR",
        date: "14 Jun 1905",
        place: "Chicago, Cook County, Illinois, USA",
        source: "Synthetic Cook County marriage index",
        confidence: 0.86,
        privacy: "public"
      },
      {
        id: "fact-3",
        type: "RESI",
        date: "1910",
        place: "Chicago Ward 15, Cook County, Illinois, USA",
        source: "Synthetic census extract",
        confidence: 0.78,
        privacy: "public"
      },
      {
        id: "fact-4",
        type: "DEAT",
        date: "17 Feb 1961",
        place: "Chicago, Cook County, Illinois, USA",
        source: "Synthetic cemetery index",
        confidence: 0.82,
        privacy: "public"
      }
    ]
  },
  {
    id: "p-mary-zajicek",
    slug: "mary-ann-zajicek",
    displayName: "Mary Ann Zajicek",
    surname: "Zajicek",
    birthDate: "1858",
    birthPlace: "Cornwall, England",
    deathDate: "1932",
    deathPlace: "Chicago, Cook County, Illinois, USA",
    livingStatus: "deceased",
    privacy: "private",
    published: false,
    relatives: ["p-elizabeth-riemer"],
    facts: [
      {
        id: "fact-5",
        type: "BIRT",
        date: "1858",
        place: "Cornwall, England",
        confidence: 0.52,
        privacy: "private"
      }
    ]
  },
  {
    id: "p-william-fletcher",
    slug: "william-henry-fletcher",
    displayName: "William Henry Fletcher",
    surname: "Fletcher",
    birthDate: "1881",
    birthPlace: "Limerick, Ireland",
    deathDate: "1954",
    deathPlace: "Chicago, Cook County, Illinois, USA",
    livingStatus: "deceased",
    privacy: "private",
    published: false,
    relatives: ["p-elizabeth-riemer"],
    facts: [
      {
        id: "fact-6",
        type: "BIRT",
        date: "1881",
        place: "Limerick, Ireland",
        confidence: 0.68,
        privacy: "private"
      }
    ]
  }
];

export const demoDnaMatches: DnaMatch[] = [
  {
    id: "dna-j-fletcher",
    displayName: "J. Fletcher",
    totalCm: 238,
    longestSegmentCm: 23.4,
    sharedDnaPercent: 3.12,
    predictedRelationship: "likely 2C1R",
    side: "maternal",
    treeStatus: "partial",
    surnames: ["Fletcher", "Zajicek", "Riemer"],
    places: ["Chicago", "Limerick", "Cornwall"],
    sharedMatches: ["M. O'Donnell", "A. Zajicek", "S. Riemer"],
    notes: "Partial tree reaches a Fletcher household in Chicago with Irish and Cornwall place overlap.",
    triageStatus: "high_priority"
  },
  {
    id: "dna-a-zajicek",
    displayName: "A. Zajicek",
    totalCm: 198,
    longestSegmentCm: 19.8,
    sharedDnaPercent: 2.59,
    predictedRelationship: "likely 2C2R",
    side: "maternal",
    treeStatus: "public",
    surnames: ["Zajicek", "Riemer"],
    places: ["Chicago", "Cornwall"],
    sharedMatches: ["J. Fletcher"],
    notes: "Public tree has several missing spouses but useful Zajicek line clues.",
    triageStatus: "triaged"
  },
  {
    id: "dna-l-collins",
    displayName: "L. Collins",
    totalCm: 118,
    longestSegmentCm: 14.8,
    sharedDnaPercent: 1.58,
    predictedRelationship: "likely 3C",
    side: "paternal",
    treeStatus: "none",
    surnames: [],
    places: ["Illinois"],
    sharedMatches: [],
    notes: "Tested for traits; no usable tree yet.",
    triageStatus: "needs_review"
  }
];

export const demoDnaHypotheses = demoDnaMatches.map((match) => createDnaConnectionHypothesis(match, demoPeople));

export const demoCases: ResearchCase[] = [
  {
    id: "case-riemer-chicago",
    title: "Riemer immigration to Chicago",
    question: "Which branch connects the Riemer and Fletcher records in Chicago?",
    status: "active",
    focus: "Elizabeth K. Riemer line",
    privacy: "private",
    hypotheses: [
      {
        id: "hyp-1",
        statement: "J. Fletcher connects through the Riemer maternal line before 1900.",
        confidence: 0.62,
        status: "supported"
      },
      {
        id: "hyp-2",
        statement: "The shared match cluster points to a Limerick origin rather than Cornwall.",
        confidence: 0.44,
        status: "open"
      }
    ],
    evidence: [
      {
        id: "ev-1",
        title: "J. Fletcher DNA match",
        type: "DNA",
        summary: "238 cM maternal-side match with partial Fletcher/Zajicek tree and Chicago overlap.",
        confidence: 0.72,
        linkedDnaMatchId: "dna-j-fletcher"
      },
      {
        id: "ev-2",
        title: "1900 U.S. Census - Chicago Ward 12",
        type: "Census",
        summary: "Places Riemer household near a Fletcher household in the same ward.",
        confidence: 0.76,
        linkedPersonId: "p-elizabeth-riemer"
      }
    ],
    tasks: [
      { id: "task-1", title: "Find direct record linking Fletcher to Zajicek", status: "doing" },
      { id: "task-2", title: "Compare shared matches with A. Zajicek cluster", status: "todo" }
    ]
  },
  {
    id: "case-limerick-parish",
    title: "Limerick parish records",
    question: "Which parish record explains the Fletcher migration path?",
    status: "planning",
    focus: "Fletcher line",
    privacy: "private",
    hypotheses: [],
    evidence: [],
    tasks: [{ id: "task-3", title: "Search parish registers for William Henry Fletcher", status: "todo" }]
  }
];

export const archiveStats = {
  people: 9813,
  families: 2878,
  sources: 914,
  citations: 48882,
  dnaMatches: 1842,
  triagedMatches: 612,
  highPriorityMatches: 87
};

export const scoredDnaMatches = demoDnaMatches.map((match) => ({
  ...match,
  helpfulnessScore: scoreDnaMatch(match)
}));

