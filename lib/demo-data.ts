import type { DnaMatch, PersonSummary, ResearchCase } from "./models";
import { createDnaConnectionHypothesis, scoreDnaMatch } from "./dna";

export const demoFictionNotice =
  "Fictional demo archive: every name, date, place, record, photograph, story, and DNA match in this workspace was invented for Kin Resolve. No detail represents a real person or family.";

const demoPersonDrafts: PersonSummary[] = [
  {
    id: "p-nora-hartwell",
    slug: "nora-elise-hartwell",
    displayName: "Nora Elise Hartwell",
    givenName: "Nora Elise",
    surname: "Hartwell",
    birthDate: "3 Oct 1889",
    birthPlace: "Lantern Bay, Wisconsin",
    deathDate: "9 Jun 1968",
    deathPlace: "Lantern Bay, Wisconsin",
    sex: "F",
    livingStatus: "deceased",
    privacy: "public",
    published: true,
    relatives: ["p-elias-hartwell", "p-amalia-bellandi", "p-samuel-mercer", "p-clara-mercer", "p-tobias-mercer"],
    notes: `${demoFictionNotice} Nora kept the household journal that calls the blue memory box “Amalia's tin.” She wrote that Samuel arrived in 1907 with a folded passenger notice and a harbor photograph, then marked unverified family stories with tiny lanterns.`,
    facts: [
      {
        id: "fact-nora-birth",
        type: "BIRT",
        date: "3 Oct 1889",
        place: "Lantern Bay, Wisconsin",
        source: "Fictional Lantern Bay civil register",
        confidence: 0.94,
        privacy: "public"
      },
      {
        id: "fact-nora-marriage",
        type: "MARR",
        date: "19 Oct 1909",
        place: "Lantern Bay, Wisconsin",
        source: "Fictional Lantern Bay marriage ledger",
        confidence: 0.9,
        privacy: "public"
      },
      {
        id: "fact-nora-residence",
        type: "RESI",
        date: "1921",
        place: "Lantern Bay, Wisconsin",
        source: "Fictional Lantern Bay household directory",
        confidence: 0.82,
        privacy: "public"
      },
      {
        id: "fact-nora-death",
        type: "DEAT",
        date: "9 Jun 1968",
        place: "Lantern Bay, Wisconsin",
        source: "Fictional Lantern Bay memorial register",
        confidence: 0.91,
        privacy: "public"
      }
    ]
  },
  {
    id: "p-samuel-mercer",
    slug: "samuel-rowan-mercer",
    displayName: "Samuel Rowan Mercer",
    givenName: "Samuel Rowan",
    surname: "Mercer",
    birthDate: "18 Feb 1886",
    birthPlace: "Northstar Cove, Nova Scotia",
    deathDate: "21 Nov 1957",
    deathPlace: "Lantern Bay, Wisconsin",
    sex: "M",
    livingStatus: "deceased",
    privacy: "private",
    published: false,
    relatives: ["p-jonah-mercer", "p-maeve-mercer", "p-nora-hartwell", "p-clara-mercer", "p-tobias-mercer"],
    notes: `${demoFictionNotice} Family lore says Samuel arrived in 1907 carrying a folded passenger notice and a harbor photograph, and refused to explain why one harbor list called him Samuel March. He repaired boat lanterns and carved a small compass rose beneath every finished base.`,
    facts: [
      {
        id: "fact-samuel-birth",
        type: "BIRT",
        date: "18 Feb 1886",
        place: "Northstar Cove, Nova Scotia",
        source: "Fictional Northstar Cove birth ledger",
        confidence: 0.88,
        privacy: "private"
      },
      {
        id: "fact-samuel-arrival",
        type: "IMMI",
        date: "4 May 1907",
        place: "Lantern Bay, Wisconsin",
        value: "Possibly recorded as Samuel March",
        source: "Fictional Lantern Bay passenger list",
        confidence: 0.56,
        privacy: "private"
      },
      {
        id: "fact-samuel-marriage",
        type: "MARR",
        date: "19 Oct 1909",
        place: "Lantern Bay, Wisconsin",
        source: "Fictional Lantern Bay marriage ledger",
        confidence: 0.9,
        privacy: "private"
      },
      {
        id: "fact-samuel-death",
        type: "DEAT",
        date: "21 Nov 1957",
        place: "Lantern Bay, Wisconsin",
        source: "Fictional Lantern Bay memorial register",
        confidence: 0.89,
        privacy: "private"
      }
    ]
  },
  {
    id: "p-amalia-bellandi",
    slug: "amalia-rose-bellandi",
    displayName: "Amalia Rose Bellandi",
    givenName: "Amalia Rose",
    surname: "Bellandi",
    birthDate: "7 Jul 1861",
    birthPlace: "Ceraluna Alta, Italy",
    deathDate: "14 Jan 1934",
    deathPlace: "Lantern Bay, Wisconsin",
    sex: "F",
    livingStatus: "deceased",
    privacy: "private",
    published: false,
    relatives: ["p-luca-bellandi", "p-mira-solari", "p-elias-hartwell", "p-nora-hartwell"],
    notes: `${demoFictionNotice} Amalia told stories in which Ceraluna Alta's bells could be heard across an entire valley. Her recipe notebook records her assembling the blue memory tin in 1922 from Samuel's two old papers and later family keepsakes.`,
    facts: [
      {
        id: "fact-amalia-birth",
        type: "BIRT",
        date: "7 Jul 1861",
        place: "Ceraluna Alta, Italy",
        source: "Fictional Ceraluna Alta parish register",
        confidence: 0.63,
        privacy: "private"
      },
      {
        id: "fact-amalia-arrival",
        type: "IMMI",
        date: "2 Apr 1883",
        place: "Lantern Bay, Wisconsin",
        source: "Fictional Lantern Bay arrivals ledger",
        confidence: 0.71,
        privacy: "private"
      },
      {
        id: "fact-amalia-marriage",
        type: "MARR",
        date: "22 Sep 1885",
        place: "Lantern Bay, Wisconsin",
        source: "Fictional Lantern Bay marriage ledger",
        confidence: 0.87,
        privacy: "private"
      },
      {
        id: "fact-amalia-death",
        type: "DEAT",
        date: "14 Jan 1934",
        place: "Lantern Bay, Wisconsin",
        source: "Fictional Lantern Bay memorial register",
        confidence: 0.84,
        privacy: "private"
      }
    ]
  },
  {
    id: "p-elias-hartwell",
    slug: "elias-thorne-hartwell",
    displayName: "Elias Thorne Hartwell",
    givenName: "Elias Thorne",
    surname: "Hartwell",
    birthDate: "4 Dec 1856",
    birthPlace: "Northstar Cove, Nova Scotia",
    deathDate: "30 Aug 1926",
    deathPlace: "Lantern Bay, Wisconsin",
    sex: "M",
    livingStatus: "deceased",
    privacy: "private",
    published: false,
    relatives: ["p-orson-hartwell", "p-lydia-thorne", "p-amalia-bellandi", "p-nora-hartwell"],
    notes: `${demoFictionNotice} Elias was said to recognize every working vessel by the rhythm of its harbor bell. A fictional dock payroll places him in Lantern Bay before Amalia arrived.`,
    facts: [
      {
        id: "fact-elias-birth",
        type: "BIRT",
        date: "4 Dec 1856",
        place: "Northstar Cove, Nova Scotia",
        source: "Fictional Northstar Cove chapel register",
        confidence: 0.76,
        privacy: "private"
      },
      {
        id: "fact-elias-residence",
        type: "RESI",
        date: "1882",
        place: "Lantern Bay, Wisconsin",
        source: "Fictional Lantern Bay dock payroll",
        confidence: 0.79,
        privacy: "private"
      },
      {
        id: "fact-elias-death",
        type: "DEAT",
        date: "30 Aug 1926",
        place: "Lantern Bay, Wisconsin",
        source: "Fictional Lantern Bay memorial register",
        confidence: 0.85,
        privacy: "private"
      }
    ]
  },
  {
    id: "p-clara-mercer",
    slug: "clara-juniper-mercer",
    displayName: "Clara Juniper Mercer",
    givenName: "Clara Juniper",
    surname: "Mercer",
    birthDate: "11 Mar 1912",
    birthPlace: "Lantern Bay, Wisconsin",
    deathDate: "5 May 1998",
    deathPlace: "Lantern Bay, Wisconsin",
    sex: "F",
    livingStatus: "deceased",
    privacy: "private",
    published: false,
    relatives: ["p-nora-hartwell", "p-samuel-mercer", "p-tobias-mercer"],
    notes: `${demoFictionNotice} Clara wrote labels for the family photographs in violet ink, but left the harbor photograph unnamed. A late note says only: “Ask Tobias about the second Samuel.”`,
    facts: [
      {
        id: "fact-clara-birth",
        type: "BIRT",
        date: "11 Mar 1912",
        place: "Lantern Bay, Wisconsin",
        source: "Fictional Lantern Bay civil register",
        confidence: 0.93,
        privacy: "private"
      },
      {
        id: "fact-clara-residence",
        type: "RESI",
        date: "1934",
        place: "Lantern Bay, Wisconsin",
        source: "Fictional Lantern Bay household directory",
        confidence: 0.81,
        privacy: "private"
      },
      {
        id: "fact-clara-death",
        type: "DEAT",
        date: "5 May 1998",
        place: "Lantern Bay, Wisconsin",
        source: "Fictional Lantern Bay memorial register",
        confidence: 0.9,
        privacy: "private"
      }
    ]
  },
  {
    id: "p-tobias-mercer",
    slug: "tobias-bell-mercer",
    displayName: "Tobias Bell Mercer",
    givenName: "Tobias Bell",
    surname: "Mercer",
    birthDate: "28 Sep 1915",
    birthPlace: "Lantern Bay, Wisconsin",
    deathDate: "4 Feb 1984",
    deathPlace: "Lantern Bay, Wisconsin",
    sex: "M",
    livingStatus: "deceased",
    privacy: "private",
    published: false,
    relatives: ["p-nora-hartwell", "p-samuel-mercer", "p-clara-mercer"],
    notes: `${demoFictionNotice} Tobias inherited Samuel's repair bench and the blue tin. His inventory lists a brass key, a folded passenger notice, and “the photograph nobody agrees about.”`,
    facts: [
      {
        id: "fact-tobias-birth",
        type: "BIRT",
        date: "28 Sep 1915",
        place: "Lantern Bay, Wisconsin",
        source: "Fictional Lantern Bay civil register",
        confidence: 0.93,
        privacy: "private"
      },
      {
        id: "fact-tobias-occupation",
        type: "OCCU",
        date: "1940",
        place: "Lantern Bay, Wisconsin",
        value: "Harbor instrument repairer",
        source: "Fictional Lantern Bay trade directory",
        confidence: 0.78,
        privacy: "private"
      },
      {
        id: "fact-tobias-death",
        type: "DEAT",
        date: "4 Feb 1984",
        place: "Lantern Bay, Wisconsin",
        confidence: 0.89,
        privacy: "private"
      }
    ]
  },
  {
    id: "p-maeve-mercer",
    slug: "maeve-lenora-rowan-mercer",
    displayName: "Maeve Lenora Rowan Mercer",
    givenName: "Maeve Lenora",
    surname: "Mercer",
    birthDate: "6 May 1863",
    birthPlace: "Northstar Cove, Nova Scotia",
    deathDate: "2 Apr 1941",
    deathPlace: "Northstar Cove, Nova Scotia",
    sex: "F",
    livingStatus: "deceased",
    privacy: "private",
    published: false,
    relatives: ["p-declan-rowan", "p-eileen-pike", "p-jonah-mercer", "p-samuel-mercer"],
    notes: `${demoFictionNotice} Maeve's surviving fictional letters describe Samuel as restless and mention that he practiced signing both “Mercer” and “March” before leaving Northstar Cove.`,
    facts: [
      {
        id: "fact-maeve-birth",
        type: "BIRT",
        date: "6 May 1863",
        place: "Northstar Cove, Nova Scotia",
        source: "Fictional Northstar Cove birth ledger",
        confidence: 0.83,
        privacy: "private"
      },
      {
        id: "fact-maeve-marriage",
        type: "MARR",
        date: "24 Jun 1883",
        place: "Northstar Cove, Nova Scotia",
        source: "Fictional Northstar Cove chapel register",
        confidence: 0.86,
        privacy: "private"
      },
      {
        id: "fact-maeve-death",
        type: "DEAT",
        date: "2 Apr 1941",
        place: "Northstar Cove, Nova Scotia",
        source: "Fictional Northstar Cove memorial register",
        confidence: 0.87,
        privacy: "private"
      }
    ]
  },
  {
    id: "p-jonah-mercer",
    slug: "jonah-silas-mercer",
    displayName: "Jonah Silas Mercer",
    givenName: "Jonah Silas",
    surname: "Mercer",
    birthDate: "9 Jan 1859",
    birthPlace: "Northstar Cove, Nova Scotia",
    deathDate: "17 Oct 1911",
    deathPlace: "Northstar Cove, Nova Scotia",
    sex: "M",
    livingStatus: "deceased",
    privacy: "private",
    published: false,
    relatives: ["p-micah-mercer", "p-eliza-fenwick", "p-maeve-mercer", "p-samuel-mercer"],
    notes: `${demoFictionNotice} Jonah kept fictional tide tables filled with initials. One page for May 1907 contains “S.M. west” beside a sketch of a blue square.`,
    facts: [
      {
        id: "fact-jonah-birth",
        type: "BIRT",
        date: "9 Jan 1859",
        place: "Northstar Cove, Nova Scotia",
        source: "Fictional Northstar Cove birth ledger",
        confidence: 0.8,
        privacy: "private"
      },
      {
        id: "fact-jonah-occupation",
        type: "OCCU",
        date: "1898",
        place: "Northstar Cove, Nova Scotia",
        value: "Harbor signal keeper",
        source: "Fictional Northstar Cove harbor payroll",
        confidence: 0.77,
        privacy: "private"
      },
      {
        id: "fact-jonah-death",
        type: "DEAT",
        date: "17 Oct 1911",
        place: "Northstar Cove, Nova Scotia",
        source: "Fictional Northstar Cove memorial register",
        confidence: 0.85,
        privacy: "private"
      }
    ]
  },
  {
    id: "p-orson-hartwell",
    slug: "orson-hale-hartwell",
    displayName: "Orson Hale Hartwell",
    givenName: "Orson Hale",
    surname: "Hartwell",
    birthDate: "14 Apr 1825",
    birthPlace: "Northstar Cove, Nova Scotia",
    deathDate: "3 Sep 1899",
    deathPlace: "Northstar Cove, Nova Scotia",
    sex: "M",
    livingStatus: "deceased",
    privacy: "public",
    published: true,
    relatives: ["p-lydia-thorne", "p-elias-hartwell"],
    notes: `${demoFictionNotice} Orson's invented harbor ledger records changing fog signals and a family habit of sketching a compass rose beside uncertain entries.`,
    facts: [
      {
        id: "fact-orson-birth",
        type: "BIRT",
        date: "14 Apr 1825",
        place: "Northstar Cove, Nova Scotia",
        source: "Fictional Northstar Cove chapel register",
        confidence: 0.81,
        privacy: "public"
      },
      {
        id: "fact-orson-marriage",
        type: "MARR",
        date: "2 Nov 1851",
        place: "Northstar Cove, Nova Scotia",
        source: "Fictional Northstar Cove chapel register",
        confidence: 0.84,
        privacy: "public"
      },
      {
        id: "fact-orson-death",
        type: "DEAT",
        date: "3 Sep 1899",
        place: "Northstar Cove, Nova Scotia",
        source: "Fictional Northstar Cove memorial register",
        confidence: 0.86,
        privacy: "public"
      }
    ]
  },
  {
    id: "p-lydia-thorne",
    slug: "lydia-anne-thorne",
    displayName: "Lydia Anne Thorne",
    givenName: "Lydia Anne",
    surname: "Thorne",
    birthDate: "8 Jan 1829",
    birthPlace: "Northstar Cove, Nova Scotia",
    deathDate: "11 Mar 1907",
    deathPlace: "Lantern Bay, Wisconsin",
    sex: "F",
    livingStatus: "deceased",
    privacy: "public",
    published: true,
    relatives: ["p-orson-hartwell", "p-elias-hartwell"],
    notes: `${demoFictionNotice} Lydia's fictional letters describe sending Elias west with a stitched signal flag and a list of Northstar Cove relatives to remember.`,
    facts: [
      {
        id: "fact-lydia-birth",
        type: "BIRT",
        date: "8 Jan 1829",
        place: "Northstar Cove, Nova Scotia",
        source: "Fictional Northstar Cove birth ledger",
        confidence: 0.82,
        privacy: "public"
      },
      {
        id: "fact-lydia-marriage",
        type: "MARR",
        date: "2 Nov 1851",
        place: "Northstar Cove, Nova Scotia",
        source: "Fictional Northstar Cove chapel register",
        confidence: 0.84,
        privacy: "public"
      },
      {
        id: "fact-lydia-death",
        type: "DEAT",
        date: "11 Mar 1907",
        place: "Lantern Bay, Wisconsin",
        source: "Fictional Lantern Bay memorial register",
        confidence: 0.8,
        privacy: "public"
      }
    ]
  },
  {
    id: "p-luca-bellandi",
    slug: "luca-matteo-bellandi",
    displayName: "Luca Matteo Bellandi",
    givenName: "Luca Matteo",
    surname: "Bellandi",
    birthDate: "2 Dec 1828",
    birthPlace: "Ceraluna Alta, Italy",
    deathDate: "8 Aug 1902",
    deathPlace: "Ceraluna Alta, Italy",
    sex: "M",
    livingStatus: "deceased",
    privacy: "public",
    published: true,
    relatives: ["p-mira-solari", "p-amalia-bellandi"],
    notes: `${demoFictionNotice} Luca appears in an invented parish household series that anchors the Bellandi sibling reconstruction without resolving Amalia's later migration route.`,
    facts: [
      {
        id: "fact-luca-birth",
        type: "BIRT",
        date: "2 Dec 1828",
        place: "Ceraluna Alta, Italy",
        source: "Fictional Ceraluna Alta parish register",
        confidence: 0.74,
        privacy: "public"
      },
      {
        id: "fact-luca-marriage",
        type: "MARR",
        date: "12 Feb 1857",
        place: "Ceraluna Alta, Italy",
        source: "Fictional Ceraluna Alta parish register",
        confidence: 0.79,
        privacy: "public"
      },
      {
        id: "fact-luca-death",
        type: "DEAT",
        date: "8 Aug 1902",
        place: "Ceraluna Alta, Italy",
        source: "Fictional Ceraluna Alta civil register",
        confidence: 0.78,
        privacy: "public"
      }
    ]
  },
  {
    id: "p-mira-solari",
    slug: "mira-elisabetta-solari",
    displayName: "Mira Elisabetta Solari",
    givenName: "Mira Elisabetta",
    surname: "Solari",
    birthDate: "16 Jun 1834",
    birthPlace: "Ceraluna Alta, Italy",
    deathDate: "26 Jan 1911",
    deathPlace: "Ceraluna Alta, Italy",
    sex: "F",
    livingStatus: "deceased",
    privacy: "public",
    published: true,
    relatives: ["p-luca-bellandi", "p-amalia-bellandi"],
    notes: `${demoFictionNotice} Mira's invented household entry names Rosa, Amalia, and Ettore in age order and supplies one documented link in the Solari-Bellandi branch.`,
    facts: [
      {
        id: "fact-mira-birth",
        type: "BIRT",
        date: "16 Jun 1834",
        place: "Ceraluna Alta, Italy",
        source: "Fictional Ceraluna Alta parish register",
        confidence: 0.76,
        privacy: "public"
      },
      {
        id: "fact-mira-marriage",
        type: "MARR",
        date: "12 Feb 1857",
        place: "Ceraluna Alta, Italy",
        source: "Fictional Ceraluna Alta parish register",
        confidence: 0.79,
        privacy: "public"
      },
      {
        id: "fact-mira-death",
        type: "DEAT",
        date: "26 Jan 1911",
        place: "Ceraluna Alta, Italy",
        source: "Fictional Ceraluna Alta civil register",
        confidence: 0.77,
        privacy: "public"
      }
    ]
  },
  {
    id: "p-micah-mercer",
    slug: "micah-amos-mercer",
    displayName: "Micah Amos Mercer",
    givenName: "Micah Amos",
    surname: "Mercer",
    birthDate: "30 May 1827",
    birthPlace: "Northstar Cove, Nova Scotia",
    deathDate: "12 Feb 1900",
    deathPlace: "Northstar Cove, Nova Scotia",
    sex: "M",
    livingStatus: "deceased",
    privacy: "public",
    published: true,
    relatives: ["p-eliza-fenwick", "p-jonah-mercer"],
    notes: `${demoFictionNotice} Micah's fictional vessel accounts contain the earliest Mercer entries in the Northstar Cove branch and several unexplained name abbreviations.`,
    facts: [
      {
        id: "fact-micah-birth",
        type: "BIRT",
        date: "30 May 1827",
        place: "Northstar Cove, Nova Scotia",
        source: "Fictional Northstar Cove birth ledger",
        confidence: 0.8,
        privacy: "public"
      },
      {
        id: "fact-micah-marriage",
        type: "MARR",
        date: "17 Jul 1854",
        place: "Northstar Cove, Nova Scotia",
        source: "Fictional Northstar Cove chapel register",
        confidence: 0.85,
        privacy: "public"
      },
      {
        id: "fact-micah-death",
        type: "DEAT",
        date: "12 Feb 1900",
        place: "Northstar Cove, Nova Scotia",
        source: "Fictional Northstar Cove memorial register",
        confidence: 0.84,
        privacy: "public"
      }
    ]
  },
  {
    id: "p-eliza-fenwick",
    slug: "eliza-fern-fenwick",
    displayName: "Eliza Fern Fenwick",
    givenName: "Eliza Fern",
    surname: "Fenwick",
    birthDate: "21 Sep 1831",
    birthPlace: "Northstar Cove, Nova Scotia",
    deathDate: "7 Jul 1909",
    deathPlace: "Northstar Cove, Nova Scotia",
    sex: "F",
    livingStatus: "deceased",
    privacy: "public",
    published: true,
    relatives: ["p-micah-mercer", "p-jonah-mercer"],
    notes: `${demoFictionNotice} Eliza's invented almanac records family birthdays beside tide marks, giving the Mercer branch a second independent chronology.`,
    facts: [
      {
        id: "fact-eliza-birth",
        type: "BIRT",
        date: "21 Sep 1831",
        place: "Northstar Cove, Nova Scotia",
        source: "Fictional Northstar Cove birth ledger",
        confidence: 0.81,
        privacy: "public"
      },
      {
        id: "fact-eliza-marriage",
        type: "MARR",
        date: "17 Jul 1854",
        place: "Northstar Cove, Nova Scotia",
        source: "Fictional Northstar Cove chapel register",
        confidence: 0.85,
        privacy: "public"
      },
      {
        id: "fact-eliza-death",
        type: "DEAT",
        date: "7 Jul 1909",
        place: "Northstar Cove, Nova Scotia",
        source: "Fictional Northstar Cove memorial register",
        confidence: 0.83,
        privacy: "public"
      }
    ]
  },
  {
    id: "p-declan-rowan",
    slug: "declan-hugh-rowan",
    displayName: "Declan Hugh Rowan",
    givenName: "Declan Hugh",
    surname: "Rowan",
    birthDate: "5 Nov 1830",
    birthPlace: "Northstar Cove, Nova Scotia",
    deathDate: "22 Dec 1904",
    deathPlace: "Northstar Cove, Nova Scotia",
    sex: "M",
    livingStatus: "deceased",
    privacy: "public",
    published: true,
    relatives: ["p-eileen-pike", "p-maeve-mercer"],
    notes: `${demoFictionNotice} Declan's invented chapel and harbor entries establish the Rowan household later referenced by Maeve's letters and the demo DNA case.`,
    facts: [
      {
        id: "fact-declan-birth",
        type: "BIRT",
        date: "5 Nov 1830",
        place: "Northstar Cove, Nova Scotia",
        source: "Fictional Northstar Cove birth ledger",
        confidence: 0.82,
        privacy: "public"
      },
      {
        id: "fact-declan-marriage",
        type: "MARR",
        date: "4 Oct 1858",
        place: "Northstar Cove, Nova Scotia",
        source: "Fictional Northstar Cove chapel register",
        confidence: 0.86,
        privacy: "public"
      },
      {
        id: "fact-declan-death",
        type: "DEAT",
        date: "22 Dec 1904",
        place: "Northstar Cove, Nova Scotia",
        source: "Fictional Northstar Cove memorial register",
        confidence: 0.84,
        privacy: "public"
      }
    ]
  },
  {
    id: "p-eileen-pike",
    slug: "eileen-grace-pike",
    displayName: "Eileen Grace Pike",
    givenName: "Eileen Grace",
    surname: "Pike",
    birthDate: "13 Mar 1837",
    birthPlace: "Northstar Cove, Nova Scotia",
    deathDate: "29 Aug 1915",
    deathPlace: "Northstar Cove, Nova Scotia",
    sex: "F",
    livingStatus: "deceased",
    privacy: "public",
    published: true,
    relatives: ["p-declan-rowan", "p-maeve-mercer"],
    notes: `${demoFictionNotice} Eileen's invented household notes distinguish the Rowan daughters by full name, preserving the branch that later led to Maeve and Elowen.`,
    facts: [
      {
        id: "fact-eileen-birth",
        type: "BIRT",
        date: "13 Mar 1837",
        place: "Northstar Cove, Nova Scotia",
        source: "Fictional Northstar Cove birth ledger",
        confidence: 0.82,
        privacy: "public"
      },
      {
        id: "fact-eileen-marriage",
        type: "MARR",
        date: "4 Oct 1858",
        place: "Northstar Cove, Nova Scotia",
        source: "Fictional Northstar Cove chapel register",
        confidence: 0.86,
        privacy: "public"
      },
      {
        id: "fact-eileen-death",
        type: "DEAT",
        date: "29 Aug 1915",
        place: "Northstar Cove, Nova Scotia",
        source: "Fictional Northstar Cove memorial register",
        confidence: 0.83,
        privacy: "public"
      }
    ]
  }
];

