import { notFound } from "next/navigation";
import Link from "next/link";
import { Icons } from "@/components/icons";
import { PublicShell } from "@/components/public-shell";
import { Confidence, EmptyState, PersonMonogram, Status, TableScroll } from "@/components/ui";
import { publicFactFilter } from "@/lib/privacy";
import { getPublicPersonBySlug, readArchiveBranding } from "@/lib/store/people-queries";

export const dynamic = "force-dynamic";

export default async function PublicPersonPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [branding, loaded] = await Promise.all([readArchiveBranding(), getPublicPersonBySlug(slug)]);

  if (!loaded) {
    notFound();
  }

  const { person, publishedRelatives: publicRelatives } = loaded;
  const publicFacts = person.facts.filter(publicFactFilter);
  const publicBirth = publicFacts.find((fact) => isFactType(fact.type, "BIRT", "Birth"));
  const profileConfidence = averageConfidence(publicFacts);

  return (
    <PublicShell active="/people" tagline={branding.tagline}>
      <div className="page-wrap">
        <div className="profile-page-actions">
          <Link className="button-secondary" href="/people">
            <Icons.ChevronLeft size={16} aria-hidden />
            Published People
          </Link>
        </div>
        <section className="section profile-card person-profile-card surface-featured">
          <div className="profile-header">
            <div className="portrait">
              <PersonMonogram name={person.displayName} />
            </div>
            <div>
              <h1 className="profile-title public-profile-title">{person.displayName}</h1>
              <p className="muted">{formatVital(publicBirth?.date, publicBirth?.place)}</p>
              <p>Published profile curated from selected public facts and citations.</p>
              <div className="hero-actions">
                <Status>Published</Status>
                <Status tone="private">Sensitive details withheld</Status>
              </div>
            </div>
            <div className="panel profile-confidence-panel surface-inset">
              <strong>Public fact confidence</strong>
              <div className="profile-confidence-score">
                {profileConfidence === null ? <span className="muted">Not scored</span> : <Confidence value={profileConfidence} />}
              </div>
              <p className="muted">Selected citations and public facts only.</p>
            </div>
          </div>
        </section>

        <section className="section grid-2">
          <div className="table-panel">
            {publicFacts.length > 0 ? (
            <TableScroll label={`Published facts for ${person.displayName}`}>
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
            </TableScroll>
            ) : (
              <EmptyState icon={<Icons.BookOpen size={22} aria-hidden />} title="No public facts selected">
                This profile is published, but no individual facts are available for public display yet.
              </EmptyState>
            )}
          </div>
          <div className="side-stack">
            <aside className="panel">
              <h2>Timeline</h2>
              {publicFacts.length > 0 ? <div className="timeline">
                {publicFacts.map((fact) => (
                  <div className="timeline-item" key={fact.id}>
                    <strong>{fact.date}</strong>
                    <div>{fact.type}</div>
                    <div className="muted">{fact.place}</div>
                  </div>
                ))}
              </div> : <p className="muted">Timeline details have not been selected for public display.</p>}
            </aside>
            <aside className="panel">
              <h2>Published relatives</h2>
              <div className="evidence-list">
                {publicRelatives.length > 0 ? (
                  publicRelatives.map((relative) => (
                    <Link className="evidence-item relationship-link" href={`/people/${relative.slug}`} key={relative.id}>
                      <strong>{relative.displayName}</strong>
                      <span className="muted">Published relative</span>
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

function isFactType(type: string, gedcomType: string, label: string): boolean {
  return type.toUpperCase() === gedcomType || type.toLowerCase() === label.toLowerCase();
}

function averageConfidence(facts: Array<{ confidence: number }>): number | null {
  return facts.length > 0 ? facts.reduce((sum, fact) => sum + fact.confidence, 0) / facts.length : null;
}

function formatVital(date?: string, place?: string): string {
  return [date, place].filter(Boolean).join(" · ") || "Public vital details withheld";
}
