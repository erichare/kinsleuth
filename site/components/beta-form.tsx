import { BetaFormSubmitEvent } from "@/components/beta-form-submit-event";
import { marketingAnalyticsMode } from "@/lib/analytics";
import { betaApplicationMode } from "@/lib/beta-application-mode";
import { site } from "@/lib/site";

const applicationEndpoint = "https://app.kinresolve.com/api/public/beta-applications";
const consentVersion = "beta-communications-v1";

export function BetaForm() {
  const applicationMode = betaApplicationMode === "application";
  return (
    <form
      action={applicationMode
        ? applicationEndpoint
        : `mailto:${site.betaEmail}?subject=${encodeURIComponent("Kin Resolve private beta interest")}`}
      className="beta-form"
      encType={applicationMode ? "application/x-www-form-urlencoded" : "text/plain"}
      id="beta-interest-form"
      method="post"
    >
      {marketingAnalyticsMode === "plausible"
        ? <BetaFormSubmitEvent formId="beta-interest-form" />
        : null}
      <input name="consent_version" type="hidden" value={consentVersion} />
      <div aria-hidden="true" className="form-honeypot">
        <label htmlFor="beta-application-website">Website</label>
        <input autoComplete="off" id="beta-application-website" name="website" tabIndex={-1} />
      </div>
      <div className="form-grid">
        <label>
          <span>Name</span>
          <input autoComplete="name" maxLength={100} name="name" required />
        </label>
        <label>
          <span>Email</span>
          <input autoComplete="email" maxLength={254} name="email" required type="email" />
        </label>
        <label>
          <span>I’m a…</span>
          <select defaultValue="" name="researcher_type" required>
            <option disabled value="">Select one</option>
            <option value="family-historian">Family historian</option>
            <option value="professional-genealogist">Professional genealogist</option>
            <option value="society-member">Genealogical society member</option>
            <option value="developer-self-hoster">Developer or self-hoster</option>
            <option value="other-researcher">Other researcher</option>
          </select>
        </label>
        <label>
          <span>Current genealogy tool</span>
          <select defaultValue="" name="current_tool">
            <option value="">Prefer not to say</option>
            <option value="ancestry">Ancestry</option>
            <option value="family-tree-maker">Family Tree Maker</option>
            <option value="rootsmagic">RootsMagic</option>
            <option value="gramps">Gramps</option>
            <option value="familysearch">FamilySearch</option>
            <option value="legacy-family-tree">Legacy Family Tree</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label>
          <span>Approximate archive size</span>
          <select defaultValue="prefer-not-to-say" name="archive_size_band" required>
            <option value="prefer-not-to-say">Prefer not to say</option>
            <option value="under-1000">Under 1,000 people</option>
            <option value="1000-10000">1,000–10,000 people</option>
            <option value="10000-50000">10,000–50,000 people</option>
            <option value="over-50000">More than 50,000 people</option>
          </select>
        </label>
        <label>
          <span>Primary workflow to test</span>
          <select defaultValue="" name="workflow" required>
            <option disabled value="">Select one</option>
            <option value="gedcom-review">GEDCOM review and change control</option>
            <option value="source-research">Source and transcript research</option>
            <option value="research-cases">Research cases and hypotheses</option>
            <option value="deterministic-quality">Deterministic quality and privacy checks</option>
            <option value="developer-api">Developer API and portability</option>
          </select>
        </label>
      </div>
      <label className="consent-label">
        <input name="consent" required type="checkbox" value="accepted" />
        <span>
          {applicationMode
            ? "I agree to receive Kin Resolve beta communications and understand that the product service stores these application fields for up to 90 days."
            : "I agree to receive Kin Resolve beta communications and understand that submitting opens my email application; my email providers and the Kin Resolve beta mailbox handle the message."}
        </span>
      </label>
      <div className="form-warning">
        <strong>Keep family data out of this application.</strong>
        <span>Beyond your own contact name, do not include relatives’ names or details, record images, GEDCOM files, DNA files, genetic information, credentials, or API tokens.</span>
      </div>
      <div className="form-actions">
        <button className="button" type="submit">
          {applicationMode ? "Submit application" : "Open email application"}
        </button>
      </div>
      <p className="form-note">
        {applicationMode
          ? "This no-JavaScript form sends only the fixed fields above to the Kin Resolve product endpoint. A receipt is sent to your email."
          : `Submitting opens your email application with the form addressed to ${site.betaEmail}. The marketing site does not store it; sending still depends on your email provider.`}
      </p>
    </form>
  );
}
