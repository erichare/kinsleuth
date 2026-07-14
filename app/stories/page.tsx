import Image from "next/image";
import Link from "next/link";
import { Icons } from "@/components/icons";
import { PublicShell } from "@/components/public-shell";

const stories = [
  {
    title: "Nora Hartwell and the blue tin",
    theme: "Family lore",
    meta: "Lantern Bay, WI · provenance disputed",
    image: "/assets/hartwell-mercer-blue-tin.webp",
    excerpt: "Nora calls it “Amalia’s tin” in her 1922 journal, while an older family story credits Samuel. An item-by-item timeline may reveal who actually assembled it."
  },
  {
    title: "The two girls called Malia Bellandi",
    theme: "Record puzzle",
    meta: "Ceraluna Alta, Italy · 1868",
    image: "/assets/archival-contours.webp",
    excerpt: "Two index entries share the same name. Reconstructing each sibling set can distinguish them—but which seven-year-old Malia belongs in this branch?"
  },
  {
    title: "Three figures and the cropped “AR”",
    theme: "Identity mystery",
    meta: "Undated harbor photograph · place disputed",
    image: "/assets/archival-contours.webp",
    excerpt: "Three unnamed figures stand beneath a cropped “AR.” Is it a place name or part of an awning, and was the violet note written when the photograph was taken—or years later?"
  }
] as const;

export default function StoriesPage() {
  return (
    <PublicShell active="/stories">
      <div className="page-wrap">
        <section className="page-title section">
          <h1>Fictional Demo Stories</h1>
          <p>Meet the Hartwell–Mercer family, a wholly invented archive with its own lore, contradictions, and unsolved questions.</p>
          <p className="fiction-disclosure" role="note"><strong>Everything in this demo is fictional.</strong> Every name, date, place, record, photograph, story, and DNA match was created for Kin Resolve. No real family data appears here.</p>
        </section>
        <section className="story-grid">
          {stories.map((story) => (
            <article className="story-card" key={story.title}>
              <div className="story-card-media">
                <Image src={story.image} alt="" fill sizes="(max-width: 960px) calc(100vw - 40px), 380px" />
              </div>
              <div className="story-card-body">
                <span className="card-kicker"><Icons.BookOpen size={15} aria-hidden />{story.theme}</span>
                <h2>{story.title}</h2>
                <p>{story.excerpt}</p>
                <div className="story-card-meta"><span>{story.meta}</span><span className="tag">Fictional demo</span></div>
              </div>
            </article>
          ))}
        </section>
        <section className="challenge-story-cta" aria-labelledby="challenge-story-title">
          <div>
            <span className="card-kicker">Ready to investigate?</span>
            <h2 id="challenge-story-title">Test your genealogical skills</h2>
            <p>Put the Hartwell–Mercer clues together across five fictional mini-cases and earn a score out of 500.</p>
          </div>
          <Link className="button" href="/challenge">
            Start the challenge
          </Link>
        </section>
      </div>
    </PublicShell>
  );
}
