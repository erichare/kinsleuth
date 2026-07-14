import type { ResearchInstinctsCase } from "./research-instincts";

export const blueTinTimelineCase: ResearchInstinctsCase = {
  id: "blue-tin-timeline",
  title: "Who assembled the blue tin?",
  kicker: "Provenance",
  skill: "Object provenance and timeline reconstruction",
  brief: "Six records span seventy-seven years. Family lore calls it Samuel’s tin, but the contents have different dates and entered the collection at different times. Reconstruct the sequence instead of choosing the oldest label.",
  clues: [
    "A 1907 passenger notice is the oldest surviving item, while a 1921 repair receipt proves the complete contents did not travel together; neither item date says when it entered the tin.",
    "The NCW 21-B maker code appears on the 1984 lid rubbing and in a trade circular first issued in September 1921.",
    "Amalia Bellandi and Nora Hartwell independently describe Amalia arranging Samuel’s papers in January 1922.",
    "The brass key and violet thread were still outside the tin in January 1922 but appear inside in 1984."
  ],
  records: [
    {
      id: "blue-tin-passenger-notice-1907",
      catalogId: "KR-DEMO-C08-R1",
      title: "Lantern Packet passenger notice",
      kind: "Passenger notice",
      date: "4 May 1907",
      image: {
        src: "/assets/challenge/kr-demo-c08-r1-passenger-notice.webp",
        alt: "Fictional folded 1907 passenger notice issued to Samuel March",
        width: 1024,
        height: 1536
      },
      metadata: [
        { label: "Creator", value: "Lantern Packet Company" },
        { label: "Recipient", value: "Samuel March" },
        { label: "Record type", value: "Printed travel notice retained by the passenger" },
        { label: "Research limit", value: "Dates the notice, not when the notice entered the blue tin." }
      ],
      transcript: {
        kind: "table",
        columns: ["Field", "Entry"],
        rows: [
          ["Certificate", "418"],
          ["Passenger", "March, Samuel"],
          ["Route", "Northstar Cove to Lantern Bay"],
          ["Sailing", "4 May 1907"],
          ["Instruction", "Retain for baggage claim"],
          ["Reverse notation", "None" ]
        ]
      },
      clueIds: ["notice-date-not-accession", "contributor-vs-assembler"]
    },
    {
      id: "blue-tin-repair-receipt-1921",
      catalogId: "KR-DEMO-C08-R2",
      title: "North Quay lamp-repair receipt",
      kind: "Shop receipt",
      date: "8 Feb 1921",
      image: {
        src: "/assets/challenge/kr-demo-c08-r2-lamp-repair-receipt.webp",
        alt: "Fictional oil-marked 1921 lamp-repair receipt for S. R. Mercer",
        width: 1024,
        height: 1536
      },
      metadata: [
        { label: "Creator", value: "North Quay Lamp & Lens Works" },
        { label: "Customer", value: "S. R. Mercer, 14 Dock Street" },
        { label: "Record type", value: "Commercial receipt" },
        { label: "Research limit", value: "Old folds fit the tin, but folds cannot establish when the receipt was placed there." }
      ],
      transcript: {
        kind: "table",
        columns: ["Field", "Entry"],
        rows: [
          ["Receipt", "771"],
          ["Date", "8 February 1921"],
          ["Customer", "S. R. Mercer, 14 Dock"],
          ["Work", "Resilver reflector; mend hinge"],
          ["Charge", "$2.35 — paid"],
          ["Clerk", "J. Fen" ]
        ]
      },
      clueIds: ["receipt-after-arrival", "contents-changed"]
    },
    {
      id: "blue-tin-estate-inventory-1984",
      catalogId: "KR-DEMO-C08-R3",
      title: "Tobias Mercer’s blue-tin inventory",
      kind: "Household inventory and lid rubbing",
      date: "17 Jan 1984",
      image: {
        src: "/assets/challenge/kr-demo-c08-r3-estate-inventory.webp",
        alt: "Fictional handwritten 1984 inventory of a blue tin with an NCW 21-B lid rubbing",
        width: 1024,
        height: 1536
      },
      metadata: [
        { label: "Creator", value: "Tobias Mercer" },
        { label: "Context", value: "Hartwell–Mercer household inventory" },
        { label: "Record type", value: "Late family inventory with graphite rubbing" },
        { label: "Research limit", value: "A 1984 snapshot cannot prove which contents were present in 1922." }
      ],
      transcript: {
        kind: "letter",
        paragraphs: [
          "17 January 1984 — Blue tin from Father’s bench.",
          "Inside: Elias’s small brass key; Samuel’s folded 1907 sailing notice; North Quay lamp account dated 1921; violet mending thread; unnamed harbor photograph.",
          "Rubbing from underside of lid: NCW 21-B.",
          "Inventory made by Tobias Mercer."
        ]
      },
      clueIds: ["maker-code-window", "contents-changed", "late-inventory-snapshot"]
    },
    {
      id: "blue-tin-trade-circular-1921",
      catalogId: "KR-DEMO-C08-R4",
      title: "Northlight Container Works trade circular",
      kind: "Manufacturer trade circular",
      date: "15 Sep 1921",
      image: {
        src: "/assets/challenge/kr-demo-c08-r4-tin-trade-circular.webp",
        alt: "Fictional 1921 trade circular listing the NCW 21-B blue harbor-pattern tin",
        width: 1536,
        height: 1024
      },
      metadata: [
        { label: "Creator", value: "Northlight Container Works" },
        { label: "Audience", value: "Lantern Bay wholesalers" },
        { label: "Record type", value: "Dated manufacturer reference circular" },
        { label: "Research limit", value: "Establishes the earliest offering date, not who bought this particular tin or when." }
      ],
      transcript: {
        kind: "table",
        columns: ["Model", "Description", "Finish", "First offered"],
        rows: [
          ["20-A", "Square provision box", "Red enamel", "3 Mar 1920"],
          ["21-B", "Blue harbor-pattern keepsake tin", "Deep blue enamel", "15 Sep 1921"],
          ["21-C", "Round tea tin", "Cream enamel", "10 Nov 1921"],
          ["22-A", "Long document box", "Grey enamel", "4 Jan 1922"]
        ]
      },
      clueIds: ["maker-code-window"]
    },
    {
      id: "blue-tin-amalia-notebook-1922",
      catalogId: "KR-DEMO-C08-R5",
      title: "Amalia Bellandi’s recipe notebook",
      kind: "Handwritten recipe marginalia",
      date: "6 Jan 1922",
      image: {
        src: "/assets/challenge/kr-demo-c08-r5-amalia-recipe-notebook.webp",
        alt: "Fictional handwritten 1922 recipe-notebook margin describing Amalia arranging a blue tin",
        width: 1024,
        height: 1536
      },
      metadata: [
        { label: "Creator", value: "Amalia Rose Bellandi Hartwell" },
        { label: "Context", value: "Margin beside a preserved-citrus recipe" },
        { label: "Record type", value: "Contemporary private notebook" },
        { label: "Research limit", value: "Describes Amalia’s plan and actions but does not provide a purchase receipt or later custody history." }
      ],
      transcript: {
        kind: "letter",
        paragraphs: [
          "6 January 1922 — At Nora’s.",
          "Set Sam’s folded notice, the lamp account, and the harbor likeness Nora gave me in the blue 21-B tin.",
          "Elias’s little key waits for its cord; violet thread set aside. Sam laughed that any box holding his papers must be his.",
          "— A. B."
        ]
      },
      clueIds: ["paired-assembly-accounts", "contributor-vs-assembler", "contents-changed"]
    },
    {
      id: "blue-tin-nora-journal-1922",
      catalogId: "KR-DEMO-C08-R6",
      title: "Nora Hartwell’s household journal",
      kind: "Handwritten household journal",
      date: "8 Jan 1922",
      image: {
        src: "/assets/challenge/kr-demo-c08-r6-nora-journal.webp",
        alt: "Fictional handwritten 1922 journal calling the collection Amalia’s tin",
        width: 1024,
        height: 1536
      },
      metadata: [
        { label: "Creator", value: "Nora Elise Hartwell Mercer" },
        { label: "Relationship", value: "Daughter of Amalia; wife of Samuel" },
        { label: "Record type", value: "Contemporary household journal" },
        { label: "Research limit", value: "A second family account, but not a complete item-by-item accession register." }
      ],
      transcript: {
        kind: "letter",
        paragraphs: [
          "Sunday, 8 January 1922",
          "Mother spent Thursday making a remembrance of the blue tin. Samuel’s sailing notice and the harbor picture went in with last year’s lamp receipt.",
          "Father’s key and my violet thread remain on the dresser. I shall always think of it as Amalia’s tin, though Samuel has already claimed the joke of it.",
          "— Nora"
        ]
      },
      clueIds: ["paired-assembly-accounts", "contents-changed"]
    }
  ],
  notebookClues: [
    {
      id: "notice-date-not-accession",
      label: "The 1907 notice dates one item; it cannot date the collection or prove when the notice entered the tin.",
      recordIds: ["blue-tin-passenger-notice-1907"]
    },
    {
      id: "receipt-after-arrival",
      label: "The 1921 receipt rules out the complete surviving contents having traveled together in 1907.",
      recordIds: ["blue-tin-repair-receipt-1921"]
    },
    {
      id: "maker-code-window",
      label: "The NCW 21-B lid code matches a model first offered on 15 September 1921, setting an earliest possible date for the tin.",
      recordIds: ["blue-tin-estate-inventory-1984", "blue-tin-trade-circular-1921"]
    },
    {
      id: "paired-assembly-accounts",
      label: "Amalia’s 6 January note and Nora’s independent 8 January journal both describe Amalia arranging Samuel’s older papers in the tin.",
      recordIds: ["blue-tin-amalia-notebook-1922", "blue-tin-nora-journal-1922"]
    },
    {
      id: "contributor-vs-assembler",
      label: "Samuel contributed the old notice and photograph, but contribution is not the same claim as assembly.",
      recordIds: ["blue-tin-passenger-notice-1907", "blue-tin-amalia-notebook-1922"]
    },
    {
      id: "contents-changed",
      label: "The key and violet thread were outside the tin in January 1922 but appear inside the 1984 inventory, so the contents changed later.",
      recordIds: [
        "blue-tin-repair-receipt-1921",
        "blue-tin-estate-inventory-1984",
        "blue-tin-amalia-notebook-1922",
        "blue-tin-nora-journal-1922"
      ]
    },
    {
      id: "late-inventory-snapshot",
      label: "Tobias’s 1984 inventory is a late snapshot, not proof that all five objects were present in 1922.",
      recordIds: ["blue-tin-estate-inventory-1984"]
    }
  ],
  questions: [
    {
      id: "conclusion",
      prompt: "Which provenance statement best fits the full timeline?",
      points: 40,
      pickCount: 1,
      options: [
        { id: "samuel-1907", label: "Samuel probably started a collection before 1922, and Amalia transferred his earlier group of keepsakes into the blue tin." },
        { id: "tobias-1984", label: "Tobias may have assembled the surviving five-object collection shortly before his 1984 inventory, using the older papers as inherited material." },
        { id: "amalia-assembled", label: "Amalia probably began the documented collection in January 1922; later additions changed its contents before Tobias’s inventory." },
        { id: "not-sure", label: "I’m not sure yet." }
      ],
      answerOptionIds: ["amalia-assembled"],
      explanation: "The maker code places the tin after September 1921, and two contemporary accounts describe Amalia arranging three items in January 1922. The key and thread appear only in the late inventory, so the collection continued to change."
    },
    {
      id: "evidence",
      prompt: "Which two correlations establish the assembly window?",
      points: 40,
      pickCount: 2,
      options: [
        { id: "oldest-item", label: "The 1907 notice and 1921 receipt show that the collection’s papers span at least fourteen years." },
        { id: "maker-window", label: "The NCW 21-B code identifies a tin model first advertised in September 1921." },
        { id: "independent-accounts", label: "Amalia’s note and Nora’s independent journal both describe her arranging three items in January 1922." },
        { id: "fold-fit", label: "The receipt’s matching folds suggest the papers had already been stored together before the 1984 inventory." },
        { id: "not-sure", label: "I’m not sure which clues matter most." }
      ],
      answerOptionIds: ["maker-window", "independent-accounts"],
      explanation: "The model reference supplies a terminus post quem, and the two independent contemporary accounts identify the assembler. Item dates and fold patterns cannot establish accession dates."
    },
    {
      id: "caution",
      prompt: "What limitation belongs in the object history?",
      points: 20,
      pickCount: 1,
      options: [
        { id: "snapshot-not-chain", label: "Distinguish manufacture, arrangement, later additions, and surviving custody because none supplies a continuous chain on its own." },
        { id: "circular-is-purchase", label: "Flag the missing purchase receipt as the main provenance gap; the maker code and January accounts otherwise establish continuous custody." },
        { id: "not-sure", label: "I’m not sure what to flag." }
      ],
      answerOptionIds: ["snapshot-not-chain"],
      explanation: "A careful provenance statement distinguishes manufacture, acquisition, assembly, later additions, and surviving custody. None of the records documents every transition."
    }
  ]
};

