import { AppShell } from "@/components/app-shell";
import { PeopleWorkspace } from "@/components/people-workspace";
import { readArchiveBranding, searchPeoplePageFromDb } from "@/lib/store/people-queries";

export const dynamic = "force-dynamic";

export default async function AppPeoplePage() {
  const [branding, initialResult] = await Promise.all([
    readArchiveBranding(),
    searchPeoplePageFromDb({ sort: "name" }, { page: 1, pageSize: 50 })
  ]);

  return (
    <AppShell title="People" active="/app/people" archiveName={branding.name}>
      <PeopleWorkspace initialResult={initialResult} />
    </AppShell>
  );
}
