import { AppShell } from "@/components/app-shell";
import { CaseWorkspace } from "@/components/case-workspace";
import { caseEvidenceQueueFromDb, searchCasesPageFromDb } from "@/lib/store/case-queries";
import { readArchiveBranding } from "@/lib/store/people-queries";

export const dynamic = "force-dynamic";

export default async function CasesPage() {
  const [branding, initialResult, initialEvidenceQueue] = await Promise.all([
    readArchiveBranding(),
    searchCasesPageFromDb({ sort: "status" }, { page: 1, pageSize: 25 }),
    caseEvidenceQueueFromDb()
  ]);

  return (
    <AppShell title="Cases" active="/app/cases" archiveName={branding.name}>
      <CaseWorkspace initialResult={initialResult} initialEvidenceQueue={initialEvidenceQueue} />
    </AppShell>
  );
}
