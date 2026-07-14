import Link from "next/link";
import Image from "next/image";
import { Icons } from "@/components/icons";
import { PublicShell } from "@/components/public-shell";
import { Status, TableScroll } from "@/components/ui";
import { canPublishPerson, publicFactFilter } from "@/lib/privacy";
import { readWorkspace } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const workspace = await readWorkspace();
  const publishedPeople = workspace.people
    .filter((person) => person.published && canPublishPerson(person))
    .map((person) => {
      const publicFacts = person.facts.filter(publicFactFilter);
      return {
        person,
        publicFacts,
        publicBirth: publicFacts.find((fact) => fact.type.toUpperCase() === "BIRT" || fact.type.toLowerCase() === "birth")
      };
    });
  const publishedFactCount = publishedPeople.reduce((total, { publicFacts }) => total + publicFacts.length, 0);

  return (
    <PublicShell active="/" tagline={workspace.archiveTagline}>
      <div className="page-wrap">
        <section className="hero">
          <div>
            <span className="eyebrow">Public family archive</span>
            <h1>{workspace.archiveName}</h1>
            <p>A family-history archive for profiles explicitly published after person-level privacy checks. Private research, DNA triage, and living-person details stay in the signed-in workspace.</p>
            <p className="fiction-disclosure" role="note">
              <strong>Fictional demo universe.</strong> Every demo name, date, place, record, photograph, story, and DNA match is invented. No real family data is used in the Hartwell–Mercer examples.
            </p>
            <div className="hero-actions">
              <Link className="button" href="/people">
                <Icons.Users size={17} aria-hidden />
                Explore People
              </Link>
              <Link className="button-secondary" href="/stories">
                <Icons.BookOpen size={17} aria-hidden />
                View Demo Stories
              </Link>
            </div>
          </div>
          <figure className="map-panel surface-featured">
            <Image
              className="map-art"
              src="/assets/hartwell-mercer-blue-tin.webp"
              alt="Fictional Hartwell–Mercer blue tin, ferry papers, three-person harbor photograph, violet note, and clue map"
              fill
              priority
              sizes="(max-width: 960px) calc(100vw - 40px), 620px"
            />
            <span className="map-pin map-pin--lantern-bay">
              <Icons.MapPin size={15} aria-hidden />
              Lantern Bay, WI
            </span>
            <span className="map-pin map-pin--northstar-cove">
              <Icons.MapPin size={15} aria-hidden />
              Northstar Cove, NS
            </span>
            <span className="map-pin map-pin--ceraluna-alta">
              <Icons.MapPin size={15} aria-hidden />
              Ceraluna Alta, Italy
            </span>
            <figcaption className="map-caption">Fictional clue map · Hartwell–Mercer demo</figcaption>
          </figure>
        </section>

        <section className="section grid-2">
          <div className="table-panel home-records-panel">
            <div className="section-heading">
              <span className="card-kicker">Archive index</span>
              <h2>Selected records</h2>
            </div>
            <TableScroll label="Selected published records and illustrative archive rows">
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
                    <td data-label="Title">Hartwell–Mercer blue-tin clue map</td>
                    <td data-label="Date">1906–1922 (fictional)</td>
                    <td data-label="Visibility"><Status tone="warning">Demo</Status></td>
                  </tr>
                  <tr>
                    <td data-label="Type"><Icons.Shield size={16} aria-hidden /></td>
                    <td data-label="Title">Fictional records, research cases, photographs, and DNA matches</td>
                    <td data-label="Date">Demo only</td>
                    <td data-label="Visibility"><Status tone="private">Private</Status></td>
                  </tr>
                </tbody>
              </table>
            </TableScroll>
          </div>
          <aside className="panel surface-quiet archive-summary">
            <span className="card-kicker">Privacy by design</span>
            <h2>About this archive</h2>
            <p>This public archive is curated from a larger private research database. Private imports, source analysis, AI runs, and DNA matches are available only in the signed-in workspace.</p>
            <div className="archive-stat-grid">
              <div className="archive-stat">
                <Icons.Users size={18} aria-hidden />
                <strong>{publishedPeople.length.toLocaleString()}</strong>
                <div className="muted">published profiles</div>
              </div>
              <div className="archive-stat">
                <Icons.Database size={18} aria-hidden />
                <strong>{publishedFactCount.toLocaleString()}</strong>
                <div className="muted">public facts</div>
              </div>
            </div>
          </aside>
        </section>
      </div>
    </PublicShell>
  );
}
