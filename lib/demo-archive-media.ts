import { researchInstinctsCases } from "@/site/shared/research-instincts";

export type DemoArchiveMedia = {
  recordId: string;
  catalogId: string;
  title: string;
  kind: string;
  date: string;
  src: string;
  alt: string;
  width: number;
  height: number;
  metadata: readonly {
    label: string;
    value: string;
  }[];
};

const demoArchiveMediaByRecordId = new Map<string, DemoArchiveMedia>();

for (const challengeCase of researchInstinctsCases) {
  for (const record of challengeCase.records ?? []) {
    demoArchiveMediaByRecordId.set(record.id, {
      recordId: record.id,
      catalogId: record.catalogId,
      title: record.title,
      kind: record.kind,
      date: record.date,
      src: record.image.src,
      alt: record.image.alt,
      width: record.image.width,
      height: record.image.height,
      metadata: record.metadata
    });
  }
}

const recordIdByEvidenceId: Readonly<Record<string, string>> = {
  "ev-fictional-passenger-list": "lantern-passenger-declaration-1907",
  "ev-fictional-marriage-signature": "lantern-marriage-1909",
  "ev-fictional-maeve-letter": "maeve-letter-1906",
  "ev-fictional-blue-tin-inventory": "blue-tin-estate-inventory-1984",
  "ev-fictional-amalia-notebook": "blue-tin-amalia-notebook-1922",
  "ev-fictional-nora-journal": "blue-tin-nora-journal-1922",
  "ev-fictional-harbor-photo": "harbor-photo-recto",
  "ev-fictional-photo-verso": "harbor-photo-verso",
  "ev-fictional-north-star-catalog": "north-star-catalog-1906",
  "ev-fictional-lantern-inspection-seal": "harbor-seal-register-1904-1908",
  "ev-fictional-photo-comparison": "clara-comparison-workbook-1933",
  "ev-fictional-violet-pencil-study": "clara-comparison-workbook-1933",
  "ev-fictional-bellandi-sibling-register": "ceraluna-baptisms-1859-1864",
  "ev-fictional-bellandi-household-list": "ceraluna-households-1868",
  "ev-fictional-amalia-departure": "amalia-departure-permit-1883",
  "ev-fictional-dna-alder": "dna-match-export",
  "ev-fictional-dna-pike": "dna-match-export",
  "ev-fictional-dna-solari": "dna-match-export",
  "ev-fictional-rowan-sibling-register": "rowan-household-1871",
  "ev-fictional-rowan-descendant-chart": "elowen-descendant-proof-chart",
  "ev-fictional-solari-bellandi-path": "solari-correlation-worksheet",
  "ev-fictional-dna-range-overlap": "dna-interpretation-reference"
};

const recordIdBySourceId: Readonly<Record<string, string>> = {
  "src-fictional-nora-tin-journal": "blue-tin-nora-journal-1922",
  "src-fictional-north-star-catalog": "north-star-catalog-1906",
  "src-fictional-photo-comparison": "clara-comparison-workbook-1933",
  "src-fictional-ceraluna-alta-sibling-register": "ceraluna-baptisms-1859-1864",
  "src-fictional-rowan-descendant-chart": "elowen-descendant-proof-chart",
  "src-fictional-solari-bellandi-chart": "solari-correlation-worksheet"
};

export function demoArchiveMediaForRecord(recordId: string): DemoArchiveMedia | undefined {
  return demoArchiveMediaByRecordId.get(recordId);
}

export function demoArchiveMediaForEvidence(evidenceId: string): DemoArchiveMedia | undefined {
  const recordId = recordIdByEvidenceId[evidenceId];
  return recordId ? demoArchiveMediaForRecord(recordId) : undefined;
}

export function demoArchiveMediaForSource(sourceId: string): DemoArchiveMedia | undefined {
  const recordId = recordIdBySourceId[sourceId];
  return recordId ? demoArchiveMediaForRecord(recordId) : undefined;
}
