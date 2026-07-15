import { AppShell } from "@/components/app-shell";
import { CaseWorkspace } from "@/components/case-workspace";
import {
  projectCaseSearchResultForDnaCapability,
  projectEvidenceQueueForDnaCapability
} from "@/lib/case-search";
import { resolveHostedCapabilities } from "@/lib/hosted-capabilities";
import { caseEvidenceQueueFromDb, searchCasesPageFromDb } from "@/lib/store/case-queries";
import { readArchiveBranding } from "@/lib/store/people-queries";

export const dynamic = "force-dynamic";

export default async function CasesPage() {
  const capabilities = resolveHostedCapabilities();
  const queryOptions = { includeDnaEvidence: capabilities.dna };
  const [branding, initialResult, initialEvidenceQueue] = await Promise.all([
    readArchiveBranding(),
    searchCasesPageFromDb({ sort: "status" }, { page: 1, pageSize: 25 }, queryOptions),
    caseEvidenceQueueFromDb(queryOptions)
  ]);

  return (
    <AppShell title="Cases" active="/app/cases" archiveName={branding.name}>
      <CaseWorkspace
        dnaEnabled={capabilities.dna}
        initialResult={projectCaseSearchResultForDnaCapability(initialResult, capabilities.dna)}
        initialEvidenceQueue={projectEvidenceQueueForDnaCapability(initialEvidenceQueue, capabilities.dna)}
      />
    </AppShell>
  );
}
