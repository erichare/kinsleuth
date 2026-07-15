import { BetaForm } from "@/components/beta-form";
import { PageHero } from "@/components/page-hero";
import { betaStatus } from "@/lib/beta-status";
import { pageMetadata } from "@/lib/metadata";
import { site } from "@/lib/site";

export const metadata = pageMetadata({
  title: "Private beta",
  description: betaStatus.metadataDescription,
  path: "/beta/"
});

const faqs = [
  ["Is the beta free?", "Pricing has not been announced. Any cost, limits, and data terms will be clear before a participant is asked to upload family data."],
  ["When will I get access?", "Cohorts will be deliberately small. Applying records interest but does not guarantee immediate access."],
  ["Can I self-host?", "The AGPL source is available now. The current Compose path is suitable for development and beta evaluation while production hardening continues."],
  ["Can I upload family data?", "Not when applying. The first hosted experience uses synthetic records. One isolated plain-GEDCOM pilot may accept real family data only after the legal, restore, deletion, recovery, and security gates pass."],
  ["Can I upload DNA data?", "No. DNA uploads and triage are disabled for the first hosted cohort. Never attach DNA or family records to a beta-interest email."],
  ["What makes a useful beta tester?", "A real research workflow, comfort with unfinished software, and willingness to describe where the process or interface breaks down."]
] as const;

export default function BetaPage() {
  return (
    <>
      <PageHero
        eyebrow={betaStatus.badge}
        lead={`${betaStatus.summary} We’re prioritizing family historians and genealogists with rigorous source, GEDCOM, and case workflows—and the patience to give detailed feedback.`}
        note="Applying does not create an account or guarantee immediate access."
        primary="Start the application"
        primaryHref="#apply"
        title="Help shape a more rigorous genealogy research workspace."
      />

      <section className="shell section beta-fit-grid" data-beta-status-surface="beta">
        <div><span className="eyebrow">A strong fit</span><h2>You have a research process to test—not just a feature list.</h2></div>
        <div className="fit-cards"><article><strong>Bring</strong><p>An unresolved question and a workflow you know well. Do not send records with the application.</p></article><article><strong>Expect</strong><p>{betaStatus.headline} {betaStatus.rollout} Applying does not guarantee immediate access.</p></article><article><strong>Protect</strong><p>Living people and sensitive data. The application itself should contain no family records.</p></article></div>
      </section>

      <section className="section surface-section" id="apply">
        <div className="shell application-grid">
          <div className="application-intro"><span className="eyebrow">Beta interest</span><h2>Tell us about the work you want to test.</h2><p>{site.betaIntakeReady ? `The intake opens a prepared email addressed to ${site.betaEmail}. The marketing site does not store your submission.` : "The proposed intake opens an email application rather than storing submissions on the marketing site. Delivery stays disabled until the beta mailbox is verified."}</p><div className="application-boundary"><strong>Please do not submit</strong><span>GEDCOM files, DNA results, names of living people, source images, credentials, or private family details.</span></div></div>
          <BetaForm />
        </div>
      </section>

      <section className="shell section faq-section">
        <div className="section-heading"><span className="eyebrow">Questions before applying</span><h2>Small cohorts, clear boundaries.</h2></div>
        <div className="faq-list">{faqs.map(([question, answer]) => <details key={question}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</div>
      </section>
    </>
  );
}
