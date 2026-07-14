import Link from "next/link";
import { site } from "@/lib/site";

export function CtaStrip({
  eyebrow = "Private beta",
  title = "Bring a real research question to Kin Resolve.",
  body = "We’re looking for family historians willing to test realistic GEDCOM, source, case, publishing, and DNA-triage workflows.",
  primaryLabel = "Apply for the private beta",
  primaryHref = "/beta",
  secondaryLabel = "View on GitHub",
  secondaryHref = site.github
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
