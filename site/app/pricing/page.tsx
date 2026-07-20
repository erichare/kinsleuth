import Link from "next/link";
import { CtaStrip } from "@/components/cta-strip";
import { PageHero } from "@/components/page-hero";
import { betaStatus } from "@/lib/beta-status";
import { demoLive } from "@/lib/demo-status";
import { pageMetadata } from "@/lib/metadata";
import { site } from "@/lib/site";

export const metadata = pageMetadata({
  title: "Pricing",
  description:
    "Kin Resolve pricing intent: a free synthetic public demo, a free invitation-only hosted beta, and free-forever AGPL-3.0-only self-hosting. Numbers come later, with notice.",
  path: "/pricing/"
});

interface PricingTier {
  readonly name: string;
  readonly price: string;
  readonly tone: "available" | "developing";
  readonly lead: string;
  readonly points: readonly string[];
  readonly action: { readonly label: string; readonly href: string };
  readonly demoSurfaceStatus?: "live" | "pending";
}

const demoTier: PricingTier = demoLive
  ? {
      name: "Public demo",
      price: "Free",
      tone: "available",
      lead: "A disposable synthetic workspace for judging the product before trusting it with anything.",
      points: [
        "No signup and no account",
        "Fictional Hartwell–Mercer records only",
        "A disposable workspace that expires after 24 hours",
        "Nothing you try is kept or attributed to you"
      ],
      action: { label: "Try the demo", href: site.demoUrl },
      demoSurfaceStatus: "live"
    }
  : {
      name: "Public demo",
      price: "Free",
      tone: "developing",
      lead: "A disposable synthetic workspace for judging the product before trusting it with anything. It is staged behind its own launch checks and is not open yet.",
      points: [
        "No signup and no account",
        "Fictional Hartwell–Mercer records only",
        "A disposable workspace that expires after 24 hours",
        "Nothing you try is kept or attributed to you"
      ],
      action: { label: "Follow the demo launch", href: "/roadmap" },
      demoSurfaceStatus: "pending"
    };

const hostedTier: PricingTier = betaStatus.hostedLive
  ? {
      name: "Hosted beta",
      price: "Free during the beta",
      tone: "available",
      lead: "Invitation-only, deliberately small, and free for the whole pilot—there is no billing or payment-information step.",
      points: [
        "Invitation-only for approved participants",
        "One isolated cell per participant, not shared tenancy",
        "Founder-operated onboarding, export, deletion, and support",
        "No payment method is ever requested during the beta"
      ],
      action: { label: "Apply for the private beta", href: "/beta" }
    }
  : {
      name: "Hosted beta",
      price: "Proposed: free during the beta",
      tone: "developing",
      lead: "Invitation-only and deliberately small. The proposed pilot is intended to be free for its whole run, with no billing or payment-information step—and invitations have not started.",
      points: [
        "Invitation-only for approved participants once invitations begin",
        "One isolated cell per participant, not shared tenancy",
        "Founder-operated onboarding, export, deletion, and support",
        "No payment method is requested at any point in the proposed beta"
      ],
      action: { label: "Apply for the private beta", href: "/beta" }
    };

const selfHostedTier: PricingTier = {
  name: "Self-hosted",
  price: "Free forever",
  tone: "available",
  lead: "The complete source under AGPL-3.0-only, on your hardware, with full GEDCOM export so nothing locks you in.",
  points: [
    "Every capability in the source product",
    "AGPL-3.0-only license, inspectable end to end",
    "Runs from Docker Compose with Postgres",
    "Full GEDCOM 5.5.1 export keeps the archive portable"
  ],
  action: { label: "Read about the open source", href: "/open-source" }
};

const tiers: readonly PricingTier[] = [demoTier, hostedTier, selfHostedTier];

const demoAvailabilityClause = demoLive
  ? "the synthetic public demo is open now and free"
  : "the synthetic public demo will be free once its launch checks pass";
const hostedAvailabilityClause = betaStatus.hostedLive
  ? "the invitation-only hosted beta is free for approved participants"
  : "the proposed invitation-only hosted beta is intended to be free once invitations begin";
