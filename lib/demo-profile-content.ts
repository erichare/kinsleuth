export type DemoProfileNoteSeed = {
  id: string;
  title: string;
  body: string;
};

export type DemoProfileInsightSeed = {
  id: string;
  title: string;
  summary: string;
  detail: string;
  confidence?: number;
  tone: "ok" | "attention" | "neutral";
  caseId?: string;
};

type DemoProfileContent = {
  notes?: readonly DemoProfileNoteSeed[];
  insights?: readonly DemoProfileInsightSeed[];
};

const demoProfileContent: Readonly<Record<string, DemoProfileContent>> = {
  "p-samuel-mercer": {
    notes: [
      {
        id: "samuel-record-correlation",
        title: "Research observation",
        body: "In this fictional archive, certificate 418, the rare lantern trade, the Northstar Cove birthplace, and two similar signatures connect Samuel March to Samuel Rowan Mercer more strongly than the surname alone."
      },
      {
        id: "samuel-open-question",
        title: "Open question",
        body: "The invented records still do not explain why Samuel used March, whether it had any legal standing, or why the 1908–1909 directory printed March and Mercer as separate men at the same address."
      }
    ],
    insights: [
      {
        id: "samuel-directory-conflict",
        title: "Two names at one address",
        summary: "The fictional 1908–1909 directory lists Samuel March and Samuel R. Mercer separately at 14 Dock Street.",
        detail: "A duplicate canvass, an alternate surname, or two connected men remain possible. The wider record set supports one working identity without resolving the legal or social meaning of March.",
        confidence: 0.59,
        tone: "attention",
        caseId: "case-mercer-march-identity"
      }
    ]
  },
  "p-amalia-bellandi": {
    notes: [
      {
        id: "amalia-name-correlation",
        title: "Research observation",
        body: "In this fictional archive, sibling order, house 11, permit and ticket number 612, and the later marriage application connect Amalia Rose Bellandi with records written as Malia Bellandi."
      },
      {
        id: "amalia-open-question",
        title: "Open question",
        body: "The passenger clerk recorded age 22 one month after Amalia's permit recorded 21. The discrepancy stays in the research log even though the document-number and family correlations favor the same traveler."
      }
    ],
    insights: [
      {
        id: "amalia-age-conflict",
        title: "Age conflict preserved",
        summary: "Permit 612 gives the fictional traveler age 21; the linked passenger ledger gives Malia Bellandi age 22.",
        detail: "The shared ticket number, route, sibling Rosa, later parents, and continuing Malia signature support a working identity, but they do not justify silently normalizing the age.",
        confidence: 0.76,
        tone: "attention",
        caseId: "case-bellandi-ceraluna-alta"
      },
      {
        id: "amalia-namesake-conflict",
        title: "A second Malia remains separate",
        summary: "The fictional 1868 household register contains another Malia Bellandi at house 27 with different parents.",
        detail: "A later name index files both girls together and omits their parents. The house 27 child must not be merged into Luca and Mira's family merely because the name and village match.",
        confidence: 0.85,
        tone: "attention",
        caseId: "case-bellandi-ceraluna-alta"
      }
    ]
  },
  "p-maeve-mercer": {
    notes: [
      {
        id: "maeve-witness-note",
        title: "Research observation",
        body: "In this fictional archive, Maeve's 1906 letter is an independent pre-departure observation: she saw Samuel practice both Mercer and March before either name appeared in Lantern Bay records."
      }
    ],
    insights: [
      {
        id: "maeve-name-witness",
        title: "Pre-departure name witness",
        summary: "Maeve places both fictional surnames in Samuel's own handwriting before his 1907 journey.",
        detail: "Her letter strengthens the one-person hypothesis but reports no reason for the second surname and cannot establish whether March was legal, temporary, or misunderstood.",
        confidence: 0.71,
        tone: "neutral",
        caseId: "case-mercer-march-identity"
      }
    ]
  },
  "p-nora-hartwell": {
    notes: [
      {
        id: "nora-tin-observation",
        title: "Research observation",
        body: "In this fictional archive, Nora's January 1922 journal independently agrees with Amalia's notebook that Amalia arranged Samuel's older papers in a newly available blue 21-B tin."
      },
      {
        id: "nora-tin-question",
        title: "Open question",
        body: "Nora called it Amalia's tin while Samuel jokingly claimed any box holding his papers. The family label describes memory and custody, not a proven purchase or continuous chain of ownership."
      }
    ],
    insights: [
      {
        id: "nora-tin-naming-conflict",
        title: "One object, two family labels",
        summary: "The fictional household called the box both Amalia's tin and Samuel's tin.",
        detail: "Contemporary January 1922 notes support Amalia as assembler and Samuel as contributor. A later label should not collapse those different roles.",
        confidence: 0.78,
        tone: "attention",
        caseId: "case-blue-tin"
      }
    ]
  },
  "p-clara-mercer": {
    notes: [
      {
        id: "clara-annotation-observation",
        title: "Research observation",
        body: "In this fictional archive, the violet caption resembles Clara's later album labels, but the pencil stock postdates 1928 and therefore cannot be contemporary with the likely 1906 photograph."
      },
      {
        id: "clara-second-samuel-question",
        title: "Open question",
        body: "Clara's invented note to ask Tobias about the second Samuel has no date or explanation. It may refer to the Mercer–March entries, another person, or a family joke, so it remains a lead rather than a conclusion."
      }
    ],
    insights: [
      {
        id: "clara-caption-conflict",
        title: "Caption and image are different moments",
        summary: "The fictional violet annotation was added decades after the harbor photograph was probably taken.",
        detail: "Scene details support Northstar Cove in autumn 1906; handwriting and material evidence only make Clara a probable later annotator. The three people remain provisional.",
        confidence: 0.83,
        tone: "attention",
        caseId: "case-harbor-photograph"
      }
    ]
  },
  "p-tobias-mercer": {
    notes: [
      {
        id: "tobias-inventory-limit",
        title: "Research observation",
        body: "In this fictional archive, Tobias's 1984 inventory is the clearest surviving snapshot of the blue tin, but it was written sixty-two years after Amalia assembled the documented 1922 collection."
      }
    ],
    insights: [
      {
        id: "tobias-late-snapshot",
        title: "A late inventory is not a chain of custody",
        summary: "Tobias recorded five fictional objects in 1984; two were explicitly outside the tin in January 1922.",
        detail: "The inventory proves the surviving contents changed. It cannot establish when the brass key or violet thread entered the box.",
        confidence: 0.81,
        tone: "attention",
        caseId: "case-blue-tin"
      }
    ]
  },
  "p-elias-hartwell": {
    notes: [
      {
        id: "elias-contact-continuity",
        title: "Research observation",
        body: "In this fictional archive, E. T. Hartwell at 14 Dock Street is Samuel March's 1907 destination contact, and Elias T. Hartwell witnesses Samuel Mercer's 1909 marriage."
      }
    ],
    insights: [
      {
        id: "elias-contact-bridge",
        title: "Contact continuity",
        summary: "Elias connects the March arrival record to the later Mercer household in two different fictional records.",
        detail: "The repeated address and associate are useful identity evidence, but they still do not prove why Samuel used two surnames.",
        confidence: 0.75,
        tone: "neutral",
        caseId: "case-mercer-march-identity"
      }
    ]
  },
  "p-iris-mercer": {
    notes: [
      {
        id: "iris-two-journeys",
        title: "Open question",
        body: "In this fictional archive, Iris believed the passenger notice and harbor photograph came from different journeys. Her accession note preserves the theory but cites no independent travel record."
      }
    ],
    insights: [
      {
        id: "iris-two-journeys-lead",
        title: "Two-journey theory",
        summary: "Iris's fictional archive note challenges Nora's statement that Samuel carried both papers in 1907.",
        detail: "The claim is a useful search lead, not corroboration. A second passenger record or dated custody note would be needed before revising the blue-tin timeline.",
        tone: "attention",
        caseId: "case-blue-tin"
      }
    ]
  }
};

export function demoProfileContentFor(personId: string): DemoProfileContent | undefined {
  return demoProfileContent[personId];
}
