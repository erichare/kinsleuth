import Link from "next/link";
import { CtaStrip } from "@/components/cta-strip";
import { PageHero } from "@/components/page-hero";
import { betaApplicationMode } from "@/lib/beta-application-mode";
import { betaStatus } from "@/lib/beta-status";
import { pageMetadata } from "@/lib/metadata";
import { site } from "@/lib/site";

export const metadata = pageMetadata({
  title: "Privacy and data practices",
  description: "Kin Resolve’s current privacy controls, planned private-beta data lifecycle, provider boundaries, deletion process, and launch limitations.",
  path: "/privacy/"
});

const currentControls = [
  ["Archive-scoped access", `Private research routes require an authenticated archive membership. Cohort one ${betaStatus.hostedLive ? "operates" : "is designed"} as one isolated deployment, database, object store, secret set, and archive—not shared multi-family tenancy.`],
  ["Server-enforced limits", "Hosted DNA, external AI, binary evidence uploads, media packages, public archive access, and real-data publishing are disabled at server boundaries for cohort one."],
  ["Reviewable import and export", "Plain GEDCOM changes are previewed before apply, a recovery snapshot is created, and an owner can export the full archive back to GEDCOM."],
  ["Bounded observability", "Operational events use fixed names and allowlisted metadata. Record content, names, queries, credentials, response bodies, session replay, and browser recording are excluded."],
  ["Controlled invitations", "Hosted accounts use single-use, expiring invitations bound to an exact archive, email, role, and approved legal-document manifest. Open signup remains disabled."],
  ["Data-operation records", "An owner can request a structured research export or record a deletion request. A deletion request is not a completed deletion; final real-pilot deletion remains an operator-reviewed whole-cell teardown."],
  ["Scoped API preview", betaStatus.apiLive
    ? "API v1 is available only to approved private-beta participants for archives they own, through owner-created, expiring, revocable read-only tokens."
    : betaStatus.hostedLive
      ? "The source includes owner-created, expiring, revocable read-only API tokens. The hosted API is not available in this release."
      : "The source includes owner-created, expiring, revocable read-only API tokens. The hosted API remains unavailable until its release, edge-limit, canary, and revocation gates pass."],
  ["Synthetic public material", "The public repository, challenge, examples, and launch media use fictional Hartwell–Mercer records. Real genealogy and DNA files do not belong in source control or the beta application."]
] as const;

const lifecycle = [
  {
    title: "Beta application",
    body: betaApplicationMode === "application"
      ? "The static marketing form posts fixed contact, researcher-type, workflow, archive-size, optional tool, and exact consent fields to the product endpoint. The product stores no IP address, user agent, free text, or family data. Every application record is deleted 90 days after submission; activation still depends on approval and operational proof."
      : "The fallback form opens the applicant’s email client. The marketing site does not receive or store the form. The applicant’s mail provider, Kin Resolve mail routing, and the receiving mailbox handle the sent message."
  },
  {
    title: "Invitation and account",
    body: betaStatus.hostedLive
      ? "Invitations, verification, and recovery capabilities are hashed, single-use, and short-lived. Account and acceptance evidence remain for the pilot lifecycle under the exact approved terms presented to each participant."
      : "Invitations, verification, and recovery capabilities are hashed, single-use, and short-lived. Account and acceptance evidence remain for the pilot lifecycle under the exact approved terms; no duration is promised before those terms are approved."
  },
  {
    title: "Archive and imports",
    body: `A real pilot ${betaStatus.hostedLive ? "uses" : "is designed for"} one dedicated data cell. Direct GEDCOM staging older than 24 hours has bounded cleanup, while archive records and retained import artifacts follow the participant’s approved pilot and deletion terms.`
  },
  {
    title: "Operational and audit data",
    body: "Operational logs have a proposed 14-day target and non-content security/audit evidence a proposed 90-day target. These are planning values—not live promises—until provider configuration, owner approval, and counsel review are recorded."
  },
  {
    title: "Backups after deletion",
    body: "Primary deletion and retained-backup expiry are separate. The planning target is primary teardown within seven days after verification and optional export, with retained backups expiring no later than 30 days afterward. Neither target is promised until rehearsal and approval prove it."
  },
  {
    title: "Security evidence",
    body: `API token metadata, security events, legal acceptance, and deletion evidence are protected non-content records. The approved notice ${betaStatus.hostedLive ? "states" : "must state"} what survives a row reset, what is destroyed with the dedicated cell, and whether any minimal legal receipt remains outside it.`
  }
] as const;