const heroLead = `Nothing about Kin Resolve costs money right now: ${demoAvailabilityClause}, ${hostedAvailabilityClause}, and self-hosting the AGPL source is free forever. There are no price tiers to compare yet—only the intent below.`;

const billingIntentFraming = betaStatus.hostedLive
  ? "Two stated intentions—not yet signed billing commitments—hold in the meantime:"
  : "The billing decision for the proposed pilot is itself still pending sign-off, so read these as stated intent rather than commitments:";

const applyClause = betaStatus.hostedLive
  ? "apply to test your real research workflow in the invitation-only pilot"
  : "apply to test your real research workflow when invitations begin";

export default function PricingPage() {
  return (
    <>
      <PageHero
        eyebrow="Pricing"
        lead={heroLead}
        primary="Apply for the private beta"
        primaryHref="/beta"
        showGithub
        title="No prices yet. Here is the honest version."
      />

      <section className="section surface-section">
        <div className="shell status-table-wrap">
          <div className="section-heading">
            <span className="eyebrow">Three ways in</span>
            <h2>What each path costs, and what it does not.</h2>
            <p>{betaStatus.summary}</p>
          </div>
          <div className="status-table">
            {tiers.map((tier) => (
              <div className="status-column" data-pricing-demo-status={tier.demoSurfaceStatus} key={tier.name}>
                <span className="status-heading"><i aria-hidden="true" className={`status-dot ${tier.tone}`} /> {tier.name}</span>
                <h3>{tier.price}</h3>
                <p>{tier.lead}</p>
                <ul>{tier.points.map((point) => <li key={point}>{point}</li>)}</ul>
                {tier.action.href.startsWith("http")
                  ? <a className="arrow-link" href={tier.action.href}>{tier.action.label} <span aria-hidden="true">↗</span></a>
                  : <Link className="arrow-link" href={tier.action.href}>{tier.action.label}</Link>}
              </div>
            ))}
          </div>
          <p className="status-footnote">
            The demo uses only fictional records, and the self-hosted source is available now on <a href={site.github}>GitHub</a>. Read the <Link href="/beta">beta boundary</Link> and the <Link href="/privacy">data practices</Link> before applying.
          </p>
        </div>
      </section>

      <section className="shell section public-roadmap">
        <div><span className="eyebrow">Why no prices yet</span><h2>Because a number here would be a guess.</h2></div>
        <div>
          <p>Hosted pricing depends on things the beta exists to measure: real support load, storage and infrastructure cost per archive, and which capabilities researchers actually lean on. Publishing tiers before that evidence exists would mean either quietly repricing later or defending a wrong number—both worse than saying &ldquo;not yet.&rdquo;</p>
          <p>{billingIntentFraming} the intent is to announce hosted plans before anything costs money, and to give beta participants clear notice first. Self-hosting stays free under the AGPL regardless of what hosted plans become, and full GEDCOM export means a price change can never hold an archive hostage.</p>
          <p>When numbers exist, they will appear here and in the repository—the same place the <Link href="/roadmap">roadmap</Link> lives.</p>
        </div>
      </section>

      <div className="shell section">
        {demoLive ? (
          <CtaStrip
            body={`Start in a disposable fictional workspace, or ${applyClause}. Neither costs anything.`}
            eyebrow="Free either way"
            primaryHref={site.demoUrl}
            primaryLabel="Try the demo"
            secondaryHref="/beta"
            secondaryLabel="Apply for the private beta"
            title="Judge the product before anyone asks about money."
          />
        ) : (
          <CtaStrip
            body={`Read the source while the demo finishes its launch checks, or ${applyClause}. Neither costs anything.`}
            eyebrow="Free either way"
            primaryHref="/beta"
            primaryLabel="Apply for the private beta"
            secondaryHref={site.github}
            secondaryLabel="View on GitHub"
            title="Judge the product before anyone asks about money."
          />
        )}
      </div>
    </>
  );
}
