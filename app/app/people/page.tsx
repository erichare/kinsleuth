import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PeopleWorkspace } from "@/components/people-workspace";
import { resolveHostedCapabilities } from "@/lib/hosted-capabilities";
import { getSessionContext, workspaceOptionsForSession } from "@/lib/auth-session";
import { maximumPageSize } from "@/lib/pagination";
import { readArchiveBranding, searchPeoplePageFromDb } from "@/lib/store/people-queries";

export const dynamic = "force-dynamic";

export default async function AppPeoplePage() {
  const capabilities = resolveHostedCapabilities();
  const session = await getSessionContext(await headers());
  if (!session) notFound();
  const archiveOptions = workspaceOptionsForSession(session);
  const [branding, initialResult] = await Promise.all([
    readArchiveBranding(archiveOptions),
    searchPeoplePageFromDb(
      { sort: "name" },
      { page: 1, pageSize: session.kind === "demo-guest" ? maximumPageSize : 50 },
      archiveOptions
    )
  ]);

  return (
    <AppShell title="People" active="/app/people" archiveName={branding.name}>
      <PeopleWorkspace
        clientSideSearch={session.kind === "demo-guest"}
        initialResult={initialResult}
        publicArchiveEnabled={capabilities.publicArchive}
        publicPublishingEnabled={capabilities.publicPublishing}
      />
    </AppShell>
  );
}
