import Link from "next/link";
import { LoginForm } from "@/components/login-form";
import { PublicShell } from "@/components/public-shell";
import { isHostedDeployment } from "@/lib/hosted-config";
import { safeInternalPath } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const params = await searchParams;
  const nextPath = safeInternalPath(params.next);
  const hosted = isHostedDeployment();

  return (
    <PublicShell>
      <div className="page-wrap">
        <section className="section" style={{ maxWidth: 520, margin: "40px auto" }}>
          <div className="panel">
            <h1 style={{ marginTop: 0 }}>{hosted ? "Private beta workspace" : "Private workspace"}</h1>
            <p className="muted">
              {hosted
                ? "Sign in to continue to your private beta workspace."
                : "Sign in to open private research tools, DNA matches, source uploads, and investigations."}
            </p>
            <LoginForm nextPath={nextPath} />
            {!hosted ? (
              <div className="hero-actions">
                <Link className="button-secondary" href="/setup">
                  First-run setup
                </Link>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </PublicShell>
  );
}
