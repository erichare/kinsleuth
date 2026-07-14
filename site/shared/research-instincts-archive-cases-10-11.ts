import type { ResearchInstinctsCase } from "./research-instincts";

export const twoMaliasCase: ResearchInstinctsCase = {
  id: "two-malias",
  title: "Which Malia crossed the ocean?",
  kicker: "Family reconstruction",
  skill: "Same-name identity reconstruction across family groups",
  brief: "Two girls called Malia Bellandi appear in the same 1868 register. Follow sibling clusters, certificate numbers, and later records to decide which became Amalia Hartwell—without erasing the other child or the age conflict.",
  clues: [
    "Baptisms establish Rosa, Amalia Rose, and Ettore as children of Luca Bellandi and Mira Solari.",
    "The 1868 register places seven-year-old Malia between Rosa and Ettore at house 11, while a three-year-old Malia lives with different parents at house 27.",
    "Departure permit 612 and passenger ticket 612 join Amalia Rose to passenger Malia en route to Lantern Bay, despite a one-year age discrepancy.",
    "A later Lantern Bay marriage application repeats Amalia’s birth date and parents, while her bride’s signature uses Malia."
  ],
  records: [
    {
      id: "ceraluna-baptisms-1859-1864",
      catalogId: "KR-DEMO-C10-R1",
      title: "Ceraluna Alta baptism register",
      kind: "Parish baptism register",
      date: "1859–1864",
      image: {
        src: "/assets/challenge/kr-demo-c10-r1-baptism-register.webp",
        alt: "Fictional handwritten baptism register for Rosa, Amalia Rose, and Ettore Bellandi",
        width: 1536,
        height: 1088
      },
      metadata: [
        { label: "Creator", value: "Parish of Saint Aurelia, Ceraluna Alta" },
        { label: "Informants", value: "Parents and sponsors; copied by parish clerks" },
        { label: "Record type", value: "Original bound baptism register" },
        { label: "Research limit", value: "Establishes formal names and parents but does not use the familiar name Malia." }
      ],
      transcript: {
        kind: "table",
        columns: ["Baptism", "Child", "Parents", "Residence"],
        rows: [
          ["16 Sep 1859", "Rosa Bellandi", "Luca Bellandi; Mira Solari", "Bell Tower Lane 11"],
          ["7 Jul 1861", "Amalia Rose Bellandi", "Luca Bellandi; Mira Solari", "Bell Tower Lane 11"],
          ["2 Feb 1864", "Ettore Bellandi", "Luca Bellandi; Mira Solari", "Bell Tower Lane 11"]
        ]
      },
      clueIds: ["c10-sibling-cluster", "c10-parent-corroboration"]
    },
    {
      id: "ceraluna-households-1868",
      catalogId: "KR-DEMO-C10-R2",
      title: "1868 Ceraluna Alta household register",
      kind: "Handwritten household register",
      date: "18 Mar 1868",
      image: {
        src: "/assets/challenge/kr-demo-c10-r2-household-register.webp",
        alt: "Fictional 1868 household register showing two different girls named Malia Bellandi",
        width: 1536,
        height: 1088
      },
      metadata: [
        { label: "Creator", value: "Ceraluna Alta municipal clerk" },
        { label: "Informant", value: "Not recorded" },
        { label: "Record type", value: "Clerk-created household register" },
        { label: "Research limit", value: "Ages are approximate and the familiar name Malia does not itself identify either child." }
      ],
      transcript: {
        kind: "table",
        columns: ["House", "Person", "Relation", "Age", "Parents/household heads"],
        rows: [
          ["11", "Luca Bellandi", "Head", "37", "—"],
          ["11", "Mira Solari Bellandi", "Wife", "33", "—"],
          ["11", "Rosa Bellandi", "Daughter", "9", "Luca and Mira"],
          ["11", "Malia Bellandi", "Daughter", "7", "Luca and Mira"],
          ["11", "Ettore Bellandi", "Son", "4", "Luca and Mira"],
          ["27", "Giacomo Bellandi", "Head", "32", "—"],
          ["27", "Elena Varo Bellandi", "Wife", "28", "—"],
          ["27", "Malia Bellandi", "Daughter", "3", "Giacomo and Elena"]
        ]
      },
      clueIds: ["c10-sibling-cluster", "c10-second-malia"]
    },
    {
      id: "ceraluna-name-index-key",
      catalogId: "KR-DEMO-C10-R3",
      title: "Household name index and clerk’s key",
      kind: "Derivative name index",
      date: "Compiled 1890",
      image: {
        src: "/assets/challenge/kr-demo-c10-r3-name-index.webp",
        alt: "Fictional household index listing two Malia Bellandis with a clerk note about the Amalia name variant",
        width: 1024,
        height: 1600
      },
      metadata: [
        { label: "Creator", value: "Ceraluna Alta archive clerk" },
        { label: "Coverage", value: "Derivative index to the 1868 household volume" },
        { label: "Record type", value: "Later index with name-convention key" },
        { label: "Research limit", value: "The index omits parents; a name convention permits a hypothesis but cannot identify a person." }
      ],
      transcript: {
        kind: "table",
        columns: ["Indexed name", "House", "Register page", "Clerk note"],
        rows: [
          ["Bellandi, Malia", "11", "42", "—"],
          ["Bellandi, Malia", "27", "57", "—"],
          ["Name key", "—", "front pastedown", "Malia / Amalia — filed together; verify household"]
        ]
      },
      clueIds: ["c10-name-key-limit", "c10-second-malia"]
    },
    {
      id: "amalia-departure-permit-1883",
      catalogId: "KR-DEMO-C10-R4",
      title: "Amalia Bellandi departure permit",
      kind: "Signed departure permit",
      date: "2 Mar 1883",
      image: {
        src: "/assets/challenge/kr-demo-c10-r4-departure-permit.webp",
        alt: "Fictional signed departure permit 612 for Amalia Rose Bellandi",
        width: 997,
        height: 1641
      },
      metadata: [
        { label: "Creator", value: "Ceraluna Alta travel office; signed by Amalia" },
        { label: "Informant", value: "Amalia Rose Bellandi" },
        { label: "Record type", value: "Original departure permit" },
        { label: "Research limit", value: "Self-reported details require correlation; the permit shows intended destination, not completed travel." }
      ],
      transcript: {
        kind: "table",
        columns: ["Field", "Entry"],
        rows: [
          ["Certificate", "612"],
          ["Traveler", "Amalia Rose Bellandi"],
          ["Born", "7 July 1861"],
          ["Age", "21"],
          ["Residence", "Bell Tower Lane 11"],
          ["Local contact", "Rosa Bellandi, sister"],
          ["Destination", "Lantern Bay"],
          ["Issued", "2 March 1883"]
        ]
      },
      clueIds: ["c10-permit-identity", "c10-ticket-continuity", "c10-age-conflict"]
    },
    {
      id: "malia-passenger-ledger-1883",
      catalogId: "KR-DEMO-C10-R5",
      title: "Ceraluna–Lantern passenger ledger",
      kind: "Passenger ledger",
      date: "2 Apr 1883",
      image: {
        src: "/assets/challenge/kr-demo-c10-r5-passenger-ledger.webp",
        alt: "Fictional passenger ledger showing ticket 612 for Malia Bellandi, age 22",
        width: 1536,
        height: 1088
      },
      metadata: [
        { label: "Creator", value: "Ceraluna–Lantern Steam Packet clerk" },
        { label: "Informant", value: "Unknown; entries copied from travel papers" },
        { label: "Record type", value: "Clerk-created passenger ledger" },
        { label: "Research limit", value: "Parents are absent and age 22 conflicts with permit 612’s age 21." }
      ],
      transcript: {
        kind: "table",
        columns: ["Date", "Ticket", "Passenger", "Age", "Trade", "Route"],
        rows: [
          ["2 Apr 1883", "609", "Valeri, Nino", "31", "Mason", "Ceraluna Alta–Lantern Bay"],
          ["2 Apr 1883", "612", "Bellandi, Malia", "22", "Needleworker", "Ceraluna Alta–Lantern Bay"],
          ["2 Apr 1883", "614", "Orsi, Lina", "19", "Domestic", "Ceraluna Alta–Lantern Bay"]
        ]
      },
      clueIds: ["c10-ticket-continuity", "c10-age-conflict", "c10-arrival-continuity"]
    },
    {
      id: "amalia-marriage-application-1885",
      catalogId: "KR-DEMO-C10-R6",
      title: "Lantern Bay marriage application",
      kind: "Signed civil marriage application",
      date: "22 Sep 1885",
      image: {
        src: "/assets/challenge/kr-demo-c10-r6-marriage-application.webp",
        alt: "Fictional marriage application for Amalia Rose Bellandi and Elias Thorne Hartwell",
        width: 1024,
        height: 1600
      },
      metadata: [
        { label: "Creator", value: "Lantern Bay civil clerk; signed by both applicants" },
        { label: "Informants", value: "Amalia Rose Bellandi and Elias Thorne Hartwell" },
        { label: "Record type", value: "Original civil application in a different jurisdiction" },
        { label: "Research limit", value: "Later and partly self-reported, though it independently repeats the bride’s birth date and parents." }
      ],
      transcript: {
        kind: "table",
        columns: ["Field", "Entry"],
        rows: [
          ["Bride", "Amalia Rose Bellandi, age 24"],
          ["Born", "7 July 1861, Ceraluna Alta"],
          ["Parents", "Luca Bellandi and Mira Solari"],
          ["Residence", "Harbor Ward, Lantern Bay"],
          ["Groom", "Elias Thorne Hartwell, age 28; born 4 December 1856 in Northstar Cove"],
          ["Bride signature", "Malia Bellandi"],
          ["Date", "22 September 1885"]
        ]
      },
      clueIds: ["c10-parent-corroboration", "c10-arrival-continuity"]
    }
  ],
  notebookClues: [
    {
      id: "c10-sibling-cluster",
      label: "Rosa–Malia–Ettore at house 11 match Luca and Mira’s formal baptism cluster in age and sibling order.",
      recordIds: ["ceraluna-baptisms-1859-1864", "ceraluna-households-1868"]
    },
    {
      id: "c10-second-malia",
      label: "The three-year-old Malia at house 27 belongs to Giacomo Bellandi and Elena Varo and must remain a separate child.",
      recordIds: ["ceraluna-households-1868", "ceraluna-name-index-key"]
    },
    {
      id: "c10-name-key-limit",
      label: "The clerk’s key says Malia may mean Amalia, but the derivative index omits parents and cannot identify either girl.",
      recordIds: ["ceraluna-name-index-key"]
    },
    {
      id: "c10-permit-identity",
      label: "Permit 612 supplies Amalia Rose’s exact birth date, house 11 residence, and Rosa as her sister.",
      recordIds: ["amalia-departure-permit-1883"]
    },
    {
      id: "c10-ticket-continuity",
      label: "Certificate and ticket 612 link Amalia Rose’s permit to the passenger entered as Malia despite the age conflict.",
      recordIds: ["amalia-departure-permit-1883", "malia-passenger-ledger-1883"]
    },
    {
      id: "c10-age-conflict",
      label: "The linked migration records conflict between ages 21 and 22; the discrepancy should be preserved, not silently corrected.",
      recordIds: ["amalia-departure-permit-1883", "malia-passenger-ledger-1883"]
    },
    {
      id: "c10-parent-corroboration",
      label: "The baptism register and a later record in another jurisdiction independently name Luca Bellandi and Mira Solari as Amalia’s parents; the bride signs Malia.",
      recordIds: ["ceraluna-baptisms-1859-1864", "amalia-marriage-application-1885"]
    },
    {
      id: "c10-arrival-continuity",
      label: "The ledger places passenger Malia in Lantern Bay, where a later application joins formal Amalia to the bride’s signature Malia.",
      recordIds: ["malia-passenger-ledger-1883", "amalia-marriage-application-1885"]
    }
  ],
  questions: [
    {
      id: "conclusion",
      prompt: "Which identity conclusion best survives the conflicting age?",
      points: 40,
      pickCount: 1,
      options: [
        { id: "unresolved-two-candidates", label: "The two childhood Malia entries remain equally viable because the name key and passenger ledger do not identify either household." },
        { id: "house-11-amalia", label: "House 11 Malia is best correlated with Amalia Rose; house 27 remains separate, and the age discrepancy remains open." },
        { id: "merge-both", label: "The two household entries may be duplicate enumerations of one child because the name key and village match, leaving the parent differences unresolved." },
        { id: "not-sure", label: "I’m not sure yet." }
      ],
      answerOptionIds: ["house-11-amalia"],
      explanation: "The sibling cluster, permit number, exact birth date, sister Rosa, and later parental corroboration outweigh a one-year passenger age discrepancy. The second Malia belongs to different parents."
    },
    {
      id: "evidence",
      prompt: "Which two correlations distinguish and follow the correct Malia?",
      points: 40,
      pickCount: 2,
      options: [
        { id: "name-variant", label: "The Malia/Amalia name key and the bride’s Malia signature show that the variant persisted across jurisdictions." },
        { id: "family-cluster", label: "Rosa–Malia–Ettore at house 11 matches the baptismal sibling group in names, order, and expected ages." },
        { id: "shared-surname", label: "Bellandi and Ceraluna Alta recur in both childhood households and in the later migration records." },
        { id: "permit-passenger-marriage", label: "Number 612 links permit and passenger entries; the marriage later repeats Amalia’s birth details and parents." },
        { id: "not-sure", label: "I’m not sure which clues matter most." }
      ],
      answerOptionIds: ["family-cluster", "permit-passenger-marriage"],
      explanation: "A reconstructed family group and document-number continuity are discriminating identifiers. A shared surname or permitted name variant merely defines candidates."
    },
    {
      id: "caution",
      prompt: "What should remain unresolved in the research log?",
      points: 20,
      pickCount: 1,
      options: [
        { id: "normalize-age", label: "Keep both childhood households open because the one-year passenger-age conflict prevents choosing between the two Malia entries." },
        { id: "separate-and-preserve", label: "Keep house 27 separate and preserve the 21/22 conflict while treating house 11 as the working identity." },
        { id: "not-sure", label: "I’m not sure what to flag." }
      ],
      answerOptionIds: ["separate-and-preserve"],
      explanation: "Correlation can support a strong working identity without making every field agree. The other child and the discrepant passenger age remain part of the evidence."
    }
  ]
};

