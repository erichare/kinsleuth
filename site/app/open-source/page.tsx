import { CtaStrip } from "@/components/cta-strip";
import { PageHero } from "@/components/page-hero";
import { pageMetadata } from "@/lib/metadata";
import { site } from "@/lib/site";

export const metadata = pageMetadata({
  title: "Open source",
  description: "Kin Resolve is AGPL-3.0-only genealogy research software with Postgres persistence, GEDCOM export, and optional provider-backed AI.",
  path: "/open-source/"
});

export default function OpenSourcePage() {
  return (
    <>
      <PageHero
        eyebrow="Open source and portable"
        lead="Kin Resolve is AGPL-3.0-only software backed by Postgres, with full GEDCOM export and an optional OpenAI-compatible provider. Inspect it, run it, and help improve it."
        primary="View on GitHub"
        primaryHref={site.github}
        title="Your family archive should not depend on one service."
      />

      <section className="shell section open-principles">
        <article><span className="open-icon" aria-hidden="true">01</span><h2>Source you can inspect</h2><p>The application code, schema migrations, tests, and roadmap are public. Product claims can be checked against the implementation.</p></article>
        <article><span className="open-icon" aria-hidden="true">02</span><h2>An archive you can export</h2><p>Full GEDCOM 5.5.1 export keeps the family archive portable, including Kin Resolve curation flags for round trips between compatible instances.</p></article>
        <article><span className="open-icon" aria-hidden="true">03</span><h2>AI you can choose</h2><p>Run deterministic checks without a provider, or configure an OpenAI-compatible endpoint under the operator’s own account and policies.</p></article>
      </section>

      <section className="section code-section">
        <div className="shell code-grid">
          <div>
            <span className="eyebrow eyebrow-light">Current self-hosted beta</span>
            <h2>Run the research workspace yourself.</h2>
            <p>The current Compose setup starts the application and Postgres-backed development services for evaluation. Production hardening and portable object storage remain in progress.</p>
            <a className="button button-light" href={site.github}>Read the repository <span aria-hidden="true">↗</span></a>
          </div>
          <div className="terminal-card" aria-label="Git commands to clone Kin Resolve">
            <div className="terminal-top"><span /><span /><span /><small>Terminal</small></div>
            <pre><code><span>$</span> git clone https://github.com/erichare/kinresolve.git{"\n"}<span>$</span> cd kinresolve{"\n"}<span>$</span> cp .env.example .env{"\n"}<span>$</span> docker compose up --build</code></pre>
          </div>
        </div>
      </section>

      <section className="shell section license-section">
        <div><span className="license-mark">AGPL</span><small>Version 3</small></div>
        <div><span className="eyebrow">The license</span><h2>Open improvements stay available to users.</h2><p>The GNU Affero General Public License applies when you copy, modify, distribute, or run a modified version as a network service. Review the repository’s LICENSE and contribution terms for the actual conditions.</p><a className="arrow-link" href={`${site.github}/blob/main/LICENSE`}>Read the license <span aria-hidden="true">↗</span></a></div>
      </section>

      <section className="section surface-section">
        <div className="shell contribute-grid">
          <div><span className="eyebrow">Contribute</span><h2>Useful help starts with a reproducible problem.</h2></div>
          <div className="contribute-cards"><a href={`${site.github}/issues`}><strong>Report an issue</strong><span>Share a focused bug or product gap with safe, synthetic reproduction data. ↗</span></a><a href={`${site.github}/blob/main/CONTRIBUTING.md`}><strong>Read the contribution guide</strong><span>Understand sign-off, licensing, testing, and data-safety expectations. ↗</span></a></div>
        </div>
      </section>

      <div className="shell section"><CtaStrip body="The repository shows what is available, what is being repaired, and what remains only a roadmap idea." eyebrow="Open development" secondaryHref={site.github} secondaryLabel="View on GitHub" title="Follow the hardening work in public." /></div>
    </>
  );
}
