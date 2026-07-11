import { AppShell } from "@/components/app-shell";
import { PeopleWorkspace } from "@/components/people-workspace";
import { searchPeoplePage } from "@/lib/people-search";
import { readWorkspace } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

export default async function AppPeoplePage() {
  const workspace = await readWorkspace();
  const initialResult = searchPeoplePage(workspace.people, { sort: "name" }, { page: 1, pageSize: 50 });

  return (
    <AppShell title="People" active="/app/people" archiveName={workspace.archiveName}>
      <PeopleWorkspace initialResult={initialResult} />
    </AppShell>
  );
}
