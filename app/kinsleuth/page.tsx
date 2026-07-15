import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { Icons } from "@/components/icons";
import { PublicShell } from "@/components/public-shell";
import { privateWorkspaceLoginPath, publicArchiveEnabled } from "@/lib/public-surface";

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
    title: "Publish profiles deliberately",
    body: "Profiles must be explicitly published and pass deceased/public privacy gates. Granular fact, source, and story curation is still in progress.",
    icon: Icons.Shield,
    label: "Privacy controls"
  }
] as const;

export default function KinResolveProductPage() {
  if (!publicArchiveEnabled()) {
    redirect(privateWorkspaceLoginPath);
  }
  return (
    <PublicShell active="/kinsleuth">
      <div className="page-wrap">
        <section className="product-hero section">
          <div className="product-hero-layout">
            <div>
              <span className="eyebrow">Private research workspace</span>
              <h1>Kin Resolve</h1>
              <p>Self-hosted software for genealogists who need more than a tree viewer: private investigations, GEDCOM provenance, DNA match triage, and AI-assisted evidence analysis.</p>
              <div className="hero-actions">
                <Link className="button" href="/login">
                  <Icons.Lock size={17} aria-hidden />
                  Sign in to workspace
                </Link>
                <Link className="button-secondary" href="https://github.com/erichare/kinresolve">
                  AGPL-3.0 open source
                </Link>
              </div>
            </div>
            <div className="product-preview">
              <Image
                src="/assets/kinresolve-dashboard-preview.webp"
                alt="Fictional Hartwell–Mercer Kin Resolve workspace showing investigation metrics, cases, and an action queue"
                width={1440}
                height={900}
                sizes="(max-width: 960px) calc(100vw - 40px), 620px"
              />
              <span className="product-preview-caption"><Icons.Lock size={15} aria-hidden />Fictional Hartwell–Mercer preview</span>
            </div>
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
            <p>Development Compose starts the app and Postgres and provisions MinIO. Source uploads still use local disk, and the worker remains a scaffold.</p>
            <pre className="code-block">docker compose up --build</pre>
          </div>
          <div className="panel surface-quiet">
            <h2>AI on your terms</h2>
            <p>OpenAI-compatible provider settings let an owner/admin connect hosted or local-compatible models. Whole-tree analysis is owner/admin gated, saved in run history, and stages suggestions for review.</p>
          </div>
        </section>
      </div>
    </PublicShell>
  );
}
