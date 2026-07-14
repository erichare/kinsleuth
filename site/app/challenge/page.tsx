import { PageHero } from "@/components/page-hero";
import { ResearchInstinctsChallenge } from "@/components/research-instincts-challenge";
import { pageMetadata } from "@/lib/metadata";

const challengeMetadata = pageMetadata({
  title: "Research instincts challenge",
  description: "Test your genealogical skills against five fictional Hartwell–Mercer research mysteries.",
  path: "/challenge/"
});

export const metadata = {
  ...challengeMetadata,
  robots: {
    index: false,
    follow: false
  }
};

export default function ChallengePage() {
  return (
    <>
      <PageHero
        eyebrow="Research instincts"
        lead="Work five compact mysteries from the Hartwell–Mercer archive. Choose a conclusion, identify the strongest evidence, and name the caution that should keep a careful researcher honest."
        primary="Return to Kin Resolve"
        primaryHref="/"
        title="Test your genealogical skills."
      />

      <section className="shell challenge-marketing-body" aria-label="Fictional genealogy challenge">
        <div className="fiction-disclosure" role="note">
          <strong>Everything here is fictional.</strong> Every person, place, record, photograph, DNA match, and
          mystery was invented for this Kin Resolve demo.
        </div>
        <ResearchInstinctsChallenge />
      </section>
    </>
  );
}
