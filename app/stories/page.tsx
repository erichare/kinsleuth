import Image from "next/image";
import { Icons } from "@/components/icons";
import { PublicShell } from "@/components/public-shell";

const stories = [
  {
    title: "From Limerick to Chicago",
    theme: "Migration",
    meta: "Ireland · Chicago · 1880–1910",
    image: "/assets/story-limerick-chicago.webp",
    excerpt: "Following the records, neighborhoods, and Atlantic passage that shaped one family branch."
  },
  {
    title: "Cornwall clues in the Zajicek line",
    theme: "Family line",
    meta: "Cornwall · Chicago",
    image: "/assets/story-cornwall-zajicek.webp",
    excerpt: "A trail of place names and source fragments reveals how one line crossed archives and borders."
  },
  {
    title: "Reading census neighborhoods as evidence",
    theme: "Research method",
    meta: "Census · Place analysis",
    image: "/assets/story-census-neighborhoods.webp",
    excerpt: "How household clusters and nearby streets can turn a census page into a research lead."
  }
] as const;

export default function StoriesPage() {
  return (
    <PublicShell active="/stories">
      <div className="page-wrap">
        <section className="page-title section">
          <h1>Published Stories</h1>
          <p>These illustrative story cards use synthetic demo material. Real archive stories remain private until they are explicitly curated for publication.</p>
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
                <div className="story-card-meta"><span>{story.meta}</span><span className="tag">Demo</span></div>
              </div>
            </article>
          ))}
        </section>
      </div>
    </PublicShell>
  );
}
