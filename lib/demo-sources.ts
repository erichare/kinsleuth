import { demoFictionNotice } from "./demo-data";
import type { SourceDocument } from "./models";

export function createDemoSources(now = new Date()): SourceDocument[] {
  const createdAt = now.toISOString();
  return [
    {
      id: "src-fictional-lantern-bay-birth",
      title: "Fictional Lantern Bay civil register: Nora Hartwell",
      sourceType: "Vital record",
      repository: "Fictional Lantern Bay Archive",
      citationDate: "3 Oct 1889",
      linkedPersonId: "p-nora-hartwell",
      transcript: "Invented civil-register extract recording the fictional birth of Nora Elise Hartwell in Lantern Bay, Wisconsin.",
      notes: `${demoFictionNotice} Seed source for the guided-research demo.`,
      privacy: "public",
      confidence: 0.92,
      createdAt
    },
    {
      id: "src-fictional-nora-tin-journal",
      title: "Fictional 1922 journal entry: Amalia's tin",
      sourceType: "Family manuscript",
      repository: "Hartwell–Mercer Family Archive (fictional)",
      citationDate: "1922",
      linkedPersonId: "p-nora-hartwell",
      linkedCaseId: "case-blue-tin",
      transcript:
        "Invented transcription: Nora calls the box 'Amalia's tin' and says Samuel arrived in 1907 with a folded passenger notice and harbor photograph; Amalia placed those items and later keepsakes into the tin in 1922.",
      notes: `${demoFictionNotice} Cited by the blue-tin evidence and completed journal-transcription outcome.`,
      privacy: "private",
      confidence: 0.76,
      createdAt
    },
    {
      id: "src-fictional-north-star-catalog",
      title: "Fictional North Star Chandlery autumn 1906 catalog",
      sourceType: "Business catalog",
      repository: "Fictional Northstar Cove Archive",
      citationDate: "Autumn 1906",
      linkedCaseId: "case-harbor-photograph",
      transcript:
        "Invented catalog description: diagonal awning stripes, a lantern rack, and the NORTH STAR sign match the photograph; the autumn supplement also shows the season's diamond inspection seal.",
      notes: `${demoFictionNotice} This source constrains place and season but does not identify the photographed people.`,
      privacy: "private",
      confidence: 0.86,
      createdAt
    },
    {
      id: "src-fictional-photo-comparison",
      title: "Fictional harbor-photograph comparison worksheet",
      sourceType: "Research note",
      repository: "Hartwell–Mercer Family Archive (fictional)",
      citationDate: "9 Jun 2026",
      linkedCaseId: "case-harbor-photograph",
      transcript:
        "Invented worksheet: the three figures share multiple features with independently dated portraits of Maeve, Samuel, and Jonah. A separate pencil study dates Clara's violet annotation to after 1928. Both findings retain stated uncertainty.",
      notes: `${demoFictionNotice} Cited by the comparison and annotation outcomes; resemblance alone is not proof.`,
      privacy: "sensitive",
      confidence: 0.72,
      createdAt
    },
    {
      id: "src-fictional-ceraluna-alta-sibling-register",
      title: "Fictional Ceraluna Alta Bellandi sibling reconstruction",
      sourceType: "Parish and household register",
      repository: "Fictional Ceraluna Alta Parish Archive",
      citationDate: "1859–1868",
      linkedPersonId: "p-amalia-bellandi",
      linkedCaseId: "case-bellandi-ceraluna-alta",
      transcript:
        "Invented register sequence: Rosa (1859), Amalia Rose (7 July 1861), and Ettore (1864) are children of Luca Bellandi and Mira Solari; the 1868 household lists Rosa, Malia, and Ettore in that age order. Another Malia, age three, has different parents.",
      notes: `${demoFictionNotice} Cited by the sibling-set outcome; an independent migration source is still requested.`,
      privacy: "private",
      confidence: 0.85,
      createdAt
    },
    {
      id: "src-fictional-rowan-descendant-chart",
      title: "Fictional Elowen Rowan descendant-source packet",
      sourceType: "Vital records and research chart",
      repository: "Fictional Northstar Cove Archive",
      citationDate: "1857–1948",
      linkedCaseId: "case-northstar-dna-cluster",
      transcript:
        "Invented record packet: Elowen Rowan is Maeve's younger sister. Separately documented descendant paths approach the Alder and Pike match trees, with one provisional parent-child link retained in each route.",
      notes: `${demoFictionNotice} The documentary paths, not the cM totals alone, support the working branch hypothesis.`,
      privacy: "sensitive",
      confidence: 0.71,
      createdAt
    },
    {
      id: "src-fictional-solari-bellandi-chart",
      title: "Fictional Solari–Bellandi descendant-source packet",
      sourceType: "Civil, migration, and research records",
      repository: "Fictional Ceraluna Alta Parish Archive",
      citationDate: "1859–1952",
      linkedCaseId: "case-northstar-dna-cluster",
      transcript:
        "Invented record packet: the Solari match profile traces toward Rosa Bellandi's descendants in Ceraluna Alta. It shares no match or documentary link with the Elowen Rowan paths; 37 cM remains compatible with several relationships.",
      notes: `${demoFictionNotice} Cited by the separate-cluster outcome and retained as a provisional documentary chain.`,
      privacy: "sensitive",
      confidence: 0.68,
      createdAt
    }
  ];
}
