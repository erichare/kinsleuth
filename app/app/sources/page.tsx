import { AppShell } from "@/components/app-shell";
import { SourceWorkspace } from "@/components/source-workspace";
import { readWorkspace } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  const workspace = await readWorkspace();

  return (
    <AppShell title="Sources" active="/app/sources">
      <SourceWorkspace initialSources={workspace.sources} people={workspace.people} cases={workspace.cases} />
    </AppShell>
  );
}
