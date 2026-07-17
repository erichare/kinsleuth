import Link from "next/link";
import Image from "next/image";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { DemoStartForm } from "@/components/demo-start-form";
import { Icons } from "@/components/icons";
import { PublicShell } from "@/components/public-shell";
import { Status, TableScroll } from "@/components/ui";
import { publicDemoGuidedCaseTitle } from "@/lib/public-demo-contract";
import { publicDemoEnabled } from "@/lib/public-demo-config";
import { recordPublicDemoEvent } from "@/lib/public-demo-session-store";
import { privateWorkspaceLoginPath, publicArchiveEnabled, resolvePublicArchiveId } from "@/lib/public-surface";
import { listPublicPeople, readArchiveBranding } from "@/lib/store/people-queries";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  if (!publicArchiveEnabled()) {
    redirect(privateWorkspaceLoginPath);
  }
  if (publicDemoEnabled()) {
    const requestHeaders = await headers();
    if (!requestHeaders.has("x-kinresolve-demo-canary")) {
      try {
        await recordPublicDemoEvent({ eventName: "landing_viewed" });
      } catch {
        // Aggregate telemetry must never prevent the public landing page.
      }
    }
    return <PublicDemoLanding />;
  }
  const publicArchiveId = resolvePublicArchiveId();
  const archiveOptions = { archiveId: publicArchiveId };
  const [branding, publicPeople] = await Promise.all([
    readArchiveBranding(archiveOptions),
    listPublicPeople(archiveOptions)
  ]);
  const publishedPeople = publicPeople
    .map((person) => {
      return {
        person,
        publicFacts: person.facts,
        publicBirth: person.facts.find((fact) => fact.type.toUpperCase() === "BIRT" || fact.type.toLowerCase() === "birth")
      };
    });
  const publishedFactCount = publishedPeople.reduce((total, { publicFacts }) => total + publicFacts.length, 0);

  return (
    <PublicShell active="/" tagline={branding.tagline}>
      <div className="page-wrap">
        <section className="hero">
          <div>
            <span className="eyebrow">Public family archive</span>
            <h1>{branding.name}</h1>
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
            <Link className="challenge-easter-egg-link" href="/challenge">
              Open the fictional record desk: test your genealogical skills →
            </Link>
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

function PublicDemoLanding() {
  return (
    <PublicShell active="/" tagline="A fictional family. A real research workflow.">
      <div className="page-wrap public-demo-landing" data-public-demo-landing>
        <section className="public-demo-hero">
          <div className="public-demo-hero-copy">
            <span className="eyebrow">Public interactive demo</span>
            <h1>Try Kin Resolve with a fictional family.</h1>
            <p>
              Follow a real evidence-led research workflow through the invented Hartwell–Mercer archive. No account,
              email address, or family records are required.
            </p>
          </div>

          <div className="public-demo-notice" id="public-demo-notice" role="note">
            <Icons.Shield aria-hidden size={22} />
            <div>
              <strong>Safe, synthetic, and temporary.</strong>
              <p>
                Every person and record is fictional. Your private demo workspace expires after 24 hours. Do not enter real family data.
                Only curated synthetic context may be sent to the configured AI provider. Coarse usage events are retained for 30 days.
              </p>
            </div>
          </div>

          <div aria-label="Choose a demo path" className="public-demo-paths">
            <article className="public-demo-path public-demo-path-primary">
              <Icons.FileSearch aria-hidden size={24} />
              <span className="card-kicker">About two minutes</span>
              <h2>Work the passenger mystery</h2>
              <p>
                Compare two signatures, record a bounded outcome, and reveal the next assignment in
                {` ${publicDemoGuidedCaseTitle}`}.
              </p>
              <DemoStartForm />
            </article>

            <article className="public-demo-path">
              <Icons.Users aria-hidden size={24} />
              <span className="card-kicker">Read-only archive</span>
              <h2>Meet the family first</h2>
              <p>Browse a complete four-generation tree and its curated profiles and citations without starting a session.</p>
              <Link className="button-secondary" href="/family">
                Explore the fictional family
              </Link>
            </article>

            <article className="public-demo-path">
              <Icons.BookOpen aria-hidden size={24} />
              <span className="card-kicker">Browser-local challenge</span>
              <h2>Test your research instincts</h2>
              <p>Investigate five cases and thirty synthetic records. Progress stays only in this browser.</p>
              <Link className="button-secondary" href="/challenge">
                Try the research challenge
              </Link>
            </article>
          </div>
        </section>
      </div>
    </PublicShell>
  );
}
