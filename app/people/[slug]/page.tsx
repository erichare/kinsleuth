import { notFound } from "next/navigation";
import Link from "next/link";
import { Icons } from "@/components/icons";
import { PublicShell } from "@/components/public-shell";
import { Confidence, Status } from "@/components/ui";
import type { PersonSummary } from "@/lib/models";
import { canPublishPerson, publicFactFilter } from "@/lib/privacy";
import { readWorkspace } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

export default async function PublicPersonPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const workspace = await readWorkspace();
  const person = workspace.people.find((item) => item.slug === slug && item.published && canPublishPerson(item));

  if (!person) {
    notFound();
  }

  const publicFacts = person.facts.filter(publicFactFilter);
  const publicRelatives = person.relatives
    .map((relativeId) => workspace.people.find((item) => item.id === relativeId && item.published && canPublishPerson(item)))
    .filter((relative): relative is PersonSummary => Boolean(relative));

  return (
    <PublicShell active="/people">
      <div className="page-wrap">
        <div className="profile-page-actions">
          <Link className="button-secondary" href="/people">
            <Icons.ChevronLeft size={16} aria-hidden />
            Published People
          </Link>
        </div>
        <section className="section profile-card person-profile-card">
          <div className="profile-header">
            <div className="portrait">
              <Icons.Users size={58} aria-hidden />
            </div>
            <div>
              <h1 className="profile-title public-profile-title">{person.displayName}</h1>
              <p className="muted">{person.birthDate} · {person.birthPlace}</p>
              <p>{person.notes}</p>
              <div className="hero-actions">
                <Status>Published</Status>
                <Status tone="private">Sensitive details withheld</Status>
              </div>
            </div>
            <div className="panel profile-confidence-panel">
              <strong>Profile confidence</strong>
              <div className="profile-confidence-score">
                <Confidence value={0.86} />
              </div>
              <p className="muted">Selected citations and public facts only.</p>
            </div>
          </div>
        </section>

        <section className="section grid-2">
          <div className="table-panel">
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
                {publicFacts.map((fact) => (
                  <tr key={fact.id}>
                    <td>{fact.type}</td>
                    <td>{fact.date}</td>
                    <td>{fact.place}</td>
                    <td>{fact.source}</td>
                    <td>
                      <Confidence value={fact.confidence} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="side-stack">
            <aside className="panel">
              <h2>Timeline</h2>
              <div className="timeline">
                {publicFacts.map((fact) => (
                  <div className="timeline-item" key={fact.id}>
                    <strong>{fact.date}</strong>
                    <div>{fact.type}</div>
                    <div className="muted">{fact.place}</div>
                  </div>
                ))}
              </div>
            </aside>
            <aside className="panel">
              <h2>Published relatives</h2>
              <div className="evidence-list">
                {publicRelatives.length > 0 ? (
                  publicRelatives.map((relative) => (
                    <Link className="evidence-item relationship-link" href={`/people/${relative.slug}`} key={relative.id}>
                      <strong>{relative.displayName}</strong>
                      <span className="muted">{relative.birthDate ?? "Unknown date"}</span>
                    </Link>
                  ))
                ) : (
                  <p className="muted">No public relative profiles are linked yet.</p>
                )}
              </div>
            </aside>
          </div>
        </section>
      </div>
    </PublicShell>
  );
}
