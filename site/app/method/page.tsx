import Image from "next/image";
import { CtaStrip } from "@/components/cta-strip";
import { PageHero } from "@/components/page-hero";
import { pageMetadata } from "@/lib/metadata";

export const metadata = pageMetadata({
  title: "Research method",
  description: "How Kin Resolve supports focused questions, source-aware reasoning, explicit conflicts, uncertainty, and careful publication.",
  path: "/method/"
});

const principles = [
  ["Ask a focused question", "A useful case begins with something answerable: a birthplace conflict, an unknown parent, or the identity behind two records—not “finish the family tree.”"],
  ["Separate evidence from inference", "Record what a source actually says before explaining what you believe it means. The conclusion should never erase the observation."],
  ["Keep conflicts visible", "Conflicting dates and places are part of the evidence. Preserve them, compare their quality, and explain why one carries more weight."],
  ["Use DNA alongside records", "Shared DNA can support or challenge a documentary theory. It does not name an ancestor by itself, and a match score is not proof."],
  ["Show uncertainty", "Confidence belongs with the conclusion. “Probably,” “possibly,” and “not yet resolved” are useful research states—not product failures."],
  ["Publish the reviewed result", "The private workspace can hold ambiguity and sensitive material. Public history should reflect an intentional, privacy-aware review."]
] as const;

export default function MethodPage() {
  return (
    <>
      <PageHero
        eyebrow="Research method"
        lead="Kin Resolve is being shaped around disciplined, source-aware research. It helps organize the argument; it does not certify conclusions or replace professional judgment."
        primary="Explore the product"
        primaryHref="/product"
        title="Genealogy is an argument built from evidence."
      />

      <section className="shell section method-opening">
        <div className="method-image-wrap">
          <Image alt="Abstract archival contours for the fictional Hartwell–Mercer identity mystery" fill sizes="(max-width: 900px) 100vw, 45vw" src="/assets/archival-contours.webp" />
        </div>
        <div>
          <span className="eyebrow">A trail worth showing</span>
          <h2>The answer matters. So does the path to it.</h2>
          <p className="prose-large">A strong conclusion explains which sources were consulted, how conflicts were handled, why the evidence fits, and where uncertainty remains. Kin Resolve gives that reasoning a durable home beside the tree.</p>
          <p className="fiction-disclosure" role="note"><strong>Fictional demo:</strong> every Hartwell–Mercer name, date, place, record, photograph, story, and DNA match used in examples is invented.</p>
        </div>
      </section>

      <section className="section surface-section">
        <div className="shell">
          <div className="section-heading centered-heading narrow-heading"><span className="eyebrow">Six working principles</span><h2>A method for staying honest while the answer develops.</h2></div>
          <div className="principle-grid">
            {principles.map(([title, body], index) => (
              <article className="principle-card" key={title}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="shell section method-support">
        <div className="method-support-card current-support">
          <span className="eyebrow">Supported today</span>
          <h2>Structure for the current investigation.</h2>
          <p>Cases, evidence items, hypotheses, tasks, confidence values, source-coverage checks, date-conflict checks, and referenced analysis context are available in the current beta.</p>
        </div>
        <div className="method-support-card future-support">
          <span className="eyebrow">In development</span>
          <h2>Deeper evidence discipline.</h2>
          <p>Explicit search checklists, forced conflict review, citation templates, confidence categories, semantic retrieval, and the grounded research agent remain roadmap work.</p>
        </div>
      </section>

      <section className="shell section research-caution">
        <span aria-hidden="true">“</span>
        <blockquote>Kin Resolve can help you organize a defensible conclusion. It cannot make an incomplete search exhaustive or turn an inference into proof.</blockquote>
      </section>

      <div className="shell section"><CtaStrip eyebrow="Test the method" title="Bring the question that still has two answers." /></div>
    </>
  );
}
