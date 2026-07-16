import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { SourceWorkspace } from "@/components/source-workspace";
import { resolveHostedCapabilities } from "@/lib/hosted-capabilities";
import { getSessionContext, workspaceOptionsForSession } from "@/lib/auth-session";
import { maximumPageSize } from "@/lib/pagination";
import { readArchiveBranding } from "@/lib/store/people-queries";
import { listCaseLinkOptions, listPersonLinkOptions, searchSourcesPageFromDb } from "@/lib/store/source-queries";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  const capabilities = resolveHostedCapabilities();
  const session = await getSessionContext(await headers());
  if (!session) notFound();
  const archiveOptions = workspaceOptionsForSession(session);
  const [branding, caseOptions, personOptions, initialResult] = await Promise.all([
    readArchiveBranding(archiveOptions),
    listCaseLinkOptions({ ...archiveOptions, includeDnaCases: capabilities.dna }),
    listPersonLinkOptions(archiveOptions),
    searchSourcesPageFromDb(
      {},
      { page: 1, pageSize: session.kind === "demo-guest" ? maximumPageSize : 50 },
      { ...archiveOptions, includeBinaryMetadata: capabilities.evidenceBinaryUploads }
    )
  ]);

  return (
    <AppShell title="Sources" active="/app/sources" archiveName={branding.name}>
      <SourceWorkspace
        caseOptions={caseOptions}
        clientSideSearch={session.kind === "demo-guest"}
        evidenceBinaryUploadsEnabled={capabilities.evidenceBinaryUploads}
        initialPersonOptions={personOptions}
        initialResult={initialResult}
        readOnly={session.kind === "demo-guest"}
      />
    </AppShell>
  );
}
