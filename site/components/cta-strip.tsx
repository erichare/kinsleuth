import Link from "next/link";
import { demoLive, demoStatus } from "@/lib/demo-status";
import { site } from "@/lib/site";

const defaultContent = demoLive
  ? {
      eyebrow: "Try it now",
      title: "Work a real mystery before you apply.",
      body: "Solve the fictional passenger mystery in a disposable synthetic workspace, then bring your own research workflow to the private beta. Apply with the workflow—not private records.",
      primaryLabel: demoStatus.ctaLabel,
      primaryHref: demoStatus.ctaHref,
      secondaryLabel: "Apply for the private beta",
      secondaryHref: "/beta"
    }
  : {
      eyebrow: "Private beta",
      title: "Bring a real research question to Kin Resolve.",
      body: "We’re looking for family historians willing to test GEDCOM review, source, research-case, deterministic-check, and export workflows. Apply with the workflow—not private records.",
      primaryLabel: "Apply for the private beta",
      primaryHref: "/beta",
      secondaryLabel: "View on GitHub",
      secondaryHref: site.github
    };

export function CtaStrip({
  eyebrow = defaultContent.eyebrow,
  title = defaultContent.title,
  body = defaultContent.body,
  primaryLabel = defaultContent.primaryLabel,
  primaryHref = defaultContent.primaryHref,
  secondaryLabel = defaultContent.secondaryLabel,
  secondaryHref = defaultContent.secondaryHref
}: {
  eyebrow?: string;
  title?: string;
  body?: string;
  primaryLabel?: string;
  primaryHref?: string;
  secondaryLabel?: string;
  secondaryHref?: string;
}) {
  const primaryAction = primaryHref.startsWith("http") ? (
    <a className="button button-light" href={primaryHref}>{primaryLabel} <span aria-hidden="true">↗</span></a>
  ) : (
    <Link className="button button-light" href={primaryHref}>{primaryLabel}</Link>
  );
  const secondaryAction = secondaryHref.startsWith("http") ? (
    <a className="button button-ghost-light" href={secondaryHref}>{secondaryLabel} <span aria-hidden="true">↗</span></a>
  ) : (
    <Link className="button button-ghost-light" href={secondaryHref}>{secondaryLabel}</Link>
  );

  return (
    <section className="cta-band section-shell" aria-labelledby="cta-title">
      <div>
        <span className="eyebrow eyebrow-light">{eyebrow}</span>
        <h2 id="cta-title">{title}</h2>
        <p>{body}</p>
      </div>
      <div className="cta-actions">
        {primaryAction}
        {secondaryAction}
      </div>
    </section>
  );
}