export const dnaClustersCase: ResearchInstinctsCase = {
  id: "dna-clusters",
  title: "What do the DNA clusters actually support?",
  kicker: "DNA reasoning",
  skill: "DNA network analysis correlated with documentary paths",
  brief: "Three wholly fictional matches offer cM totals, shared-match clues, profile hints, and incomplete trees. Use the in-case reference card to separate a working cluster from triangulation or proof of an exact relationship.",
  clues: [
    "The tester’s supplied pedigree is already documented through Samuel Mercer, son of Maeve Rowan, and Nora Hartwell, daughter of Amalia Bellandi; living generations are withheld.",
    "M. Alder and T. Pike appear in each other’s qualifying shared-match results; R. Solari is not listed with either.",
    "Two documentary paths point toward Elowen Rowan, but each contains one provisional parent-child link.",
    "A separate correlation path follows R. Solari’s Bellandi and Ceraluna clues toward Rosa Bellandi.",
    "The supplied reference warns that shared matches are not triangulation and that 86, 54, and 37 cM overlap many relationship ranges."
  ],
  records: [
    {
      id: "dna-match-export",
      catalogId: "KR-DEMO-C11-R1",
      title: "Synthetic DNA match export",
      kind: "DNA platform export",
      date: "14 May 2026",
      image: {
        src: "/assets/challenge/kr-demo-c11-r1-match-export.webp",
        alt: "Fictional DNA match export for M. Alder, T. Pike, and R. Solari",
        width: 1536,
        height: 1088
      },
      metadata: [
        { label: "Creator", value: "Fictional HearthDNA platform" },
        { label: "Tester", value: "Anonymous Hartwell–Mercer demo tester" },
        { label: "Documented tester anchors", value: "Samuel Mercer (son of Maeve Rowan) and Nora Hartwell (daughter of Amalia Bellandi); living generations withheld" },
        { label: "Record type", value: "User-entered profile clues plus measured DNA totals" },
        { label: "Research limit", value: "cM totals, surnames, places, and public trees cannot identify an ancestor or exact relationship by themselves." }
      ],
      transcript: {
        kind: "table",
        columns: ["Match", "Shared DNA", "Longest", "Tree", "Profile clues"],
        rows: [
          ["M. Alder", "86 cM", "12.6 cM", "Partial", "Mercer; Rowan; Northstar Cove"],
          ["T. Pike", "54 cM", "9.4 cM", "Public", "Rowan; Northstar Cove"],
          ["R. Solari", "37 cM", "7.1 cM", "None", "Bellandi; Solari; Ceraluna Alta"]
        ]
      },
      clueIds: ["c11-tester-anchors", "c11-cm-overlap", "c11-solari-paper-path", "c11-profile-limit"]
    },
    {
      id: "dna-shared-match-matrix",
      catalogId: "KR-DEMO-C11-R2",
      title: "Qualifying shared-match matrix",
      kind: "Shared-match matrix",
      date: "12 Jul 2026",
      image: {
        src: "/assets/challenge/kr-demo-c11-r2-shared-match-matrix.webp",
        alt: "Fictional shared-match matrix linking Alder and Pike but not listing Solari",
        width: 1536,
        height: 1088
      },
      metadata: [
        { label: "Creator", value: "Fictional HearthDNA platform" },
        { label: "Threshold", value: "Displays only qualifying shared matches" },
        { label: "Record type", value: "In-common-with report without segment coordinates" },
        { label: "Research limit", value: "Not listed does not mean unrelated, and no segment data means the group is not proven triangulated." }
      ],
      transcript: {
        kind: "table",
        columns: ["Match", "M. Alder", "T. Pike", "R. Solari"],
        rows: [
          ["M. Alder", "—", "Listed", "Not listed"],
          ["T. Pike", "Listed", "—", "Not listed"],
          ["R. Solari", "Not listed", "Not listed", "—"],
          ["Platform note", "Only qualifying shared matches appear", "No segment coordinates supplied", "Absence may reflect thresholds"]
        ]
      },
      clueIds: ["c11-alder-pike-network", "c11-not-triangulated", "c11-threshold-caution"]
    },
    {
      id: "rowan-household-1871",
      catalogId: "KR-DEMO-C11-R3",
      title: "1871 Rowan household return",
      kind: "Handwritten household return",
      date: "1 May 1871",
      image: {
        src: "/assets/challenge/kr-demo-c11-r3-rowan-household.webp",
        alt: "Fictional handwritten 1871 household return listing sisters Maeve and Elowen Rowan",
        width: 1536,
        height: 1088
      },
      metadata: [
        { label: "Creator", value: "Northstar Cove enumerator" },
        { label: "Informant", value: "Not recorded" },
        { label: "Record type", value: "Clerk-created household return" },
        { label: "Research limit", value: "Establishes Maeve and Elowen as sisters but does not connect either to a living DNA match." }
      ],
      transcript: {
        kind: "table",
        columns: ["Person", "Relation", "Age", "Born", "Residence"],
        rows: [
          ["Silas Rowan", "Head", "36", "Northstar Cove", "Signal Hill Road"],
          ["Elara Vale Rowan", "Wife", "33", "Whitecap Point", "Signal Hill Road"],
          ["Maeve L. Rowan", "Daughter", "7", "Northstar Cove", "Signal Hill Road"],
          ["Elowen Rowan", "Daughter", "3", "Northstar Cove", "Signal Hill Road"]
        ]
      },
      clueIds: ["c11-rowan-siblings"]
    },
    {
      id: "elowen-descendant-proof-chart",
      catalogId: "KR-DEMO-C11-R4",
      title: "Elowen Rowan descendant proof chart",
      kind: "Pencil-annotated research chart",
      date: "Compiled 2026",
      image: {
        src: "/assets/challenge/kr-demo-c11-r4-elowen-proof-chart.webp",
        alt: "Fictional descendant chart with two paths from Elowen Rowan and one provisional link in each",
        width: 1536,
        height: 1088
      },
      metadata: [
        { label: "Creator", value: "Kin Resolve fictional demo researcher" },
        { label: "Sources", value: "Civil records, obituaries, derivative tree, and initials-only index" },
        { label: "Record type", value: "Research proof chart with source-status notation" },
        { label: "Research limit", value: "Each path contains one dashed provisional parent-child link requiring independent confirmation." }
      ],
      transcript: {
        kind: "table",
        columns: ["Path", "Documented sequence", "Unresolved link", "Candidate match"],
        rows: [
          ["A", "Elowen Rowan → Cora Rowan → Edwin Harper → Lydia Harper", "Lydia Harper ⇢ Daniel Foster (record needed)", "M. Alder"],
          ["B", "Elowen Rowan → Owen Rowan → Margaret Rowan → Thomas Pike", "Thomas Pike ⇢ Jason Pike (record needed)", "T. Pike"]
        ]
      },
      clueIds: ["c11-elowen-convergence", "c11-provisional-gaps"]
    },
    {
      id: "solari-correlation-worksheet",
      catalogId: "KR-DEMO-C11-R5",
      title: "Rosa Bellandi–Solari correlation worksheet",
      kind: "Document correlation worksheet",
      date: "Compiled 2026",
      image: {
        src: "/assets/challenge/kr-demo-c11-r5-solari-correlation.webp",
        alt: "Fictional correlation worksheet tracing R. Solari profile clues toward Rosa Bellandi",
        width: 1024,
        height: 1600
      },
      metadata: [
        { label: "Creator", value: "Kin Resolve fictional demo researcher" },
        { label: "Sources", value: "Rosa’s baptism, Bellandi–Solari civil abstracts, and match profile clues" },
        { label: "Record type", value: "Working documentary correlation" },
        { label: "Research limit", value: "A surname-and-place path guides research but does not prove that R. Solari descends from Rosa." }
      ],
      transcript: {
        kind: "table",
        columns: ["Evidence", "Observed detail", "Correlation"],
        rows: [
          ["1859 baptism", "Rosa Bellandi, daughter of Luca Bellandi and Mira Solari", "Known sister of Amalia"],
          ["1890 civil abstract", "Rosa Bellandi household uses Solari as a child’s middle name", "Continued surname association"],
          ["R. Solari profile", "Bellandi; Solari; Ceraluna Alta", "Matches the place-and-surname pattern"],
          ["Missing proof", "No usable public tree", "Exact descent remains unresolved"]
        ]
      },
      clueIds: ["c11-solari-paper-path", "c11-profile-limit"]
    },
    {
      id: "dna-interpretation-reference",
      catalogId: "KR-DEMO-C11-R6",
      title: "DNA interpretation reference card",
      kind: "In-case research reference",
      date: "Demo edition 2026",
      image: {
        src: "/assets/challenge/kr-demo-c11-r6-dna-reference-card.webp",
        alt: "Fictional DNA interpretation card explaining cM overlap, shared matches, thresholds, and triangulation",
        width: 1536,
        height: 1088
      },
      metadata: [
        { label: "Creator", value: "Kin Resolve fictional methodology desk" },
        { label: "Purpose", value: "Self-contained reference for this challenge" },
        { label: "Record type", value: "Research-method lookup card" },
        { label: "Research limit", value: "A reference explains interpretation rules; it does not add evidence about these particular matches." }
      ],
      transcript: {
        kind: "table",
        columns: ["Question", "Research rule"],
        rows: [
          ["Does total cM identify a relationship?", "No. 37, 54, and 86 cM each fit multiple relationship ranges."],
          ["Are shared matches triangulated?", "No. Triangulation requires overlapping segment data for all group members."],
          ["Does ‘not listed’ mean unrelated?", "No. Platform display and shared-match thresholds can hide relationships."],
          ["Does a public tree prove descent?", "No. Treat it as a research lead until each generational link is sourced."],
          ["What makes a useful hypothesis?", "Combine genetic network structure with independently documented family paths."]
        ]
      },
      clueIds: ["c11-cm-overlap", "c11-not-triangulated", "c11-threshold-caution", "c11-profile-limit"]
    }
  ],
  notebookClues: [
    {
      id: "c11-tester-anchors",
      label: "The supplied pedigree anchors the tester to Maeve Rowan through Samuel Mercer and to Amalia Bellandi through Nora Hartwell.",
      recordIds: ["dna-match-export"]
    },
    {
      id: "c11-cm-overlap",
      label: "The 86, 54, and 37 cM totals overlap multiple relationships and cannot identify an ancestor or exact relationship.",
      recordIds: ["dna-match-export", "dna-interpretation-reference"]
    },
    {
      id: "c11-alder-pike-network",
      label: "M. Alder and T. Pike appear in each other’s qualifying shared-match results.",
      recordIds: ["dna-shared-match-matrix"]
    },
    {
      id: "c11-not-triangulated",
      label: "No segment coordinates are supplied, so the Alder–Pike network is not a proven triangulated group.",
      recordIds: ["dna-shared-match-matrix", "dna-interpretation-reference"]
    },
    {
      id: "c11-rowan-siblings",
      label: "The 1871 household establishes Maeve and Elowen Rowan as daughters of the same parents, but not as ancestors of a match.",
      recordIds: ["rowan-household-1871"]
    },
    {
      id: "c11-elowen-convergence",
      label: "Two separately researched documentary paths converge on descendants of Elowen Rowan.",
      recordIds: ["elowen-descendant-proof-chart"]
    },
    {
      id: "c11-provisional-gaps",
      label: "Each Elowen path still contains one provisional parent-child link and cannot yet prove exact descent.",
      recordIds: ["elowen-descendant-proof-chart"]
    },
    {
      id: "c11-solari-paper-path",
      label: "R. Solari’s Bellandi and Ceraluna clues correlate with a separate documentary path toward Rosa Bellandi.",
      recordIds: ["dna-match-export", "solari-correlation-worksheet"]
    },
    {
      id: "c11-threshold-caution",
      label: "R. Solari’s absence from the shared-match matrix may reflect thresholds and cannot exclude a Rowan connection.",
      recordIds: ["dna-shared-match-matrix", "dna-interpretation-reference"]
    },
    {
      id: "c11-profile-limit",
      label: "Profile surnames, places, and trees are research clues rather than genetic or documentary proof.",
      recordIds: ["dna-match-export", "solari-correlation-worksheet", "dna-interpretation-reference"]
    }
  ],
  questions: [
    {
      id: "conclusion",
      prompt: "Which model best accounts for all three matches without claiming more than the packet supports?",
      points: 40,
      pickCount: 1,
      options: [
        { id: "highest-cm-all", label: "Use Alder’s 86 cM result to anchor Elowen, then test whether Pike and Solari descend through adjacent family lines." },
        { id: "triangulated-elowen", label: "Treat Alder and Pike as an Elowen descendant cluster, with the shared-match matrix providing provisional genetic confirmation." },
        { id: "exclude-solari", label: "Focus the Rowan hypothesis on Alder and Pike, and defer Solari because it falls outside their displayed shared-match network." },
        { id: "two-working-tracks", label: "Pursue Alder and Pike through Elowen as one working track, and Solari through Rosa as a separate track." },
        { id: "not-sure", label: "I’m not sure yet." }
      ],
      answerOptionIds: ["two-working-tracks"],
      explanation: "The network and two incomplete paper paths make Elowen a useful candidate for Alder and Pike. Solari’s different clues support a separate Bellandi track. Neither path proves an exact relationship."
    },
    {
      id: "evidence",
      prompt: "Which two correlations connect each working track to a candidate family line?",
      points: 40,
      pickCount: 2,
      options: [
        { id: "alder-pike-elowen", label: "Alder and Pike appear together in shared-match results while two incomplete paper paths independently point toward Elowen." },
        { id: "largest-cm", label: "Alder’s 86 cM total and Rowan profile clues make it the strongest numerical anchor for the cluster." },
        { id: "solari-rosa", label: "Solari’s Bellandi and Ceraluna clues align with the Rosa worksheet independently of the two Rowan paths." },
        { id: "matrix-absence", label: "Solari’s absence from the displayed matrix separates it from Alder and Pike at the platform’s reporting threshold." },
        { id: "not-sure", label: "I’m not sure which clues matter most." }
      ],
      answerOptionIds: ["alder-pike-elowen", "solari-rosa"],
      explanation: "Useful clustering combines genetic network structure with independent documentary paths. cM rank and an absent thresholded listing cannot assign an ancestor."
    },
    {
      id: "caution",
      prompt: "Which limitation should govern both working tracks?",
      points: 20,
      pickCount: 1,
      options: [
        { id: "not-triangulation", label: "Shared-match status is not triangulation; thresholds, overlapping cM ranges, and provisional paper links leave each relationship estimate open." },
        { id: "trees-prove", label: "Keep each public tree provisional until its lineage is rebuilt; after that, use cM totals to choose the most likely relationship range." },
        { id: "not-sure", label: "I’m not sure what to flag." }
      ],
      answerOptionIds: ["not-triangulation"],
      explanation: "The case supports prioritized research tracks, not exact relationships. Every unresolved genetic and documentary assumption should stay visible."
    }
  ]
};