export const harborPhotoCase: ResearchInstinctsCase = {
  id: "harbor-photo",
  title: "Where and when was the harbor photograph taken?",
  kicker: "Photograph",
  skill: "Photograph dating through visual source correlation",
  brief: "Two fictional harbor businesses can leave the cropped letters ‘AR,’ and a persuasive violet caption is decades newer than the photograph. Compare the scene, consult the seal register, and separate the image from its later annotation.",
  clues: [
    "The photograph shows a dark–pale–pale–dark awning, a twelve-lamp double rail, cropped ‘AR,’ and a diamond enclosing two strokes.",
    "North Star Chandlery’s 1906 catalog matches the combined feature cluster.",
    "The inspection register assigns diamond + II to Northstar Cove only from September through November 1906.",
    "The violet verso note and Clara’s album work date after 1928 and cannot be a contemporary caption."
  ],
  records: [
    {
      id: "harbor-photo-recto",
      catalogId: "KR-DEMO-C09-R1",
      title: "Unidentified harbor photograph, recto",
      kind: "Albumen photograph",
      date: "Undated; likely early 1900s",
      image: {
        src: "/assets/challenge/kr-demo-c09-r1-harbor-photograph.webp",
        alt: "Fictional sepia harbor photograph with three figures, cropped AR sign, striped awning, and lantern rack",
        width: 1536,
        height: 1024
      },
      metadata: [
        { label: "Creator", value: "Unknown photographer" },
        { label: "Custody", value: "Found loose in Clara Mercer’s album" },
        { label: "Record type", value: "Uncaptioned photographic print" },
        { label: "Research limit", value: "No contemporary names, date, or place survive on the recto." }
      ],
      transcript: {
        kind: "table",
        columns: ["Visible feature", "Observation"],
        rows: [
          ["Figures", "Three people; faces soft at this resolution"],
          ["Awning", "Stripe order dark–pale–pale–dark"],
          ["Sign", "Only final letters …AR remain in frame"],
          ["Display", "Twelve lamps on a double-rail rack"],
          ["Rack mark", "Diamond enclosing two vertical strokes"],
          ["Caption", "None on the image face"]
        ]
      },
      clueIds: ["cropped-ar-ambiguous", "northstar-feature-cluster", "seal-register-lookup", "portrait-match-provisional"]
    },
    {
      id: "harbor-photo-verso",
      catalogId: "KR-DEMO-C09-R2",
      title: "Unidentified harbor photograph, verso",
      kind: "Photograph verso annotation",
      date: "Annotation after 1928",
      image: {
        src: "/assets/challenge/kr-demo-c09-r2-photograph-verso.webp",
        alt: "Fictional scuffed photograph back with a later violet-pencil annotation",
        width: 1536,
        height: 1024
      },
      metadata: [
        { label: "Creator", value: "Unknown annotator; probably Clara Mercer" },
        { label: "Material", value: "Violet pencil stock first documented after 1928" },
        { label: "Record type", value: "Later annotation on photograph verso" },
        { label: "Research limit", value: "The note supplies no names, date, or signature and postdates the image." }
      ],
      transcript: {
        kind: "letter",
        paragraphs: [
          "Violet pencil, centered on the photograph back:",
          "‘the day the western lamp came home’",
          "No date, place, names, or signature."
        ]
      },
      clueIds: ["verso-postdates-image", "clara-probable-annotator"]
    },
    {
      id: "north-star-catalog-1906",
      catalogId: "KR-DEMO-C09-R3",
      title: "North Star Chandlery autumn catalog",
      kind: "Illustrated trade catalog",
      date: "Autumn 1906",
      image: {
        src: "/assets/challenge/kr-demo-c09-r3-chandlery-catalog.webp",
        alt: "Fictional 1906 North Star Chandlery catalog showing the striped awning and twelve-lamp rack",
        width: 1024,
        height: 1536
      },
      metadata: [
        { label: "Creator", value: "North Star Chandlery, Northstar Cove" },
        { label: "Edition", value: "Autumn 1906 trade catalog" },
        { label: "Record type", value: "Printed illustrated catalog" },
        { label: "Research limit", value: "A printed illustration can corroborate features but is not itself a photograph of the event." }
      ],
      transcript: {
        kind: "table",
        columns: ["Feature", "Catalog description"],
        rows: [
          ["Store sign", "NORTH STAR"],
          ["Location", "Quay Road, Northstar Cove"],
          ["Awning", "House stripe: dark–pale–pale–dark"],
          ["Display", "Twelve-lamp double-rail demonstration rack"],
          ["Season", "Autumn fittings, 1906"]
        ]
      },
      clueIds: ["cropped-ar-ambiguous", "northstar-feature-cluster"]
    },
    {
      id: "harbor-seal-register-1904-1908",
      catalogId: "KR-DEMO-C09-R4",
      title: "Two-harbor inspection-seal register",
      kind: "Inspection reference register",
      date: "1904–1908",
      image: {
        src: "/assets/challenge/kr-demo-c09-r4-inspection-seal-register.webp",
        alt: "Fictional harbor register mapping inspection symbols to places and date ranges",
        width: 1536,
        height: 1024
      },
      metadata: [
        { label: "Creator", value: "Combined Harbor Safety Office" },
        { label: "Coverage", value: "Northstar Cove, Lantern Bay, and Saltedge" },
        { label: "Record type", value: "Official symbol lookup register" },
        { label: "Research limit", value: "Dates the inspection mark’s authorized use, not the precise day the photograph was exposed." }
      ],
      transcript: {
        kind: "table",
        columns: ["Harbor", "Mark", "Authorized dates", "Use"],
        rows: [
          ["Northstar Cove", "Diamond + II", "1 Sep–30 Nov 1906", "Portable lamp racks"],
          ["Northstar Cove", "Circle + II", "1 Dec 1906–31 Dec 1908", "Portable lamp racks"],
          ["Lantern Bay", "Triangle + II", "1904–1908", "Portable lamp racks"],
          ["Saltedge", "Diamond + I", "1905–1907", "Portable lamp racks"]
        ]
      },
      clueIds: ["seal-register-lookup", "lantern-rival-conflict"]
    },
    {
      id: "lantern-harbor-directory-1908",
      catalogId: "KR-DEMO-C09-R5",
      title: "1908 Lantern Bay harbor directory",
      kind: "Illustrated commercial directory",
      date: "1908",
      image: {
        src: "/assets/challenge/kr-demo-c09-r5-harbor-directory.webp",
        alt: "Fictional 1908 directory advertisement for rival Harbor Star Outfitters",
        width: 1024,
        height: 1536
      },
      metadata: [
        { label: "Creator", value: "Lantern Bay Directory Company" },
        { label: "Coverage", value: "Subscribers canvassed in early 1908" },
        { label: "Record type", value: "Incomplete commercial directory" },
        { label: "Research limit", value: "A missing listing is bounded negative evidence because coverage is incomplete and later than 1906." }
      ],
      transcript: {
        kind: "table",
        columns: ["Feature", "Harbor Star Outfitters advertisement"],
        rows: [
          ["Sign", "HARBOR STAR — may crop to final AR"],
          ["Awning", "Alternating dark–pale stripes"],
          ["Display", "Eight-lamp single-rail rack"],
          ["Inspection mark", "Triangle + II"],
          ["North Star listing", "None in subscriber section"]
        ]
      },
      clueIds: ["cropped-ar-ambiguous", "lantern-rival-conflict", "bounded-negative"]
    },
    {
      id: "clara-comparison-workbook-1933",
      catalogId: "KR-DEMO-C09-R6",
      title: "Archival comparison of Clara Mercer’s labels",
      kind: "Album-label and handwriting comparison",
      date: "Compared 2026; source labels 1931–1936",
      image: {
        src: "/assets/challenge/kr-demo-c09-r6-clara-comparison.webp",
        alt: "Fictional archivist comparison of Clara Mercer’s later album labels with probable portraits of Maeve, Samuel, and Jonah",
        width: 1536,
        height: 1024
      },
      metadata: [
        { label: "Comparison creator", value: "Kin Resolve fictional demo archivist, 2026" },
        { label: "Source material", value: "Clara Mercer album labels dated 1931–1936" },
        { label: "Material", value: "Violet stock sold after 1928" },
        { label: "Record type", value: "Derivative album labels and visual comparison" },
        { label: "Research limit", value: "Handwriting and facial resemblance are consistent, not conclusive identifications." }
      ],
      transcript: {
        kind: "table",
        columns: ["Comparison", "Result", "Limit"],
        rows: [
          ["Verso hand vs Clara labels", "Six letter-form features consistent", "No signature on verso"],
          ["Violet pencil stock", "Available after 1928", "Dates annotation, not photograph"],
          ["Figure 1 vs Maeve portrait", "Consistent", "Low facial detail"],
          ["Figure 2 vs Samuel portrait", "Consistent", "Low facial detail"],
          ["Figure 3 vs Jonah portrait", "Consistent", "Low facial detail"]
        ]
      },
      clueIds: ["verso-postdates-image", "clara-probable-annotator", "portrait-match-provisional"]
    }
  ],
  notebookClues: [
    {
      id: "cropped-ar-ambiguous",
      label: "Both North Star and Harbor Star can leave the cropped letters ‘AR,’ so the sign fragment alone cannot identify the place.",
      recordIds: ["harbor-photo-recto", "north-star-catalog-1906", "lantern-harbor-directory-1908"]
    },
    {
      id: "northstar-feature-cluster",
      label: "North Star matches the photograph’s complete awning, twelve-lamp rack, and sign-feature cluster rather than one isolated letter pair.",
      recordIds: ["harbor-photo-recto", "north-star-catalog-1906"]
    },
    {
      id: "seal-register-lookup",
      label: "The photographed diamond + II mark maps to Northstar Cove only from September through November 1906.",
      recordIds: ["harbor-photo-recto", "harbor-seal-register-1904-1908"]
    },
    {
      id: "lantern-rival-conflict",
      label: "Harbor Star is plausible by name, but its alternating awning and triangle + II rack conflict with the photograph.",
      recordIds: ["harbor-seal-register-1904-1908", "lantern-harbor-directory-1908"]
    },
    {
      id: "verso-postdates-image",
      label: "The violet stock was unavailable until after 1928, so the verso note is a later interpretation rather than a contemporary caption.",
      recordIds: ["harbor-photo-verso", "clara-comparison-workbook-1933"]
    },
    {
      id: "clara-probable-annotator",
      label: "Six handwriting features are consistent with Clara’s 1930s labels, but the unsigned note leaves the attribution probable.",
      recordIds: ["harbor-photo-verso", "clara-comparison-workbook-1933"]
    },
    {
      id: "portrait-match-provisional",
      label: "The three figures are consistent with Maeve, Samuel, and Jonah, but image quality cannot prove their identities.",
      recordIds: ["harbor-photo-recto", "clara-comparison-workbook-1933"]
    },
    {
      id: "bounded-negative",
      label: "North Star’s absence from a partial 1908 subscriber directory is weak negative evidence, not proof it never operated elsewhere.",
      recordIds: ["lantern-harbor-directory-1908"]
    }
  ],
  questions: [
    {
      id: "conclusion",
      prompt: "What identification is strongest after comparing both harbor candidates?",
      points: 40,
      pickCount: 1,
      options: [
        { id: "northstar-1906", label: "The scene most likely shows North Star Chandlery in Northstar Cove during late 1906; the people remain tentative." },
        { id: "lantern-1908", label: "The cropped sign and western-lamp note favor Harbor Star Outfitters in Lantern Bay around 1908; the people remain tentative." },
        { id: "clara-1930s", label: "The violet caption favors a post-1928 date, with Clara documenting an earlier-looking harbor setting for the family album." },
        { id: "not-sure", label: "I’m not sure yet." }
      ],
      answerOptionIds: ["northstar-1906"],
      explanation: "The full scene-feature cluster matches North Star, and the independent seal lookup narrows the place and season. The later note dates only the annotation; portrait resemblance remains provisional."
    },
    {
      id: "evidence",
      prompt: "Which two correlations best locate and date the photograph?",
      points: 40,
      pickCount: 2,
      options: [
        { id: "feature-cluster", label: "The awning sequence, twelve-lamp rack, and sign layout collectively match the North Star catalog image." },
        { id: "cropped-ar", label: "The surviving AR letters and harbor setting narrow the scene to the two named waterfront businesses." },
        { id: "violet-note", label: "The violet note connects the image to western lamp work and to Clara’s later album labels." },
        { id: "seal-window", label: "Diamond + II maps independently to Northstar Cove during September through November 1906." },
        { id: "not-sure", label: "I’m not sure which clues matter most." }
      ],
      answerOptionIds: ["feature-cluster", "seal-window"],
      explanation: "A multi-feature visual match supplies the candidate business, while the official symbol register independently supplies place and a bounded date range. The cropped letters and later note are ambiguous."
    },
    {
      id: "caution",
      prompt: "Which limitation must remain attached to the caption?",
      points: 20,
      pickCount: 1,
      options: [
        { id: "absence-proves-none", label: "Keep Lantern Bay equally likely because the partial 1908 directory does not establish where North Star operated in 1906." },
        { id: "place-stronger-than-people", label: "State place and season with stronger confidence than the people, annotator, or event described on the later verso." },
        { id: "not-sure", label: "I’m not sure what to flag." }
      ],
      answerOptionIds: ["place-stronger-than-people"],
      explanation: "The evidence has different strengths for place, date, annotator, and people. A careful caption reports those conclusions separately."
    }
  ]
};
