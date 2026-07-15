import { notFound } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Icons } from "@/components/icons";
import { PersonCurationPanel } from "@/components/person-curation-panel";
import { Confidence, EmptyState, Status } from "@/components/ui";
import { resolveHostedCapabilities } from "@/lib/hosted-capabilities";
import type { PersonSummary } from "@/lib/models";
import { readWorkspace } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

export default async function AppPersonPage({ params }: { params: Promise<{ id: string }> }) {
  const capabilities = resolveHostedCapabilities();
  const { id } = await params;
  const personId = decodeURIComponent(id);
  const workspace = await readWorkspace();
  const person = workspace.people.find((item) => item.id === personId);

  if (!person) {
    notFound();
  }
  const relatives = person.relatives
    .map((relativeId) => workspace.people.find((item) => item.id === relativeId))
    .filter((relative): relative is PersonSummary => Boolean(relative));
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
            <Icons.Users size={58} aria-hidden />
          </div>
          <div>
            <h1 className="profile-title">{person.displayName}</h1>
            <p className="muted">{lifeSummary}</p>
            <p>{person.notes ?? "Imported profile with curated facts and source confidence."}</p>
            <div className="hero-actions">
              {capabilities.publicArchive && capabilities.publicPublishing ? (
                <Status tone={person.published ? "ok" : "private"}>{person.published ? "Published" : "Private"}</Status>
              ) : (
                <Status tone="private">Private beta</Status>
              )}
              <Status tone="private">{person.livingStatus}</Status>
            </div>
          </div>
          <PersonCurationPanel
            key={person.id}
            person={person}
            publicPublishingEnabled={capabilities.publicPublishing}
          />
        </div>
        <div className="tabs">
          <span className="active">Facts</span>
          <span>Sources</span>
          <span>Timeline</span>
          <span>Notes</span>
          <span>Relationships</span>
          <span>AI Insights</span>
        </div>
      </section>

      <section className="section grid-2">
        <div className="table-panel">
          {person.facts.length > 0 ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Fact</th>
                  <th>Date</th>
                  <th>Place</th>
                  <th>Source</th>
                  <th>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {person.facts.map((fact) => (
                  <tr key={fact.id}>
                    <td>{fact.type}</td>
                    <td>{fact.date ?? "Unknown"}</td>
                    <td>{fact.place ?? "Unknown"}</td>
                    <td>{fact.source ?? "Needs source"}</td>
                    <td>
                      <Confidence value={fact.confidence} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState icon={<Icons.Users size={20} aria-hidden />} title="No dated facts imported for this person">
              This usually means the GEDCOM contained a placeholder individual, private tree stub, or relationship-only record.
            </EmptyState>
          )}
        </div>
        <aside className="app-card">
          <h2>Timeline</h2>
          <div className="timeline">
            {person.facts.length > 0 ? (
              person.facts.map((fact) => (
                <div className="timeline-item" key={fact.id}>
                  <strong>{fact.date ?? "Unknown date"}</strong>
                  <div>{fact.type}</div>
                  <div className="muted">{fact.place ?? "Unknown place"}</div>
                </div>
              ))
            ) : (
              <p className="muted">No timeline facts are available for this imported record.</p>
            )}
          </div>
          <div className="relationship-panel">
            <h2>Relationships</h2>
            <div className="evidence-list">
              {relatives.length > 0 ? (
                relatives.map((relative) => (
                  <Link className="evidence-item relationship-link" href={`/app/people/${encodeURIComponent(relative.id)}`} key={relative.id}>
                    <strong>{relative.displayName}</strong>
                    <span className="muted">{relative.birthDate ?? "Unknown date"}</span>
                  </Link>
                ))
              ) : (
                <p className="muted">No linked relatives are available in this workspace record.</p>
              )}
            </div>
          </div>
        </aside>
      </section>
    </AppShell>
  );
}
