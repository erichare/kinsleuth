import Link from "next/link";
import Image from "next/image";
import { Icons } from "@/components/icons";
import { PublicShell } from "@/components/public-shell";

const features = [
  {
    title: "Import without losing provenance",
    body: "Preserve raw GEDCOM records, custom tags, Ancestry IDs, source URLs, notes, and media references.",
    icon: Icons.Upload,
    label: "Archive integrity"
  },
  {
    title: "Turn matches into hypotheses",
    body: "Rank useful DNA matches and explain likely branch, generation, geography, evidence, and uncertainty.",
    icon: Icons.Dna,
    label: "Research intelligence"
  },
  {
    title: "Publish only what you approve",
    body: "Keep living people, private cases, DNA data, and sensitive facts hidden until curated for public viewing.",
    icon: Icons.Shield,
    label: "Privacy controls"
  }
] as const;

export default function KinSleuthProductPage() {
  return (
    <PublicShell active="/kinsleuth">
      <div className="page-wrap">
        <section className="product-hero section">
          <div className="product-hero-layout">
            <div>
              <span className="eyebrow">Private research workspace</span>
              <h1>KinSleuth</h1>
              <p>Self-hosted software for genealogists who need more than a tree viewer: private investigations, GEDCOM provenance, DNA match triage, and AI-assisted evidence analysis.</p>
              <div className="hero-actions">
                <Link className="button" href="/app">
                  <Icons.FileSearch size={17} aria-hidden />
                  Open demo workspace
                </Link>
                <Link className="button-secondary" href="https://github.com/erichare/kinsleuth">
                  MIT open source
                </Link>
              </div>
            </div>
            <Link className="product-preview" href="/app">
              <Image
                src="/assets/kinsleuth-dashboard-preview.webp"
                alt="KinSleuth private workspace showing investigation metrics, cases, and an action queue"
                width={1440}
                height={900}
                sizes="(max-width: 960px) calc(100vw - 40px), 620px"
              />
              <span className="product-preview-caption"><Icons.Lock size={15} aria-hidden />Illustrative demo workspace</span>
            </Link>
          </div>
        </section>

        <section className="section product-feature-grid">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <article className="panel product-feature-card surface-quiet" key={feature.title}>
                <span className="product-feature-icon"><Icon size={20} aria-hidden /></span>
                <span className="card-kicker">{feature.label}</span>
                <h2>{feature.title}</h2>
                <p>{feature.body}</p>
              </article>
            );
          })}
        </section>

        <section className="section grid-2">
          <div className="panel surface-featured">
            <h2>Self-hosted runtime</h2>
            <p>Docker Compose starts the app, Postgres with pgvector, object storage, and a worker. Each deployment represents one family archive.</p>
            <pre className="code-block">docker compose up --build</pre>
          </div>
          <div className="panel surface-quiet">
            <h2>AI on your terms</h2>
            <p>OpenAI-compatible provider settings let an owner/admin connect hosted or local-compatible models. Whole-tree analysis is role-gated and audited.</p>
          </div>
        </section>
      </div>
    </PublicShell>
  );
}
