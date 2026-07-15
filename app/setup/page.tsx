import Link from "next/link";
import { redirect } from "next/navigation";
import { Icons } from "@/components/icons";
import { PublicShell } from "@/components/public-shell";
import { SetupForm } from "@/components/setup-form";
import { countUsers } from "@/lib/auth-session";
import { isHostedDeployment } from "@/lib/hosted-config";

export const dynamic = "force-dynamic";

const steps = [
  {
    title: "Start Postgres and the app",
    detail: "Copy .env.example to .env, run `docker compose up -d postgres`, then `npm run archive:provision -- --mode demo` before `npm run dev`.",
    action: null
  },
  {
    title: "Protect the private workspace",
    detail: "Set a long AUTH_SECRET in .env, then create the owner account above. Private pages and APIs require a signed-in account from then on.",
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

export default async function SetupPage() {
  if (isHostedDeployment()) {
    redirect("/login");
  }

  const existingUsers = await countUsers().catch(() => null);

  return (
    <PublicShell>
      <div className="page-wrap">
        <section className="page-title section">
          <h1>First-run setup</h1>
          <p>Kin Resolve is configured through environment variables and the private workspace — this checklist walks through a fresh installation.</p>
        </section>
        {existingUsers === 0 ? (
          <section className="section" style={{ maxWidth: 520 }}>
            <div className="panel">
              <h2 style={{ marginTop: 0 }}>Create the owner account</h2>
              <p className="muted">
                The first account owns this archive. Open sign-up closes once it exists; additional members will arrive by invitation.
              </p>
              <SetupForm />
            </div>
          </section>
        ) : existingUsers !== null ? (
          <section className="section" style={{ maxWidth: 520 }}>
            <div className="panel">
              <h2 style={{ marginTop: 0 }}>Owner account exists</h2>
              <p className="muted">This workspace is already set up.</p>
              <Link className="button-secondary" href="/login">
                Sign in
              </Link>
            </div>
          </section>
        ) : null}
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
