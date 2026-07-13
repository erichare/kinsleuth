import { AppShell } from "@/components/app-shell";
import { DnaTriageWorkspace } from "@/components/dna-triage-workspace";
import { createDnaHypothesesForMatches, listCaseOptions, searchDnaMatchesPageFromDb } from "@/lib/store/dna-queries";
import { readArchiveBranding } from "@/lib/store/people-queries";

export const dynamic = "force-dynamic";

export default async function DnaPage() {
  const [branding, initialResult, initialCases] = await Promise.all([
    readArchiveBranding(),
    searchDnaMatchesPageFromDb({}, { page: 1, pageSize: 25 }),
    listCaseOptions()
  ]);
  const initialHypotheses = await createDnaHypothesesForMatches(initialResult.items);

  return (
    <AppShell title="DNA Match Triage" active="/app/dna" archiveName={branding.name}>
      <DnaTriageWorkspace initialCases={initialCases} initialResult={initialResult} initialHypotheses={initialHypotheses} />
    </AppShell>
  );
}
