import { AppShell } from "@/components/app-shell";
import { SourceWorkspace } from "@/components/source-workspace";
import { resolveHostedCapabilities } from "@/lib/hosted-capabilities";
import { readArchiveBranding } from "@/lib/store/people-queries";
import { listCaseLinkOptions, listPersonLinkOptions, searchSourcesPageFromDb } from "@/lib/store/source-queries";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  const capabilities = resolveHostedCapabilities();
  const [branding, caseOptions, personOptions, initialResult] = await Promise.all([
    readArchiveBranding(),
    listCaseLinkOptions({ includeDnaCases: capabilities.dna }),
    listPersonLinkOptions(),
    searchSourcesPageFromDb(
      {},
      { page: 1, pageSize: 50 },
      { includeBinaryMetadata: capabilities.evidenceBinaryUploads }
    )
  ]);

  return (
    <AppShell title="Sources" active="/app/sources" archiveName={branding.name}>
      <SourceWorkspace
        caseOptions={caseOptions}
        evidenceBinaryUploadsEnabled={capabilities.evidenceBinaryUploads}
        initialPersonOptions={personOptions}
        initialResult={initialResult}
      />
    </AppShell>
  );
}
