import { AppShell } from "@/components/app-shell";
import { SourceWorkspace } from "@/components/source-workspace";
import { readArchiveBranding } from "@/lib/store/people-queries";
import { listCaseLinkOptions, listPersonLinkOptions, searchSourcesPageFromDb } from "@/lib/store/source-queries";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  const [branding, caseOptions, personOptions, initialResult] = await Promise.all([
    readArchiveBranding(),
    listCaseLinkOptions(),
    listPersonLinkOptions(),
    searchSourcesPageFromDb({}, { page: 1, pageSize: 50 })
  ]);

  return (
    <AppShell title="Sources" active="/app/sources" archiveName={branding.name}>
      <SourceWorkspace
        caseOptions={caseOptions}
        initialPersonOptions={personOptions}
        initialResult={initialResult}
      />
    </AppShell>
  );
}