const plannedServices = [
  ["Marketing application", betaApplicationMode === "application" ? "Vercel product runtime, Supabase Postgres, and Resend" : "Applicant email provider, Cloudflare mail routing, and the Kin Resolve beta mailbox", betaApplicationMode === "application" ? "Fixed contact, workflow-category, consent, and delivery metadata only; no free text, files, network address, or family details" : "Contact and fixed workflow fields only; no files or family details"],
  ["Hosted product", "Vercel runtime and private object storage", "Application requests and private GEDCOM artifacts under the approved product configuration"],
  ["Primary data and provider backup", "Supabase Postgres", "Account, archive, research, operational, and encrypted provider-backup data"],
  ["Transactional email", "Resend", "Invitation, verification, recovery, and service messages with no family-record content"],
  ["Off-provider recovery", "A protected encrypted backup destination selected before real data", "Encrypted database and both object namespaces; exact provider and expiry must be disclosed"],
  ["Operational alerts", "A provider selected under the allowlisted event contract", "Fixed event metadata only; no request or response bodies, record content, or replay"]
] as const;

export default function PrivacyPage() {
  return (
    <>
      <PageHero
        eyebrow="Privacy and data practices"
        lead="Genealogy data is relational: one person’s upload can describe many relatives who never agreed to be part of a service. Kin Resolve treats privacy as an access, retention, and publication decision—not a footer promise."
        note={betaStatus.hostedLive
          ? "Hosted private-beta disclosure updated July 15, 2026. This product-practices page is not the legal privacy notice; each invitation presents the exact approved notice and terms."
          : "Prelaunch disclosure updated July 15, 2026. This page describes product practice and planning; it is not an approved legal privacy notice."
        }
        primary="View current controls"
        primaryHref="#current-controls"
        title="Private by default. Published by decision. Deleted by a verified process."
      />

      <section className="shell section privacy-principle">
        <span className="privacy-seal" aria-hidden="true">P</span>
        <div>
          <span className="eyebrow">Product principle</span>
          <h2>The private archive and public story are different surfaces.</h2>
          <p className="prose-large">Imported records, research notes, cases, API responses, and unfinished hypotheses need a private place to develop. Public family history should contain only what an owner has reviewed and intentionally shared. Real-data public publishing is disabled for the first hosted cohort.</p>
        </div>
      </section>

      <section className="section surface-section" id="current-controls">
        <div className="shell">
          <div className="section-heading">
            <span className="eyebrow">Implemented in source</span>
            <h2>Controls the code enforces today.</h2>
            <p>{betaStatus.hostedLive ? "These controls are deployed for the hosted cohort under its approved boundary. Product implementation outside that boundary is not a promise of participant access." : "Implemented does not mean deployed or approved for private family data. Live provider configuration and launch evidence remain separate gates."}</p>
          </div>
          <div className="privacy-grid">
            {currentControls.map(([title, body], index) => <article key={title}><span>{String(index + 1).padStart(2, "0")}</span><h3>{title}</h3><p>{body}</p></article>)}
          </div>
        </div>
      </section>

      <section className="shell section ai-disclosure">
        <div className="disclosure-mark" aria-hidden="true">AI</div>
        <div>
          <span className="eyebrow">Cohort-one provider boundary</span>
          <h2>External-provider AI is disabled for the hosted cohort.</h2>
          <p>Deterministic structural and privacy checks do not need an AI provider. Although self-hosted operators can configure an OpenAI-compatible provider, {betaStatus.hostedLive ? "the hosted cohort" : "the proposed hosted cohort"} rejects external-provider analysis at the server boundary.</p>
          <p>If that boundary changes in a later cohort, the privacy notice must identify the provider, data sent, purpose, retention, training posture, region, and participant choice before private context leaves the deployment.</p>
        </div>
      </section>

      <section className="section limitation-section">
        <div className="shell limitation-grid">
          <div><span className="eyebrow eyebrow-light">What is not promised</span><h2>A private beta is not a compliance badge or availability guarantee.</h2></div>
          <div><p>Kin Resolve does not claim GDPR, CCPA, HIPAA, or genetic-privacy compliance; multi-tenant readiness; production-grade hosted DNA handling; guaranteed backups; zero data loss; instant deletion; or an uptime SLA.</p><p>DNA, external AI, binary media, open signup, billing, shared multi-family hosting, and real-data public publishing are excluded from cohort one.</p></div>
        </div>
      </section>

      <section className="shell section privacy-roadmap">
        <div className="section-heading">
          <span className="eyebrow">{betaStatus.hostedLive ? "Hosted data lifecycle" : "Planned data lifecycle"}</span>
          <h2>Specific enough to review; not presented as an approved promise.</h2>
          <p>{betaStatus.hostedLive ? "The durations below remain operating targets, not an SLA. The exact versioned privacy notice and participation terms presented and accepted during invitation control." : "The durations below are proposed operating targets. The versioned privacy notice and participation terms control only after owner and counsel approval, publication, byte verification, and explicit participant acceptance."}</p>
        </div>
        <ol>{lifecycle.map((item) => <li key={item.title}><strong>{item.title}</strong><span>{item.body}</span></li>)}</ol>
      </section>

      <section className="section surface-section">
        <div className="shell">
          <div className="section-heading">
            <span className="eyebrow">{betaStatus.hostedLive ? "Hosted service map" : "Planned service map"}</span>
            <h2>Where beta data {betaStatus.hostedLive ? "goes" : "would go"}.</h2>
            <p>{betaStatus.hostedLive ? "The approved privacy notice names the providers configured for the hosted cohort and governs their disclosed region, purpose, and retention boundaries." : "The final approved privacy notice must name the providers actually configured at launch. A planned provider is not proof that a live processor relationship, region, retention rule, or contract has been approved."}</p>
          </div>
          <div className="privacy-grid">
            {plannedServices.map(([surface, provider, boundary], index) => (
              <article key={surface}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <h3>{surface}</h3>
                <p><strong>{provider}</strong><br />{boundary}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="shell section privacy-roadmap">
        <div className="section-heading">
          <span className="eyebrow">Export and deletion</span>
          <h2>A request, loss of access, and completed deletion are three different events.</h2>
        </div>
        <ol>
          <li><strong>Request</strong><span>An authenticated owner records a deletion request. Support verifies the owner and offers fresh GEDCOM and structured research exports without asking for passwords, tokens, or records by email.</span></li>
          <li><strong>Contain</strong><span>Invitations and new work pause; sessions, scheduled writers, database identity, both object namespaces, backup evidence, and the exact target cell are independently verified.</span></li>
          <li><strong>Destroy the dedicated cell</strong><span>The authoritative real-pilot finish is operator-reviewed destruction of the dedicated database and object resources—not merely hiding the app or deleting a few rows.</span></li>
          <li><strong>Track retained backup expiry</strong><span>Provider and encrypted off-provider backups expire under the approved schedule. Kin Resolve must not claim they disappear immediately or mark deletion complete without evidence.</span></li>
        </ol>
      </section>

      <section className="shell section practice-note">
        <strong>{betaStatus.hostedLive ? "Support and security routes are active for the hosted cohort." : "Support and security routes must be safe before invitations begin."}</strong>
        <p>Participant help, export, and deletion requests {betaStatus.hostedLive ? "use" : "will use"} <a href="mailto:support@kinresolve.com">support@kinresolve.com</a>. Private vulnerability reports {betaStatus.hostedLive ? "use" : "will use"} <a href="mailto:security@kinresolve.com">security@kinresolve.com</a>. The {betaStatus.hostedLive ? "support" : "proposed support"} acknowledgement target is one business day, not an SLA.</p>
        <p>Never email family records, GEDCOM files, private screenshots, passwords, cookies, API tokens, source images, or genetic information. Arrange a separately approved private transfer only when evidence bytes are necessary.</p>
      </section>

      <section className="shell section practice-note">
        <strong>This is a product-practices page—not the private-beta legal privacy notice.</strong>
        <p>{betaStatus.hostedLive ? "The approved participation terms, privacy notice, and cohort boundary are published as exact versioned documents and presented with each invitation for explicit acceptance. Only those accepted documents govern hosted participation." : "The approved participation terms, privacy notice, and cohort boundary have not been published. No invitation should be accepted and no real family data should be uploaded until their exact versioned bytes are approved, published, verified, and presented for explicit acceptance."}</p>
        <p>A beta application consents only to beta communications; it does not accept hosted participation terms.</p>
        <Link className="arrow-link" href="/beta">Read the application and cohort boundaries <span aria-hidden="true">→</span></Link>
      </section>

      <div className="shell section">
        <CtaStrip
          body="Apply with the fixed contact and workflow fields only. Keep GEDCOM files, DNA data, source images, credentials, and private family details out of the application and email."
          eyebrow="Privacy-minded beta"
          primaryHref="/beta"
          primaryLabel="Apply for the private beta"
          secondaryHref={site.github}
          secondaryLabel="View on GitHub"
          title="Help test the boundary between private research and public history."
        />
      </div>
    </>
  );
}
