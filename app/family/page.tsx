import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Icons } from "@/components/icons";
import { PublicShell } from "@/components/public-shell";
import { PersonMonogram, Status, TableScroll } from "@/components/ui";
import { readPublicFamilyProjection } from "@/lib/public-family";
import { privateWorkspaceLoginPath, publicArchiveEnabled } from "@/lib/public-surface";

export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Hartwell–Mercer Family Archive · Kin Resolve",
  description: "Explore eight fictional Hartwell–Mercer profiles and seven curated source citations.",
  robots: { index: true, follow: true },
  alternates: { canonical: "/family" }
};

export default async function FamilyPage() {
  if (!publicArchiveEnabled()) {
    redirect(privateWorkspaceLoginPath);
  }

  const family = await readPublicFamilyProjection();
  const publicFactCount = family.people.reduce((total, person) => total + person.facts.length, 0);
  const personNames = new Map(family.people.map((person) => [person.id, person.displayName]));

  return (
    <PublicShell active="/family" tagline={family.archiveTagline}>
      <div className="page-wrap public-family-archive" data-public-family-archive>
        <section className="page-title section public-family-intro">
          <span className="eyebrow">Public family archive</span>
          <h1>{family.archiveName}</h1>
          <p>
            Explore the curated public side of Kin Resolve through eight deceased fictional profiles and seven source
            citations. Research cases, source detail, DNA, imports, and analysis remain outside this projection.
          </p>
          <p className="fiction-disclosure" role="note">
            <strong>Everything here is fictional.</strong> Every name, date, place, and citation was invented for this
            demonstration. No real family data appears in the Hartwell–Mercer archive.
          </p>
          <div className="public-family-metrics" aria-label="Public archive totals">
            <span><strong>{family.people.length}</strong> published profiles</span>
            <span><strong>{publicFactCount}</strong> public facts</span>
            <span><strong>{family.citations.length}</strong> curated citations</span>
          </div>
        </section>

        <section aria-labelledby="public-family-people" className="section public-family-section">
          <div className="section-heading heading-row">
            <div>
              <span className="card-kicker">Eight connected lives</span>
              <h2 id="public-family-people">Published profiles</h2>
            </div>
            <Link className="button-secondary" href="/people">Open the people index</Link>
          </div>
          <div className="public-family-person-grid">
            {family.people.map((person) => (
              <article className="public-family-person" key={person.id}>
                <PersonMonogram name={person.displayName} variant="small" />
                <div>
                  <h3><Link href={`/people/${person.slug}`}>{person.displayName}</Link></h3>
                  <p>{formatVital(person.birthDate, person.birthPlace)} – {formatVital(person.deathDate, person.deathPlace)}</p>
                  <Status>Published</Status>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section aria-labelledby="public-family-citations" className="section public-family-section">
          <div className="section-heading">
            <span className="card-kicker">Safe public metadata</span>
            <h2 id="public-family-citations">Curated source citations</h2>
            <p>
              Citation titles and repositories are public here. Private source text and research work remain outside
              the public family surface.
            </p>
          </div>
          <div className="table-panel">
            <TableScroll label="Seven fictional public source citations">
              <table className="data-table responsive-table public-family-citation-table">
                <thead>
                  <tr><th>Source</th><th>Type</th><th>Repository</th><th>Date</th><th>Profile</th></tr>
                </thead>
                <tbody>
                  {family.citations.map((citation) => (
                    <tr key={citation.id}>
                      <td data-label="Source"><strong>{citation.title}</strong></td>
                      <td data-label="Type">{citation.sourceType}</td>
                      <td data-label="Repository">{citation.repository ?? "Fictional family archive"}</td>
                      <td data-label="Date">{citation.citationDate ?? "Undated"}</td>
                      <td data-label="Profile">{citation.linkedPersonId ? personNames.get(citation.linkedPersonId) ?? "—" : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </div>
        </section>

        <section className="challenge-story-cta" aria-labelledby="public-family-next-step">
          <div>
            <span className="card-kicker">Ready to investigate?</span>
            <h2 id="public-family-next-step">Work the evidence in a temporary demo workspace.</h2>
            <p>Start from the demo landing page; no account or real family records are needed.</p>
          </div>
          <Link className="button" href="/">
            <Icons.FileSearch aria-hidden size={17} />
            Choose a demo path
          </Link>
        </section>
      </div>
    </PublicShell>
  );
}

function formatVital(date?: string, place?: string): string {
  return [date, place].filter(Boolean).join(" · ") || "Unknown";
}