// Every profile and fact in the fictional fixture is safe for the curated
// public-family surface. Private research material lives in cases, source
// detail, DNA, and analysis records rather than on these profiles.
export const demoPeople: PersonSummary[] = demoPersonDrafts.map((person) => ({
  ...person,
  livingStatus: "deceased",
  privacy: "public",
  published: true,
  facts: person.facts.map((fact) => ({ ...fact, privacy: "public" }))
}));

export const demoDnaMatches: DnaMatch[] = [
  {
    id: "dna-m-alder",
    displayName: "M. Alder (fictional)",
    totalCm: 86,
    longestSegmentCm: 12.6,
    sharedDnaPercent: 1.15,
    predictedRelationship: "invented estimate: likely 3C or 3C1R",
    side: "paternal",
    treeStatus: "partial",
    surnames: ["Mercer", "March", "Rowan", "Hartwell"],
    places: ["Northstar Cove, Nova Scotia", "Lantern Bay, Wisconsin"],
    sharedMatches: ["T. Pike (fictional)"],
    notes: `${demoFictionNotice} This invented match has a partial tree ending with an unnamed sibling of Maeve Rowan Mercer.`,
    triageStatus: "high_priority"
  },
  {
    id: "dna-t-pike",
    displayName: "T. Pike (fictional)",
    totalCm: 54,
    longestSegmentCm: 9.4,
    sharedDnaPercent: 0.72,
    predictedRelationship: "invented estimate: likely 4C",
    side: "paternal",
    treeStatus: "public",
    surnames: ["Mercer", "Rowan"],
    places: ["Northstar Cove, Nova Scotia"],
    sharedMatches: ["M. Alder (fictional)"],
    notes: `${demoFictionNotice} This invented match's equally fictional tree includes a Rowan household in Northstar Cove.`,
    triageStatus: "triaged"
  },
  {
    id: "dna-r-solari",
    displayName: "R. Solari (fictional)",
    totalCm: 37,
    longestSegmentCm: 7.1,
    sharedDnaPercent: 0.5,
    predictedRelationship: "invented estimate: likely 4C1R",
    side: "maternal",
    treeStatus: "none",
    surnames: ["Bellandi", "Solari"],
    places: ["Ceraluna Alta, Italy", "Lantern Bay, Wisconsin"],
    sharedMatches: [],
    notes: `${demoFictionNotice} This invented match has no usable tree; its profile names Ceraluna Alta and Bellandi, clues that still require documentary corroboration.`,
    triageStatus: "needs_review"
  }
];

