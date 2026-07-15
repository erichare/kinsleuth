import Link from "next/link";
import { redirect } from "next/navigation";
import { Icons } from "@/components/icons";
import { PublicShell } from "@/components/public-shell";
import { Confidence, EmptyState, PersonMonogram, Status, TableScroll } from "@/components/ui";
import { publicFactFilter } from "@/lib/privacy";
import { privateWorkspaceLoginPath, publicArchiveEnabled } from "@/lib/public-surface";
import { listPublicPeople, readArchiveBranding } from "@/lib/store/people-queries";

export const dynamic = "force-dynamic";

export default async function PeoplePage() {
  if (!publicArchiveEnabled()) {
    redirect(privateWorkspaceLoginPath);
  }
  const [branding, publishedPeople] = await Promise.all([readArchiveBranding(), listPublicPeople()]);

  return (
    <PublicShell active="/people" tagline={branding.tagline}>
      <div className="page-wrap">
        <section className="page-title section">
          <h1>Published People</h1>
          <p>Only manually published profiles are visible here. If you just imported a GEDCOM, those private workspace profiles are ready for curation before public sharing.</p>
          <div className="hero-actions">
            <Link className="button-secondary" href="/app/people">
              Open private people
            </Link>
            <Link className="button-ghost" href="/app/publishing">
              Review publishing
            </Link>
          </div>
        </section>
        <section className="table-panel public-people-panel">
          {publishedPeople.length > 0 ? (
            <TableScroll label="Published people">
              <table className="data-table responsive-table public-people-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Birth</th>
                    <th>Death</th>
                    <th>Confidence</th>
                    <th>Status</th>
                    <th>Profile</th>
                  </tr>
                </thead>
                <tbody>
                  {publishedPeople.map((person) => {
                    const publicFacts = person.facts.filter(publicFactFilter);
                    const publicBirth = publicFacts.find((fact) => isFactType(fact.type, "BIRT", "Birth"));
                    const publicDeath = publicFacts.find((fact) => isFactType(fact.type, "DEAT", "Death"));
                    const confidence = averageConfidence(publicFacts);

                    return <tr key={person.id}>
                  <td data-label="Name">
                    <div className="person-row-identity">
                      <PersonMonogram name={person.displayName} variant="small" />
                      <Link className="person-name-link" href={`/people/${person.slug}`}>
                        <span>{person.displayName}</span>
                        <small>{person.slug}</small>
                      </Link>
                    </div>
                  </td>
                  <td data-label="Birth">{formatVital(publicBirth?.date, publicBirth?.place)}</td>
                  <td data-label="Death">{formatVital(publicDeath?.date, publicDeath?.place)}</td>
                  <td data-label="Confidence">
                    {confidence === null ? <span className="muted">Not scored</span> : <Confidence value={confidence} />}
                  </td>
                  <td data-label="Status">
                    <Status>Published</Status>
                  </td>
                  <td data-label="Profile">
                    <Link className="row-action-link" href={`/people/${person.slug}`} aria-label={`Open ${person.displayName} profile`}>
                      Open
                      <Icons.ChevronRight size={14} aria-hidden />
                    </Link>
                  </td>
                </tr>;
                  })}
                </tbody>
              </table>
            </TableScroll>
          ) : (
            <EmptyState icon={<Icons.Users size={22} aria-hidden />} title="No public profiles yet">
              Profiles will appear here after privacy, living status, and selected facts have been reviewed.
            </EmptyState>
          )}
        </section>
      </div>
    </PublicShell>
  );
}

function formatVital(date?: string, place?: string): string {
  return [date, place].filter(Boolean).join(" · ") || "Unknown";
}

function isFactType(type: string, gedcomType: string, label: string): boolean {
  return type.toUpperCase() === gedcomType || type.toLowerCase() === label.toLowerCase();
}

function averageConfidence(facts: Array<{ confidence: number }>): number | null {
  return facts.length > 0 ? facts.reduce((sum, fact) => sum + fact.confidence, 0) / facts.length : null;
}
