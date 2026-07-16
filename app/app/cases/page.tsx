import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { CaseWorkspace } from "@/components/case-workspace";
import {
  projectCaseSearchResultForDnaCapability,
  projectEvidenceQueueForDnaCapability
} from "@/lib/case-search";
import { resolveHostedCapabilities } from "@/lib/hosted-capabilities";
import { getSessionContext, workspaceOptionsForSession } from "@/lib/auth-session";
import { maximumPageSize } from "@/lib/pagination";
import { caseEvidenceQueueFromDb, searchCasesPageFromDb } from "@/lib/store/case-queries";
import { readArchiveBranding } from "@/lib/store/people-queries";

export const dynamic = "force-dynamic";

export default async function CasesPage() {
  const capabilities = resolveHostedCapabilities();
  const session = await getSessionContext(await headers());
  if (!session) notFound();
  const archiveOptions = workspaceOptionsForSession(session);
  const queryOptions = { ...archiveOptions, includeDnaEvidence: capabilities.dna };
  const [branding, initialResult, initialEvidenceQueue] = await Promise.all([
    readArchiveBranding(archiveOptions),
    searchCasesPageFromDb(
      { sort: "status" },
      { page: 1, pageSize: session.kind === "demo-guest" ? maximumPageSize : 25 },
      queryOptions
    ),
    caseEvidenceQueueFromDb(queryOptions)
  ]);

  return (
    <AppShell title="Cases" active="/app/cases" archiveName={branding.name}>
      <CaseWorkspace
        clientSideSearch={session.kind === "demo-guest"}
        dnaEnabled={capabilities.dna}
        initialResult={projectCaseSearchResultForDnaCapability(initialResult, capabilities.dna)}
        initialEvidenceQueue={projectEvidenceQueueForDnaCapability(initialEvidenceQueue, capabilities.dna)}
        readOnly={session.kind === "demo-guest"}
      />
    </AppShell>
  );
}
