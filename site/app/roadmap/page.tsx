import { PageHero } from "@/components/page-hero";
import { betaStatus } from "@/lib/beta-status";
import { pageMetadata } from "@/lib/metadata";
import { roadmapSections } from "@/lib/roadmap";
import { site } from "@/lib/site";

export const metadata = pageMetadata({
  title: "Roadmap",
  description:
    "What is merged in the Kin Resolve source, what is in progress behind named launch gates, and what remains exploration—stated without inflating any claim.",
  path: "/roadmap/"
});

export default function RoadmapPage() {
  return (
    <>
      <PageHero
        eyebrow="Build in public"
        lead="Kin Resolve separates what is merged and tested in the public source from what is still gated, queued, or only being explored. In progress is not the same as available, and this page says which is which."
        showGithub
        title="The roadmap is part of the trust model."
      />

      <section className="shell product-intro-grid section">
        <div><span className="eyebrow">How to read this page</span><h2>Five states, one discipline.</h2></div>
        <p className="prose-large">Shipped is a code-state claim you can check against the repository. Everything else is labeled by the gate it still has to pass, so the distance between a claim and the current code stays visible. {betaStatus.summary}</p>
      </section>

      {roadmapSections.map((section, index) => (
        <section className="shell section privacy-roadmap" key={section.id}>
          <div className="section-heading">
            <span className="status-heading"><i aria-hidden="true" className={`status-dot ${section.tone}`} /> {String(index + 1).padStart(2, "0")} / {section.label}</span>
            <h2>{section.headline}</h2>
            <p>{section.note}</p>
          </div>
          <ol>
            {section.items.map((item) => (
              <li key={item.title}><strong>{item.title}</strong><span>{item.detail}</span></li>
            ))}
          </ol>
        </section>
      ))}

      <section className="shell section public-roadmap">
        <div><span className="eyebrow">The canonical record</span><h2>This page is a summary, not the source of truth.</h2></div>
        <div>
          <p>The canonical roadmap lives in the repository as <code>ROADMAP.md</code>, where each item links to the plan or design document behind it. The <code>plans/</code> directory holds the working planning documents themselves—planning documents, not claims surfaces.</p>
          <p>If this page and the repository ever disagree, trust the repository and tell us.</p>
          <div className="hero-actions">
            <a className="button button-secondary" href={`${site.github}/blob/main/ROADMAP.md`}>Read ROADMAP.md <span aria-hidden="true">↗</span></a>
            <a className="button button-secondary" href={`${site.github}/tree/main/plans`}>Browse the plans directory <span aria-hidden="true">↗</span></a>
          </div>
        </div>
      </section>
    </>
  );
}
