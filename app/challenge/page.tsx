import type { Metadata } from "next";
import Link from "next/link";

import { ResearchInstinctsChallenge } from "@/components/research-instincts-challenge";
import { PublicShell } from "@/components/public-shell";
import { publicArchiveEnabled } from "@/lib/public-surface";

export const metadata: Metadata = {
  title: "Immersive Research Challenge | Kin Resolve",
  description:
    "Work five immersive Hartwell–Mercer investigations across thirty synthetic records, from handwritten ledgers to DNA research worksheets.",
  robots: {
    index: false,
    follow: false
  }
};

export default function ChallengePage() {
  const archiveAvailable = publicArchiveEnabled();

  return (
    <PublicShell>
      <div className="page-wrap challenge-page">
        <section className="page-title challenge-intro">
          <span className="eyebrow">Research instincts</span>
          <h1>Test your genealogical skills—inside the records.</h1>
          <p>
            Work five immersive cases across thirty synthetic records: handwritten household schedules and letters,
            travel papers, object-provenance notes, photographs, name indexes, and DNA research worksheets. Every
            mystery rewards correlation, chronology, and careful limits—not a lucky guess.
          </p>
          <p className="fiction-disclosure" role="note">
            <strong>Everything here is fictional. Every record is synthetic.</strong> Every person, place, record
            image, transcript, photograph, DNA match, and mystery in the Hartwell–Mercer archive was invented for
            this Kin Resolve demo. No real people or records appear here.
          </p>
          <Link className="challenge-back-link" href={archiveAvailable ? "/" : "/login"}>
            {archiveAvailable ? "← Return to the public archive" : "← Sign in to Kin Resolve"}
          </Link>
        </section>

        <ResearchInstinctsChallenge />
      </div>
    </PublicShell>
  );
}
