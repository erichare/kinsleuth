import Link from "next/link";
import { CtaStrip } from "@/components/cta-strip";
import { PageHero } from "@/components/page-hero";
import { pageMetadata } from "@/lib/metadata";

export const metadata = pageMetadata({
  title: "Privacy and data practices",
  description: "Current Kin Resolve privacy controls, AI-provider disclosures, beta limitations, and data-portability principles.",
  path: "/privacy/"
});

const currentControls = [
  ["Private workspace access", "Research pages and APIs require an authenticated archive membership in configured deployments."],
  ["Manual person publication", "A profile is not public merely because it was imported. Current publication requires an explicit person-level decision."],
  ["Living-person gates", "Living, private, sensitive, and unresolved life-status records are withheld from anonymous person views."],
  ["Optional external AI", "The deterministic checks do not need an AI provider. Provider-backed analysis is enabled only by the archive operator."],
  ["An exit path", "Full GEDCOM export helps keep the family archive portable rather than dependent on one hosted service."],
  ["Synthetic project data", "The public repository and project demos use synthetic fixtures. Real genealogy and DNA files do not belong in source control."]
] as const;

export default function PrivacyPage() {
  return (
    <>
      <PageHero
        eyebrow="Privacy and data practices"
        lead="Genealogy data is relational: one person’s upload can describe many relatives who never agreed to be part of a service. Kin Resolve treats privacy as a publication decision, not a footer promise."
        primary="View current controls"
        primaryHref="#current-controls"
        title="Private by default. Published by decision."
      />

      <section className="shell section privacy-principle">
        <span className="privacy-seal" aria-hidden="true">P</span>
        <div><span className="eyebrow">Product principle</span><h2>The private archive and public story are different surfaces.</h2><p className="prose-large">Imported records, research notes, DNA clues, cases, and unfinished hypotheses need a private place to develop. Public family history should contain only what an owner has reviewed and intentionally shared.</p></div>
      </section>

      <section className="section surface-section" id="current-controls">
        <div className="shell">
          <div className="section-heading"><span className="eyebrow">Current source controls</span><h2>What the software implements today.</h2></div>
          <div className="privacy-grid">
            {currentControls.map(([title, body], index) => <article key={title}><span>0{index + 1}</span><h3>{title}</h3><p>{body}</p></article>)}
          </div>
        </div>
      </section>

      <section className="shell section ai-disclosure">
        <div className="disclosure-mark" aria-hidden="true">AI</div>
        <div>
          <span className="eyebrow">External provider disclosure</span>
          <h2>Private context may leave the deployment when external AI is enabled.</h2>
          <p>When an operator configures an OpenAI-compatible provider, private workspace context may be sent to that provider to answer a research question. Provider choice, retention terms, and data handling remain the operator’s responsibility.</p>
          <p>Do not configure provider-backed analysis for sensitive family or genetic information until you have evaluated that provider and your legal obligations.</p>
        </div>
      </section>

      <section className="section limitation-section">
        <div className="shell limitation-grid">
          <div><span className="eyebrow eyebrow-light">Hosted-beta boundary</span><h2>Important controls are still in development.</h2></div>
          <div><p>Multi-tenant isolation, invitations, hosted genetic-data consent, deletion workflows, breach operations, and counsel-approved compliance controls are not complete.</p><p>Kin Resolve does not currently claim GDPR compliance, production-grade hosted DNA handling, guaranteed backups, or complete fact-level publication control.</p></div>
        </div>
      </section>

      <section className="shell section privacy-roadmap">
        <div className="section-heading"><span className="eyebrow">Before hosted access opens</span><h2>The privacy work that cannot be waved away.</h2></div>
        <ol><li><strong>Tenant isolation</strong><span>Propagate archive context everywhere and enforce database policies against cross-archive reads.</span></li><li><strong>Consent and retention</strong><span>Define what can be collected, why, for how long, and how a person can revoke or delete it.</span></li><li><strong>Operational controls</strong><span>Test restore paths, safe errors, monitoring, incident response, and durable abuse limits.</span></li><li><strong>Legal review</strong><span>Publish counsel-approved privacy terms before accepting hosted family or genetic data.</span></li></ol>
      </section>

      <section className="shell section practice-note"><strong>This is a product-practices page—not a legal privacy policy.</strong><p>Counsel-reviewed legal terms will be published before public hosted accounts accept family data. Beta applicants should submit only contact and workflow information.</p><Link className="arrow-link" href="/beta">Read the beta boundaries <span aria-hidden="true">→</span></Link></section>

      <div className="shell section"><CtaStrip eyebrow="Privacy-minded beta" title="Help test the boundary between private research and public history." /></div>
    </>
  );
}
