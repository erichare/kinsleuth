import Link from "next/link";
import { Icons } from "@/components/icons";
import { PublicShell } from "@/components/public-shell";

const steps = [
  {
    title: "Start Postgres and the app",
    detail: "Copy .env.example to .env, run `docker compose up -d postgres`, then `npm run dev`. The first read seeds a synthetic demo archive.",
    action: null
  },
  {
    title: "Protect the private workspace",
    detail: "Set KINSLEUTH_APP_PASSWORD plus a long AUTH_SECRET in .env to require a password for /app pages and private APIs.",
    action: null
  },
  {
    title: "Name your archive",
    detail: "Set the archive name and tagline that appear across the workspace and the public site.",
    action: { href: "/app/settings", label: "Open Settings" }
  },
  {
    title: "Import your GEDCOM",
    detail: "Preview the diff first — new, changed, and removed records are shown before anything is applied, and a pre-import snapshot is kept.",
    action: { href: "/app/imports", label: "Open Imports" }
  },
  {
    title: "Connect an AI provider (optional)",
    detail: "Set AI_BASE_URL and AI_API_KEY for provider-backed analysis. Deterministic structural checks run without any key.",
    action: { href: "/app/ai", label: "Open AI Analyst" }
  },
  {
    title: "Review before publishing",
    detail: "Everything imports as private. Use Publishing and Reports to find blockers before making any profile public.",
    action: { href: "/app/publishing", label: "Open Publishing" }
  }
];

export default function SetupPage() {
  return (
    <PublicShell>
      <div className="page-wrap">
        <section className="page-title section">
          <h1>First-run setup</h1>
          <p>KinSleuth is configured through environment variables and the private workspace — this checklist walks through a fresh installation.</p>
        </section>
        <section className="section">
          <div className="evidence-list">
            {steps.map((step, index) => (
              <div className="panel" key={step.title} style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center" }}>
                <div>
                  <strong>
                    {index + 1}. {step.title}
                  </strong>
                  <p className="muted" style={{ margin: "6px 0 0" }}>
                    {step.detail}
                  </p>
                </div>
                {step.action ? (
                  <Link className="button-secondary" href={step.action.href} style={{ flexShrink: 0 }}>
                    {step.action.label}
                    <Icons.ChevronRight size={16} aria-hidden />
                  </Link>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      </div>
    </PublicShell>
  );
}
