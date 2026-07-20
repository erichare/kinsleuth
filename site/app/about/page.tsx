import Link from "next/link";
import { CtaStrip } from "@/components/cta-strip";
import { PageHero } from "@/components/page-hero";
import { pageMetadata } from "@/lib/metadata";
import { site } from "@/lib/site";

export const metadata = pageMetadata({
  title: "About",
  description: "Why Kin Resolve is being built around evidence discipline, privacy, portability, and open development.",
  path: "/about/"
});

export default function AboutPage() {
  return (
    <>
      <PageHero
        eyebrow="About Kin Resolve"
        lead="Family trees are good at displaying settled answers. The difficult work happens in sources, contradictions, DNA clues, and unfinished questions. Kin Resolve is an independent open-source project for that work."
        showGithub
        title="Built for the space between a clue and a conclusion."
      />

      <section className="shell section origin-section">
        <div className="origin-marker" aria-hidden="true"><span>KR</span><small>2026</small></div>
        <div>
          <span className="eyebrow">Why this project exists</span>
          <h2>The research deserves a first-class workspace.</h2>
          <p className="prose-large">Most genealogy software centers the tree. Kin Resolve starts from a different premise: the tree is one output of an ongoing investigation. The source trail, competing explanations, confidence, and privacy decisions deserve to remain visible too.</p>
          <p>The project is being built in public by Eric Hare—one person writing the source, tests, migrations, and planning documents in the same open repository, under AGPL-3.0-only. That discipline is deliberate: every claim the site makes about the product can be checked against the code that makes it.</p>
          <p>The same caution shapes the demo data. The Hartwell–Mercer records are synthetic fixtures, invented so the product can be evaluated honestly—conflicts, dead ends, and all—before any real family is asked to trust it with theirs.</p>
          {/* Founder-bio enrichment (personal research history, photo, longer origin story) is
              drafted separately and awaits owner sign-off. Until then this section states only
              repo-verifiable facts. */}
        </div>
      </section>

      <section className="section principles-band">
        <div className="shell about-principles"><article><span>01</span><h3>Evidence over certainty theater</h3><p>Preserve conflict and uncertainty rather than manufacturing a cleaner story than the sources support.</p></article><article><span>02</span><h3>Private research by default</h3><p>Give unfinished work a protected home and make publication an explicit review decision.</p></article><article><span>03</span><h3>Portability over lock-in</h3><p>Keep source code inspectable and maintain a practical path to export the archive.</p></article><article><span>04</span><h3>A public, honest roadmap</h3><p>Label beta limitations and future work instead of selling planned capabilities as finished.</p></article></div>
      </section>

      <section className="shell section public-roadmap">
        <div><span className="eyebrow">Build in public</span><h2>The roadmap is part of the trust model.</h2></div>
        <div><p>Security, storage portability, tenancy, privacy controls, and evidence grounding are not invisible chores. They determine whether the product deserves real family data.</p><p>Design notes, implementation, tests, and production-readiness work live alongside the source—summarized on the <Link href="/roadmap">public roadmap</Link>—so the gap between a claim and the current code can be examined.</p><Link className="button button-secondary" href="/roadmap">Follow the roadmap</Link></div>
      </section>

      <div className="shell section"><CtaStrip eyebrow="Shape the next chapter" primaryHref="/beta" primaryLabel="Apply for the private beta" secondaryHref={site.github} secondaryLabel="View on GitHub" title="Bring your research process to the private beta." /></div>
    </>
  );
}