export const demoDnaHypotheses = demoDnaMatches.map((match) => createDnaConnectionHypothesis(match, demoPeople));

export const demoCases: ResearchCase[] = [
  {
    id: "case-mercer-march-identity",
    title: "The Mercer–March passenger mystery",
    question: "Are Samuel Rowan Mercer and the passenger-list Samuel March the same fictional person?",
    status: "active",
    focus: "Samuel Rowan Mercer, 1907 arrival",
    privacy: "private",
    hypotheses: [
      {
        id: "hyp-mercer-march-same",
        statement: "Samuel March was Samuel Rowan Mercer recorded under a temporary or misunderstood surname.",
        confidence: 0.58,
        status: "open"
      },
      {
        id: "hyp-mercer-march-different",
        statement: "Samuel March was a separate traveler whose similar age and route are coincidental.",
        confidence: 0.31,
        status: "open"
      }
    ],
    evidence: [
      {
        id: "ev-fictional-passenger-list",
        title: "Fictional 1907 passenger list",
        type: "Passenger list",
        summary: "Lists Samuel March, age 21, traveling from Northstar Cove to Lantern Bay on 4 May 1907.",
        confidence: 0.72,
        linkedPersonId: "p-samuel-mercer"
      },
      {
        id: "ev-fictional-marriage-signature",
        title: "Fictional 1909 marriage signature",
        type: "Vital record",
        summary: "Samuel Mercer's 1909 signature has an unusually tall final stroke also visible in the passenger-list signature.",
        confidence: 0.68,
        linkedPersonId: "p-samuel-mercer"
      },
      {
        id: "ev-fictional-maeve-letter",
        title: "Fictional letter from Maeve Mercer",
        type: "Correspondence",
        summary: "A 1906 letter says Samuel practiced signing both Mercer and March, without explaining why.",
        confidence: 0.61,
        linkedPersonId: "p-maeve-mercer"
      }
    ],
    tasks: [
      {
        id: "task-compare-signatures",
        title: "Compare the passenger-list and marriage signatures",
        status: "doing",
        origin: "manual",
        priority: "high",
        guidance: "Record three specific letter-shape similarities and at least one difference before changing either identity hypothesis.",
        targetHypothesisId: "hyp-mercer-march-same",
        contextRefs: [
          { type: "case", id: "case-mercer-march-identity" },
          { type: "hypothesis", id: "hyp-mercer-march-same" },
          { type: "evidence", id: "ev-fictional-passenger-list" },
          { type: "evidence", id: "ev-fictional-marriage-signature" }
        ]
      },
      {
        id: "task-search-northstar-departures",
        title: "Search the fictional Northstar Cove departure ledger",
        status: "done",
        origin: "manual",
        priority: "normal",
        guidance: "Check the bounded April–May 1907 pages for Mercer and March variants.",
        targetHypothesisId: "hyp-mercer-march-same",
        contextRefs: [
          { type: "case", id: "case-mercer-march-identity" },
          { type: "hypothesis", id: "hyp-mercer-march-same" }
        ],
        outcomes: [
          {
            id: "outcome-northstar-departures",
            requestId: "demo-request-northstar-departures",
            type: "found",
            note: "The invented ledger contains one 'S. M—' departure on 1 May 1907, but the damaged surname is not conclusive.",
            searchScope: {
              repository: "Fictional Northstar Cove Archive",
              collection: "Harbor departure ledger",
              place: "Northstar Cove, Nova Scotia",
              dateRange: "1 Apr–31 May 1907",
              query: "Mercer, March, and M— surname variants"
            },
            actorId: "fictional-demo-researcher",
            actorName: "Demo Researcher",
            createdAt: "2026-06-02T14:30:00.000Z"
          }
        ],
        createdAt: "2026-06-02T13:00:00.000Z",
        completedAt: "2026-06-02T14:30:00.000Z",
        updatedAt: "2026-06-02T14:30:00.000Z"
      }
    ]
  },
  {
    id: "case-blue-tin",
    title: "What belonged in the blue tin?",
    question: "When was the fictional blue tin assembled, and which family member added each object?",
    status: "active",
    focus: "Blue tin artifact trail, 1907–1984",
    privacy: "private",
    hypotheses: [
      {
        id: "hyp-blue-tin-samuel",
        statement: "Samuel brought the blue tin and its original papers from Northstar Cove in 1907.",
        confidence: 0.4,
        status: "weakened",
        decisions: [
          {
            id: "decision-blue-tin-weakened",
            requestId: "demo-request-blue-tin-weakened",
            fromStatus: "open",
            toStatus: "weakened",
            statement: "Samuel brought the blue tin and its original papers from Northstar Cove in 1907.",
            reason: "A fictional receipt dated 1921 was folded beneath the older papers, so the surviving contents were assembled later.",
            contextRefs: [
              { type: "case", id: "case-blue-tin" },
              { type: "evidence", id: "ev-fictional-blue-tin-inventory" }
            ],
            actorId: "fictional-demo-researcher",
            actorName: "Demo Researcher",
            createdAt: "2026-06-03T10:15:00.000Z"
          }
        ]
      },
      {
        id: "hyp-blue-tin-amalia",
        statement: "Amalia assembled the tin as a family memory box in 1922.",
        confidence: 0.64,
        status: "supported"
      }
    ],
    evidence: [
      {
        id: "ev-fictional-blue-tin-inventory",
        title: "Fictional 1984 blue-tin inventory",
        type: "Artifact inventory",
        summary: "Tobias listed a brass key, a 1907 passenger notice, a 1921 repair receipt, violet thread, and an unidentified harbor photograph.",
        confidence: 0.81,
        linkedPersonId: "p-tobias-mercer"
      },
      {
        id: "ev-fictional-amalia-notebook",
        title: "Fictional Amalia Bellandi recipe notebook",
        type: "Family manuscript",
        summary: "A 1922 margin note says, 'Put Samuel's papers in the blue tin with Nora's photograph.'",
        confidence: 0.7,
        linkedPersonId: "p-amalia-bellandi"
      },
      {
        id: "ev-fictional-nora-journal",
        title: "Fictional 1922 journal entry by Nora Hartwell",
        type: "Family manuscript",
        summary: "Nora calls the box “Amalia's tin” and distinguishes the folded passenger notice and harbor photograph Samuel carried in 1907 from objects Amalia added later.",
        confidence: 0.76,
        linkedPersonId: "p-nora-hartwell"
      }
    ],
    tasks: [
      {
        id: "task-blue-tin-timeline",
        title: "Build an item-by-item blue-tin timeline",
        status: "todo",
        origin: "manual",
        priority: "high",
        guidance: "Create a dated row for each invented object, separate manufacture date from the date it may have entered the tin, and mark every inference.",
        targetHypothesisId: "hyp-blue-tin-amalia",
        contextRefs: [
          { type: "case", id: "case-blue-tin" },
          { type: "hypothesis", id: "hyp-blue-tin-amalia" },
          { type: "evidence", id: "ev-fictional-blue-tin-inventory" },
          { type: "evidence", id: "ev-fictional-amalia-notebook" },
          { type: "evidence", id: "ev-fictional-nora-journal" }
        ]
      },
      {
        id: "task-blue-tin-key",
        title: "Identify the fictional brass key's likely use",
        status: "todo",
        origin: "manual",
        priority: "normal",
        guidance: "Compare its dimensions with the invented repair-shop and harbor-lock catalogs; do not treat resemblance as identification.",
        contextRefs: [
          { type: "case", id: "case-blue-tin" },
          { type: "evidence", id: "ev-fictional-blue-tin-inventory" }
        ]
      },
      {
        id: "task-date-blue-tin-receipt",
        title: "Date the fictional repair receipt from the blue tin",
        status: "done",
        origin: "manual",
        priority: "normal",
        guidance: "Separate the receipt's printed date, paper watermark, and later fold marks.",
        targetHypothesisId: "hyp-blue-tin-samuel",
        contextRefs: [
          { type: "case", id: "case-blue-tin" },
          { type: "hypothesis", id: "hyp-blue-tin-samuel" },
          { type: "evidence", id: "ev-fictional-blue-tin-inventory" }
        ],
        outcomes: [
          {
            id: "outcome-blue-tin-receipt",
            requestId: "demo-request-blue-tin-receipt",
            type: "found",
            note: "The invented receipt is dated 8 February 1921, and its fold pattern matches the tin; it could not have been among contents carried in 1907.",
            searchScope: {
              repository: "Fictional Lantern Bay Archive",
              collection: "Harbor repair-shop receipt book",
              place: "Lantern Bay, Wisconsin",
              dateRange: "1920–1922",
              query: "Receipt number and paper watermark"
            },
            actorId: "fictional-demo-researcher",
            actorName: "Demo Researcher",
            createdAt: "2026-06-03T10:15:00.000Z"
          }
        ],
        createdAt: "2026-06-03T09:00:00.000Z",
        completedAt: "2026-06-03T10:15:00.000Z",
        updatedAt: "2026-06-03T10:15:00.000Z"
      },
      {
        id: "task-blue-tin-journal",
        title: "Transcribe Nora's fictional 1922 tin entry",
        status: "done",
        origin: "manual",
        priority: "normal",
        guidance: "Separate what Nora says Samuel carried from what she says Amalia placed in the tin.",
        targetHypothesisId: "hyp-blue-tin-amalia",
        contextRefs: [
          { type: "case", id: "case-blue-tin" },
          { type: "hypothesis", id: "hyp-blue-tin-amalia" },
          { type: "evidence", id: "ev-fictional-nora-journal" }
        ],
        outcomes: [
          {
            id: "outcome-blue-tin-journal",
            requestId: "demo-request-blue-tin-journal",
            type: "found",
            note: "The invented entry calls the box “Amalia's tin.” It says Samuel carried only a folded passenger notice and the harbor photograph in 1907; Amalia put them into the tin with later keepsakes in 1922.",
            searchScope: {
              repository: "Hartwell–Mercer Family Archive (fictional)",
              collection: "Nora Hartwell household journal",
              place: "Lantern Bay, Wisconsin",
              dateRange: "1922",
              query: "Amalia's tin, passenger notice, harbor photograph"
            },
            actorId: "fictional-demo-researcher",
            actorName: "Demo Researcher",
            createdAt: "2026-06-03T12:25:00.000Z"
          }
        ],
        createdAt: "2026-06-03T11:30:00.000Z",
        completedAt: "2026-06-03T12:25:00.000Z",
        updatedAt: "2026-06-03T12:25:00.000Z"
      }
    ]
  },
  {
    id: "case-harbor-photograph",
    title: "The unidentified harbor photograph",
    question: "Who appears in the fictional harbor photograph, and where and when was it taken?",
    status: "active",
    focus: "Three figures beside a lantern-repair stall",
    privacy: "sensitive",
    hypotheses: [
      {
        id: "hyp-photo-lantern-bay",
        statement: "The photograph shows Samuel and Nora in Lantern Bay between 1908 and 1911.",
        confidence: 0.29,
        status: "open"
      },
      {
        id: "hyp-photo-northstar-cove",
        statement: "The photograph predates Samuel's move and was taken in Northstar Cove with Maeve and Jonah Mercer.",
        confidence: 0.63,
        status: "open"
      }
    ],
    evidence: [
      {
        id: "ev-fictional-harbor-photo",
        title: "Fictional harbor photograph",
        type: "Photograph",
        summary: "An undated image shows three people, a striped awning, a lantern rack, and a partly obscured sign ending in 'AR'.",
        confidence: 0.67
      },
      {
        id: "ev-fictional-photo-verso",
        title: "Fictional photograph verso",
        type: "Annotation",
        summary: "Violet pencil reads 'the day the western lamp came home'; no names or date appear.",
        confidence: 0.59
      },
      {
        id: "ev-fictional-north-star-catalog",
        title: "Fictional North Star Chandlery autumn catalog",
        type: "Business catalog",
        summary: "The 1906 autumn issue from Northstar Cove shows the same diagonal awning stripes and a sign whose visible ending is 'STAR'.",
        confidence: 0.86
      },
      {
        id: "ev-fictional-lantern-inspection-seal",
        title: "Fictional 1906 lantern inspection seal register",
        type: "Harbor record",
        summary: "The rack's diamond inspection seal was issued only from September through November 1906 in Northstar Cove.",
        confidence: 0.79
      },
      {
        id: "ev-fictional-photo-comparison",
        title: "Fictional Mercer portrait comparison worksheet",
        type: "Research note",
        summary: "Independent ear, brow, and stance comparisons are consistent with Samuel, Maeve, and Jonah; image quality prevents a conclusive identification.",
        confidence: 0.64
      },
      {
        id: "ev-fictional-violet-pencil-study",
        title: "Fictional violet-pencil and handwriting study",
        type: "Forensic note",
        summary: "The pencil stock postdates 1928, and the lettering shares six features with Clara's labeled photographs from the 1930s, so the verso text is later than the image.",
        confidence: 0.83,
        linkedPersonId: "p-clara-mercer"
      }
    ],
    tasks: [
      {
        id: "task-photo-awning",
        title: "Compare the striped awning with fictional harbor directories",
        status: "done",
        origin: "manual",
        priority: "high",
        guidance: "Check dated business illustrations from both fictional harbors and record negative searches with exact volumes and years.",
        targetHypothesisId: "hyp-photo-northstar-cove",
        contextRefs: [
          { type: "case", id: "case-harbor-photograph" },
          { type: "hypothesis", id: "hyp-photo-northstar-cove" },
          { type: "evidence", id: "ev-fictional-harbor-photo" },
          { type: "evidence", id: "ev-fictional-north-star-catalog" }
        ],
        outcomes: [
          {
            id: "outcome-photo-awning",
            requestId: "demo-request-photo-awning",
            type: "found",
            note: "The fictional North Star Chandlery's autumn 1906 catalog matches the photograph's stripe order, lantern rack, and surviving 'STAR' letters. No equally specific match was found in the Lantern Bay set.",
            searchScope: {
              repository: "Fictional Northstar Cove Archive",
              collection: "North Star Chandlery illustrated catalogs",
              place: "Northstar Cove, Nova Scotia",
              dateRange: "1904–1908",
              query: "Striped awning, lantern rack, sign ending STAR"
            },
            actorId: "fictional-demo-researcher",
            actorName: "Demo Researcher",
            createdAt: "2026-06-07T15:10:00.000Z"
          }
        ],
        createdAt: "2026-06-07T13:20:00.000Z",
        completedAt: "2026-06-07T15:10:00.000Z",
        updatedAt: "2026-06-07T15:10:00.000Z"
      },
      {
        id: "task-photo-process",
        title: "Date the fictional photographic process",
        status: "done",
        origin: "manual",
        priority: "normal",
        guidance: "Describe paper, border, and visible harbor marks before assigning a bounded date range.",
        targetHypothesisId: "hyp-photo-northstar-cove",
        contextRefs: [
          { type: "case", id: "case-harbor-photograph" },
          { type: "hypothesis", id: "hyp-photo-northstar-cove" },
          { type: "evidence", id: "ev-fictional-harbor-photo" },
          { type: "evidence", id: "ev-fictional-lantern-inspection-seal" }
        ],
        outcomes: [
          {
            id: "outcome-photo-process",
            requestId: "demo-request-photo-process",
            type: "found",
            note: "Paper manufacture allows 1904–1908, while the visible Northstar Cove inspection seal narrows the scene to September–November 1906. The season is stronger than a precise day.",
            searchScope: {
              repository: "Fictional Northstar Cove Archive",
              collection: "Harbor inspection seal register and photographic-stock catalog",
              place: "Northstar Cove, Nova Scotia",
              dateRange: "1904–1908",
              query: "Diamond seal and photographic paper border"
            },
            actorId: "fictional-demo-researcher",
            actorName: "Demo Researcher",
            createdAt: "2026-06-08T11:45:00.000Z"
          }
        ],
        createdAt: "2026-06-08T09:30:00.000Z",
        completedAt: "2026-06-08T11:45:00.000Z",
        updatedAt: "2026-06-08T11:45:00.000Z"
      },
      {
        id: "task-photo-lantern-signs",
        title: "Search fictional Lantern Bay business signs ending in 'AR'",
        status: "done",
        origin: "manual",
        priority: "normal",
        guidance: "Search a bounded directory range and record the exact volumes even if nothing matches.",
        targetHypothesisId: "hyp-photo-lantern-bay",
        contextRefs: [
          { type: "case", id: "case-harbor-photograph" },
          { type: "hypothesis", id: "hyp-photo-lantern-bay" },
          { type: "evidence", id: "ev-fictional-harbor-photo" }
        ],
        outcomes: [
          {
            id: "outcome-photo-lantern-signs",
            requestId: "demo-request-photo-lantern-signs",
            type: "not_found",
            note: "No matching sign appears in the invented Lantern Bay directories searched. This bounded negative result does not by itself prove the photograph was taken elsewhere.",
            searchScope: {
              repository: "Fictional Lantern Bay Archive",
              collection: "Illustrated harbor business directories",
              place: "Lantern Bay, Wisconsin",
              dateRange: "1904–1916",
              query: "Striped awnings and business signs ending in AR"
            },
            actorId: "fictional-demo-researcher",
            actorName: "Demo Researcher",
            createdAt: "2026-06-04T16:40:00.000Z"
          }
        ],
        createdAt: "2026-06-04T14:00:00.000Z",
        completedAt: "2026-06-04T16:40:00.000Z",
        updatedAt: "2026-06-04T16:40:00.000Z"
      },
      {
        id: "task-photo-people-comparison",
        title: "Compare the three figures with fictional family portraits",
        status: "done",
        origin: "manual",
        priority: "normal",
        guidance: "Compare multiple independent features and preserve uncertainty caused by the photograph's low resolution.",
        targetHypothesisId: "hyp-photo-northstar-cove",
        contextRefs: [
          { type: "case", id: "case-harbor-photograph" },
          { type: "hypothesis", id: "hyp-photo-northstar-cove" },
          { type: "evidence", id: "ev-fictional-harbor-photo" },
          { type: "evidence", id: "ev-fictional-photo-comparison" }
        ],
        outcomes: [
          {
            id: "outcome-photo-people-comparison",
            requestId: "demo-request-photo-people-comparison",
            type: "inconclusive",
            note: "The left, center, and right figures align respectively with independently dated portraits of Maeve, Samuel, and Jonah on several features. Resolution is too low to treat facial resemblance alone as proof.",
            searchScope: {
              repository: "Hartwell–Mercer Family Archive (fictional)",
              collection: "Independently dated Mercer portraits",
              place: "Northstar Cove, Nova Scotia",
              dateRange: "1898–1907",
              query: "Maeve, Samuel, and Jonah portrait comparison"
            },
            actorId: "fictional-demo-researcher",
            actorName: "Demo Researcher",
            createdAt: "2026-06-09T14:35:00.000Z"
          }
        ],
        createdAt: "2026-06-09T12:10:00.000Z",
        completedAt: "2026-06-09T14:35:00.000Z",
        updatedAt: "2026-06-09T14:35:00.000Z"
      },
      {
        id: "task-photo-violet-annotation",
        title: "Determine when the violet verso note was added",
        status: "done",
        origin: "manual",
        priority: "normal",
        guidance: "Compare pencil composition and handwriting without assuming the annotation is contemporary with the photograph.",
        contextRefs: [
          { type: "case", id: "case-harbor-photograph" },
          { type: "evidence", id: "ev-fictional-photo-verso" },
          { type: "evidence", id: "ev-fictional-violet-pencil-study" }
        ],
        outcomes: [
          {
            id: "outcome-photo-violet-annotation",
            requestId: "demo-request-photo-violet-annotation",
            type: "found",
            note: "The fictional materials study dates the violet pencil after 1928 and finds Clara's characteristic open-topped A and hooked final e. The annotation is a later family interpretation, not a contemporary caption.",
            searchScope: {
              repository: "Hartwell–Mercer Family Archive (fictional)",
              collection: "Clara Mercer labeled photographs and pencil study",
              place: "Lantern Bay, Wisconsin",
              dateRange: "1928–1939",
              query: "Violet pencil stock and handwriting features"
            },
            actorId: "fictional-demo-researcher",
            actorName: "Demo Researcher",
            createdAt: "2026-06-10T10:50:00.000Z"
          }
        ],
        createdAt: "2026-06-10T09:05:00.000Z",
        completedAt: "2026-06-10T10:50:00.000Z",
        updatedAt: "2026-06-10T10:50:00.000Z"
      },
      {
        id: "task-photo-original-envelope",
        title: "Look for the photograph's original envelope or duplicate print",
        status: "todo",
        origin: "manual",
        priority: "high",
        guidance: "Search uncatalogued fictional albums for an independent caption before resolving the people in the image.",
        targetHypothesisId: "hyp-photo-northstar-cove",
        contextRefs: [
          { type: "case", id: "case-harbor-photograph" },
          { type: "hypothesis", id: "hyp-photo-northstar-cove" },
          { type: "evidence", id: "ev-fictional-harbor-photo" }
        ]
      }
    ]
  },
  {
    id: "case-bellandi-ceraluna-alta",
    title: "Amalia Bellandi's Ceraluna Alta origins",
    question: "Which fictional Ceraluna Alta household was Amalia Rose Bellandi born into?",
    status: "planning",
    focus: "Bellandi households, 1855–1870",
    privacy: "private",
    hypotheses: [
      {
        id: "hyp-amalia-bell-tower",
        statement: "Amalia is the seven-year-old 'Malia' in the fictional 1868 Bellandi bell-tower household list.",
        confidence: 0.68,
        status: "open"
      },
      {
        id: "hyp-amalia-namesake",
        statement: "The 1868 Malia Bellandi was a namesake cousin rather than Amalia Rose Bellandi.",
        confidence: 0.22,
        status: "open"
      }
    ],
    evidence: [
      {
        id: "ev-fictional-bellandi-sibling-register",
        title: "Fictional Ceraluna Alta Bellandi sibling register",
        type: "Parish register",
        summary: "Separate entries record Rosa in 1859, Amalia Rose on 7 July 1861, and Ettore in 1864 to the same fictional parents, Luca Bellandi and Mira Solari.",
        confidence: 0.88,
        linkedPersonId: "p-amalia-bellandi"
      },
      {
        id: "ev-fictional-bellandi-household-list",
        title: "Fictional 1868 Ceraluna Alta household pages",
        type: "Local register",
        summary: "One household lists Rosa, 9; Malia, 7; and Ettore, 4 in sibling order. A second Malia, age 3, appears with different parents on another page.",
        confidence: 0.82,
        linkedPersonId: "p-amalia-bellandi"
      },
      {
        id: "ev-fictional-amalia-departure",
        title: "Fictional 1883 Ceraluna Alta departure entry",
        type: "Migration record",
        summary: "Amalia Rose Bellandi, born 7 July 1861, names Rosa Bellandi as her local contact before leaving Ceraluna Alta.",
        confidence: 0.73,
        linkedPersonId: "p-amalia-bellandi"
      }
    ],
    tasks: [
      {
        id: "task-ceraluna-alta-sibling-set",
        title: "Reconstruct the fictional Bellandi sibling set",
        status: "done",
        origin: "manual",
        priority: "high",
        guidance: "Search the invented Ceraluna Alta parish register from 1855 through 1870 and keep same-name children in separate candidate groups.",
        targetHypothesisId: "hyp-amalia-bell-tower",
        contextRefs: [
          { type: "case", id: "case-bellandi-ceraluna-alta" },
          { type: "hypothesis", id: "hyp-amalia-bell-tower" },
          { type: "evidence", id: "ev-fictional-bellandi-sibling-register" },
          { type: "evidence", id: "ev-fictional-bellandi-household-list" }
        ],
        outcomes: [
          {
            id: "outcome-ceraluna-alta-sibling-set",
            requestId: "demo-request-ceraluna-alta-sibling-set",
            type: "found",
            note: "The invented register sequence places Rosa (1859), Amalia Rose (1861), and Ettore (1864) under Luca Bellandi and Mira Solari. The 1868 household preserves that age order as Rosa, Malia, Ettore; the other Malia belongs to different parents.",
            searchScope: {
              repository: "Fictional Ceraluna Alta Parish Archive",
              collection: "Baptism register and 1868 household pages",
              place: "Ceraluna Alta, Italy",
              dateRange: "1857–1868",
              query: "Bellandi children of Luca Bellandi and Mira Solari"
            },
            actorId: "fictional-demo-researcher",
            actorName: "Demo Researcher",
            createdAt: "2026-06-11T15:40:00.000Z"
          }
        ],
        createdAt: "2026-06-11T12:15:00.000Z",
        completedAt: "2026-06-11T15:40:00.000Z",
        updatedAt: "2026-06-11T15:40:00.000Z"
      },
      {
        id: "task-ceraluna-alta-name-index",
        title: "Check the fictional Ceraluna Alta name index for Malia Bellandi",
        status: "done",
        origin: "manual",
        priority: "normal",
        guidance: "Treat each same-name result as a separate candidate until parents or dates distinguish them.",
        targetHypothesisId: "hyp-amalia-bell-tower",
        contextRefs: [
          { type: "case", id: "case-bellandi-ceraluna-alta" },
          { type: "hypothesis", id: "hyp-amalia-bell-tower" }
        ],
        outcomes: [
          {
            id: "outcome-ceraluna-alta-name-index",
            requestId: "demo-request-ceraluna-alta-name-index",
            type: "inconclusive",
            note: "The invented index contains two girls called Malia Bellandi within four years. Neither index entry names parents, so the result narrows no identity by itself.",
            searchScope: {
              repository: "Fictional Ceraluna Alta Parish Archive",
              collection: "Given-name and surname index",
              place: "Ceraluna Alta, Italy",
              dateRange: "1855–1870",
              query: "Malia, Amalia, and Bellandi"
            },
            actorId: "fictional-demo-researcher",
            actorName: "Demo Researcher",
            createdAt: "2026-06-05T11:20:00.000Z"
          }
        ],
        createdAt: "2026-06-05T09:45:00.000Z",
        completedAt: "2026-06-05T11:20:00.000Z",
        updatedAt: "2026-06-05T11:20:00.000Z"
      },
      {
        id: "task-ceraluna-alta-arrival-corroboration",
        title: "Find an independent arrival record naming Amalia's parents",
        status: "todo",
        origin: "manual",
        priority: "high",
        guidance: "Use a source independent of the fictional Ceraluna Alta parish register before resolving the identity.",
        targetHypothesisId: "hyp-amalia-bell-tower",
        contextRefs: [
          { type: "case", id: "case-bellandi-ceraluna-alta" },
          { type: "hypothesis", id: "hyp-amalia-bell-tower" },
          { type: "evidence", id: "ev-fictional-amalia-departure" }
        ]
      }
    ]
  },
  {
    id: "case-northstar-dna-cluster",
    title: "The fictional Northstar Cove DNA cluster",
    question: "Do the invented M. Alder and T. Pike matches connect through Maeve Rowan Mercer's family?",
    status: "active",
    focus: "Invented Mercer–Rowan DNA matches",
    privacy: "sensitive",
    hypotheses: [
      {
        id: "hyp-dna-maeve-sibling",
        statement: "Both invented matches may descend through separate child lines of Maeve Rowan Mercer’s younger sister, Elowen Rowan.",
        confidence: 0.61,
        status: "supported"
      },
      {
        id: "hyp-dna-mixed-cluster",
        statement: "The shared-match cluster combines separate Mercer and Rowan relationships.",
        confidence: 0.38,
        status: "open"
      }
    ],
    evidence: [
      {
        id: "ev-fictional-dna-alder",
        title: "Invented M. Alder DNA match",
        type: "DNA",
        summary: "A wholly invented 86 cM match with a partial Mercer–Rowan tree and Northstar Cove overlap.",
        confidence: 0.7,
        linkedDnaMatchId: "dna-m-alder"
      },
      {
        id: "ev-fictional-dna-pike",
        title: "Invented T. Pike DNA match",
        type: "DNA",
        summary: "A wholly invented 54 cM shared match whose tree includes a fictional Rowan household in Northstar Cove.",
        confidence: 0.66,
        linkedDnaMatchId: "dna-t-pike"
      },
      {
        id: "ev-fictional-dna-solari",
        title: "Invented R. Solari DNA match",
        type: "DNA",
        summary: "A wholly invented 37 cM match with no usable tree; its profile supplies Bellandi and Ceraluna Alta clues but no relationship proof.",
        confidence: 0.42,
        linkedDnaMatchId: "dna-r-solari"
      },
      {
        id: "ev-fictional-rowan-sibling-register",
        title: "Fictional Rowan sibling register",
        type: "Vital records",
        summary: "Northstar Cove records place Maeve Rowan Mercer and younger sister Elowen Rowan in the same fictional parental household.",
        confidence: 0.84
      },
      {
        id: "ev-fictional-rowan-descendant-chart",
        title: "Fictional Elowen Rowan descendant chart",
        type: "Research chart",
        summary: "Two separately sourced documentary paths run from Elowen's children toward the Alder and Pike match trees; each retains one weak parent-child link needing independent confirmation.",
        confidence: 0.71
      },
      {
        id: "ev-fictional-solari-bellandi-path",
        title: "Fictional Solari–Bellandi documentary path",
        type: "Research chart",
        summary: "Ceraluna Alta civil and migration records trace the Solari match profile toward Rosa Bellandi, Amalia's fictional sister, rather than the Rowan household.",
        confidence: 0.68
      },
      {
        id: "ev-fictional-dna-range-overlap",
        title: "Invented DNA relationship-range worksheet",
        type: "DNA analysis",
        summary: "The 86 cM, 54 cM, and 37 cM totals each fit several cousin relationships; shared cM cannot identify Elowen, Rosa, or any branch by itself.",
        confidence: 0.91
      }
    ],
    tasks: [
      {
        id: "task-dna-rowan-descendants",
        title: "Build a fictional descendant chart for Maeve's candidate siblings",
        status: "done",
        origin: "manual",
        priority: "high",
        guidance: "Keep each candidate sibling separate, label every inferred link, and do not identify living people from the invented match data.",
        targetHypothesisId: "hyp-dna-maeve-sibling",
        contextRefs: [
          { type: "case", id: "case-northstar-dna-cluster" },
          { type: "hypothesis", id: "hyp-dna-maeve-sibling" },
          { type: "evidence", id: "ev-fictional-dna-alder" },
          { type: "evidence", id: "ev-fictional-dna-pike" },
          { type: "evidence", id: "ev-fictional-rowan-sibling-register" },
          { type: "evidence", id: "ev-fictional-rowan-descendant-chart" },
          { type: "evidence", id: "ev-fictional-dna-range-overlap" }
        ],
        outcomes: [
          {
            id: "outcome-dna-rowan-descendants",
            requestId: "demo-request-dna-rowan-descendants",
            type: "found",
            note: "The fictional chart finds Elowen Rowan as Maeve's younger sister, then follows different documented child lines toward the Alder and Pike trees. One parent-child link in each route remains provisional, and the cM totals cannot choose the route independently.",
            searchScope: {
              repository: "Fictional Northstar Cove Archive",
              collection: "Rowan vital records and descendant files",
              place: "Northstar Cove, Nova Scotia",
              dateRange: "1857–1948",
              query: "Children and descendants of the Rowan parental household"
            },
            actorId: "fictional-demo-researcher",
            actorName: "Demo Researcher",
            createdAt: "2026-06-12T16:20:00.000Z"
          }
        ],
        createdAt: "2026-06-12T10:00:00.000Z",
        completedAt: "2026-06-12T16:20:00.000Z",
        updatedAt: "2026-06-12T16:20:00.000Z"
      },
      {
        id: "task-dna-solari-separate",
        title: "Confirm the invented R. Solari match belongs in a separate cluster",
        status: "done",
        origin: "manual",
        priority: "low",
        guidance: "Compare shared matches and documented ancestors; surname or place overlap alone is not enough to join clusters.",
        contextRefs: [
          { type: "case", id: "case-northstar-dna-cluster" },
          { type: "evidence", id: "ev-fictional-dna-solari" },
          { type: "evidence", id: "ev-fictional-solari-bellandi-path" },
          { type: "evidence", id: "ev-fictional-dna-range-overlap" }
        ],
        outcomes: [
          {
            id: "outcome-dna-solari-separate",
            requestId: "demo-request-dna-solari-separate",
            type: "found",
            note: "The invented documentary chain runs from the Solari profile through Rosa Bellandi's descendants in Ceraluna Alta. No shared-match or record link joins that path to Elowen Rowan; 37 cM alone cannot establish the branch.",
            searchScope: {
              repository: "Fictional Ceraluna Alta Parish Archive",
              collection: "Bellandi civil, migration, and descendant records",
              place: "Ceraluna Alta, Italy",
              dateRange: "1859–1952",
              query: "Descendants of Rosa Bellandi and Solari surname links"
            },
            actorId: "fictional-demo-researcher",
            actorName: "Demo Researcher",
            createdAt: "2026-06-13T12:40:00.000Z"
          }
        ],
        createdAt: "2026-06-13T09:15:00.000Z",
        completedAt: "2026-06-13T12:40:00.000Z",
        updatedAt: "2026-06-13T12:40:00.000Z"
      },
      {
        id: "task-dna-shared-match-grid",
        title: "Create a shared-match grid for the three invented matches",
        status: "done",
        origin: "manual",
        priority: "normal",
        guidance: "Record direct shared-match observations separately from inferred family branches.",
        targetHypothesisId: "hyp-dna-maeve-sibling",
        contextRefs: [
          { type: "case", id: "case-northstar-dna-cluster" },
          { type: "hypothesis", id: "hyp-dna-maeve-sibling" },
          { type: "evidence", id: "ev-fictional-dna-alder" },
          { type: "evidence", id: "ev-fictional-dna-pike" }
        ],
        outcomes: [
          {
            id: "outcome-dna-shared-match-grid",
            requestId: "demo-request-dna-shared-match-grid",
            type: "found",
            note: "In the invented match data, M. Alder and T. Pike share each other and Northstar Cove clues; R. Solari shares neither and instead points toward Ceraluna Alta. The 86, 54, and 37 cM totals overlap several relationships and do not identify a branch.",
            actorId: "fictional-demo-researcher",
            actorName: "Demo Researcher",
            createdAt: "2026-06-06T15:05:00.000Z"
          }
        ],
        createdAt: "2026-06-06T13:30:00.000Z",
        completedAt: "2026-06-06T15:05:00.000Z",
        updatedAt: "2026-06-06T15:05:00.000Z"
      },
      {
        id: "task-dna-corroborate-weak-links",
        title: "Corroborate the weakest link in each fictional descendant path",
        status: "todo",
        origin: "manual",
        priority: "high",
        guidance: "Find one independent record for each provisional parent-child link before resolving the cluster hypothesis.",
        targetHypothesisId: "hyp-dna-maeve-sibling",
        contextRefs: [
          { type: "case", id: "case-northstar-dna-cluster" },
          { type: "hypothesis", id: "hyp-dna-maeve-sibling" },
          { type: "evidence", id: "ev-fictional-rowan-descendant-chart" },
          { type: "evidence", id: "ev-fictional-solari-bellandi-path" }
        ]
      }
    ]
  }
];

export const archiveStats = {
  people: 16,
  families: 7,
  sources: 7,
  citations: 48,
  dnaMatches: 3,
  triagedMatches: 2,
  highPriorityMatches: 1
};

export const scoredDnaMatches = demoDnaMatches.map((match) => ({
  ...match,
  helpfulnessScore: scoreDnaMatch(match)
}));
