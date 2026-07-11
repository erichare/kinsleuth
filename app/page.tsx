import Link from "next/link";
import Image from "next/image";
import { Icons } from "@/components/icons";
import { PublicShell } from "@/components/public-shell";
import { Status, TableScroll } from "@/components/ui";
import { countSourceReferences } from "@/lib/dashboard";
import { canPublishPerson, publicFactFilter } from "@/lib/privacy";
import { readWorkspace } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const workspace = await readWorkspace();
  const publishedPeople = workspace.people
    .filter((person) => person.published && canPublishPerson(person))
    .map((person) => ({
      person,
      publicBirth: person.facts.filter(publicFactFilter).find((fact) => fact.type.toUpperCase() === "BIRT" || fact.type.toLowerCase() === "birth")
    }));

  return (
    <PublicShell active="/" tagline={workspace.archiveTagline}>
      <div className="page-wrap">
        <section className="hero">
          <div>
            <span className="eyebrow">Public family archive</span>
            <h1>{workspace.archiveName}</h1>
            <p>A curated family-history archive for published ancestor profiles, places, stories, and selected citations. Private research, DNA triage, and living-person details stay protected.</p>
            <div className="hero-actions">
              <Link className="button" href="/people">
                <Icons.Users size={17} aria-hidden />
                Explore People
              </Link>
              <Link className="button-secondary" href="/stories">
                <Icons.BookOpen size={17} aria-hidden />
                Browse Stories
              </Link>
            </div>
          </div>
          <figure className="map-panel surface-featured">
            <Image
              className="map-art"
              src="/assets/archive-migration-map.webp"
              alt="Illustrated migration route connecting Chicago, Limerick, and Cornwall"
              fill
              priority
              sizes="(max-width: 960px) calc(100vw - 40px), 620px"
            />
            <span className="map-pin map-pin--chicago">
              <Icons.MapPin size={15} aria-hidden />
              Chicago
            </span>
            <span className="map-pin map-pin--limerick">
              <Icons.MapPin size={15} aria-hidden />
              Limerick
            </span>
            <span className="map-pin map-pin--cornwall">
              <Icons.MapPin size={15} aria-hidden />
              Cornwall
            </span>
            <figcaption className="map-caption">Illustrative demo route · 1880–1910</figcaption>
          </figure>
        </section>

        <section className="section grid-2">
          <div className="table-panel home-records-panel">
            <div className="section-heading">
              <span className="card-kicker">Archive index</span>
              <h2>Selected records</h2>
            </div>
            <TableScroll label="Selected public and private archive records">
              <table className="data-table responsive-table compact-public-table">
                <thead>
                  <tr><th>Type</th><th>Title</th><th>Date</th><th>Visibility</th></tr>
                </thead>
                <tbody>
                  {publishedPeople.map(({ person, publicBirth }) => (
                    <tr key={person.id}>
                      <td data-label="Type"><Icons.Users size={16} aria-hidden /></td>
                      <td data-label="Title"><Link href={`/people/${person.slug}`}>{person.displayName}</Link></td>
                      <td data-label="Date">{publicBirth?.date ?? "Date withheld"}</td>
                      <td data-label="Visibility"><Status>Published</Status></td>
                    </tr>
                  ))}
                  <tr>
                    <td data-label="Type"><Icons.MapPin size={16} aria-hidden /></td>
                    <td data-label="Title">Chicago / Limerick / Cornwall migration path</td>
                    <td data-label="Date">1880-1910</td>
                    <td data-label="Visibility"><Status tone="warning">Demo</Status></td>
                  </tr>
                  <tr>
                    <td data-label="Type"><Icons.Shield size={16} aria-hidden /></td>
                    <td data-label="Title">Private investigations and DNA matches</td>
                    <td data-label="Date">Protected</td>
                    <td data-label="Visibility"><Status tone="private">Private</Status></td>
                  </tr>
                </tbody>
              </table>
            </TableScroll>
          </div>
          <aside className="panel surface-quiet archive-summary">
            <span className="card-kicker">Privacy by design</span>
            <h2>About this archive</h2>
            <p>This public archive is manually curated from a larger private research database. KinSleuth keeps imported records, source analysis, AI runs, and DNA matches behind role-based access controls.</p>
            <div className="archive-stat-grid">
              <div className="archive-stat">
                <Icons.Users size={18} aria-hidden />
                <strong>{workspace.people.length.toLocaleString()}</strong>
                <div className="muted">people imported</div>
              </div>
              <div className="archive-stat">
                <Icons.Database size={18} aria-hidden />
                <strong>{workspace.sources.length.toLocaleString()}</strong>
                <div className="muted">source documents</div>
              </div>
              <div className="archive-stat">
                <Icons.BookOpen size={18} aria-hidden />
                <strong>{countSourceReferences(workspace).toLocaleString()}</strong>
                <div className="muted">citations</div>
              </div>
            </div>
          </aside>
        </section>
      </div>
    </PublicShell>
  );
}
