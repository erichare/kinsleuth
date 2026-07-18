import { headers } from "next/headers";
import { notFound } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Icons } from "@/components/icons";
import { PersonCurationPanel } from "@/components/person-curation-panel";
import { PersonProfileTabs } from "@/components/person-profile-tabs";
import { PersonMonogram, Status } from "@/components/ui";
import { isDnaResearchCase, projectResearchCaseForDnaCapability } from "@/lib/case-search";
import { resolveHostedCapabilities } from "@/lib/hosted-capabilities";
import { getSessionContext, workspaceOptionsForSession } from "@/lib/auth-session";
import { buildPersonProfile } from "@/lib/person-profile";
import { readWorkspace } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

export default async function AppPersonPage({ params }: { params: Promise<{ id: string }> }) {
  const capabilities = resolveHostedCapabilities();
  const { id } = await params;
  const personId = decodeURIComponent(id);
  const session = await getSessionContext(await headers());
  if (!session) notFound();
  const workspace = await readWorkspace(workspaceOptionsForSession(session));
  const person = workspace.people.find((item) => item.id === personId);

  if (!person) {
    notFound();
  }
  const visibleCases = (workspace.cases ?? [])
    .filter((researchCase) => capabilities.dna || !isDnaResearchCase(researchCase))
    .map((researchCase) => projectResearchCaseForDnaCapability(researchCase, capabilities.dna));
  const profile = buildPersonProfile(person, {
    ...workspace,
    cases: visibleCases,
    // Saved answers can contain DNA details even when their structured context
    // is incomplete, so hide them at the server boundary with the capability.
    aiRuns: capabilities.dna ? (workspace.aiRuns ?? []) : [],
    includeProviderMetadata: capabilities.externalAi,
    includeDemoMedia: capabilities.datasetMode === "demo"
  });
  const deathSummary = person.deathDate ?? (person.livingStatus === "deceased" ? "Unknown death" : undefined);
  const lifeSummary = [person.birthDate ?? "Unknown birth", deathSummary, person.birthPlace].filter(Boolean).join(" · ");

  return (
    <AppShell
      title="Person Profile"
      active="/app/people"
      archiveName={workspace.archiveName}
      actions={
        <Link className="button-secondary" href="/app/people">
          <Icons.ChevronLeft size={16} aria-hidden />
          People
        </Link>
      }
    >
      <section className="profile-card person-profile-card">
        <div className="profile-header">
          <div className="portrait">
            <PersonMonogram name={person.displayName} />
          </div>
          <div>
            <h1 className="profile-title">{person.displayName}</h1>
            <p className="muted">{lifeSummary}</p>
            <p>
              {profile.facts.length} documented fact{profile.facts.length === 1 ? "" : "s"}, {profile.sourceTotal} source and evidence card{profile.sourceTotal === 1 ? "" : "s"}, and {profile.relationships.length} linked relative{profile.relationships.length === 1 ? "" : "s"}.
            </p>
            {profile.isFictionalDemo ? (
              <p className="fiction-disclosure" role="note">
                <strong>Fictional demo archive:</strong> every name, date, place, family story, and scanned record on this profile was invented for Kin Resolve.
              </p>
            ) : null}
            <div className="hero-actions">
              {capabilities.publicArchive && capabilities.publicPublishing ? (
                <Status tone={person.published ? "ok" : "private"}>{person.published ? "Published" : "Private"}</Status>
              ) : (
                <Status tone="private">Private beta</Status>
              )}
              <Status tone="private">{person.livingStatus}</Status>
            </div>
          </div>
          {session.kind === "member" ? (
            <PersonCurationPanel
              key={person.id}
              person={person}
              publicPublishingEnabled={capabilities.publicPublishing}
            />
          ) : null}
        </div>
      </section>

      <PersonProfileTabs personName={person.displayName} profile={profile} />
    </AppShell>
  );
}
