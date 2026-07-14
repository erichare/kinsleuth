import type { Metadata } from "next";
import Link from "next/link";

import { ResearchInstinctsChallenge } from "@/components/research-instincts-challenge";
import { PublicShell } from "@/components/public-shell";

export const metadata: Metadata = {
  title: "Research Instincts Challenge | Kin Resolve",
  description: "Test your genealogical skills against five fictional Hartwell–Mercer research mysteries.",
  robots: {
    index: false,
    follow: false
  }
};

export default function ChallengePage() {
  return (
    <PublicShell>
      <div className="page-wrap challenge-page">
        <section className="page-title challenge-intro">
          <span className="eyebrow">Research instincts</span>
          <h1>Test your genealogical skills</h1>
          <p>
            Work five compact mysteries from the Hartwell–Mercer archive. Choose a conclusion, identify exactly two
            supporting clues, and name the caution that should keep a careful researcher honest.
          </p>
          <p className="fiction-disclosure" role="note">
            <strong>Everything here is fictional.</strong> Every person, place, record, photograph, DNA match, and
            mystery was invented for this Kin Resolve demo.
          </p>
          <Link className="challenge-back-link" href="/">
            ← Return to the public archive
          </Link>
        </section>

        <ResearchInstinctsChallenge />
      </div>
    </PublicShell>
  );
}
