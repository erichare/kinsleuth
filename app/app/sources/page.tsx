import { AppShell } from "@/components/app-shell";
import { SourceWorkspace } from "@/components/source-workspace";
import { buildCaseLinkOptions, buildPersonLinkOptions, searchSourcesPage } from "@/lib/source-search";
import { readWorkspace } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  const workspace = await readWorkspace();

  return (
    <AppShell title="Sources" active="/app/sources" archiveName={workspace.archiveName}>
      <SourceWorkspace
        caseOptions={buildCaseLinkOptions(workspace.cases)}
        initialPersonOptions={buildPersonLinkOptions(workspace.people, workspace.sources)}
        initialResult={searchSourcesPage(workspace.sources, workspace.people, workspace.cases, {}, { page: 1, pageSize: 50 })}
      />
    </AppShell>
  );
}
