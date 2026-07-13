import Link from "next/link";
import { LoginForm } from "@/components/login-form";
import { PublicShell } from "@/components/public-shell";
import { safeInternalPath } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const params = await searchParams;
  const nextPath = safeInternalPath(params.next);

  return (
    <PublicShell>
      <div className="page-wrap">
        <section className="section" style={{ maxWidth: 520, margin: "40px auto" }}>
          <div className="panel">
            <h1 style={{ marginTop: 0 }}>Private workspace</h1>
            <p className="muted">Sign in to open private research tools, DNA matches, source uploads, and investigations.</p>
            <LoginForm nextPath={nextPath} />
            <div className="hero-actions">
              <Link className="button-secondary" href="/setup">
                First-run setup
              </Link>
            </div>
          </div>
        </section>
      </div>
    </PublicShell>
  );
}
