import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Icons } from "@/components/icons";
import { Metric, Status } from "@/components/ui";
import { demoPeople } from "@/lib/demo-data";
import { buildPublicationPlan, type PublicationStatus } from "@/lib/publishing";

export default function PublishingPage() {
  const plan = buildPublicationPlan(demoPeople);
  const nextBlockers = plan.profiles.flatMap((profile) =>
    profile.issues
      .filter((issue) => issue.severity === "blocker")
      .map((issue) => ({
        ...issue,
        personName: profile.displayName,
        personId: profile.personId
      }))
  );

  return (
    <AppShell
      title="Publishing Review"
      active="/app/publishing"
      actions={
        <Link className="button-secondary" href="/people">
          <Icons.BookOpen size={16} aria-hidden />
          Public Index
        </Link>
      }
    >
      <div className="metric-row">
        <Metric label="Publishing score" value={`${plan.score}%`} detail="demo readiness" />
        <Metric label="Ready" value={plan.summary.ready} detail="safe to publish" />
        <Metric label="Needs review" value={plan.summary.needsReview} detail={`${plan.summary.warningCount} warnings`} />
        <Metric label="Blocked" value={plan.summary.blocked} detail={`${plan.summary.blockerCount} blockers`} />
      </div>

      <div className="app-grid">
        <section className="app-card">
          <h2>Profile readiness queue</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Profile</th>
                <th>Public facts</th>
                <th>Sources</th>
                <th>Score</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {plan.profiles.map((profile) => (
                <tr key={profile.personId}>
                  <td>
                    <Status tone={statusTone(profile.status)}>{profile.status.replace("_", " ")}</Status>
                  </td>
                  <td>
                    <Link href={`/app/people/${profile.personId}`}>{profile.displayName}</Link>
                    <div className="muted">
                      {profile.published ? "Published" : "Draft"} ·{" "}
                      {profile.status === "blocked" ? (
                        "No public preview"
                      ) : (
                        <Link href={profile.previewPath}>{profile.previewPath}</Link>
                      )}
                    </div>
                  </td>
                  <td>{profile.publicFactCount}</td>
                  <td>{profile.sourceCoverage}%</td>
                  <td>{profile.readinessScore}%</td>
                  <td>{profile.recommendedAction}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <aside className="app-card">
          <h2>Publication gates</h2>
          <div className="evidence-list">
            <div className="evidence-item">
              <strong>Private by default</strong>
              <p className="muted">Living, unknown-status, private, sensitive, and investigation-only records stay out of public pages.</p>
            </div>
            <div className="evidence-item">
              <strong>Facts must be curated</strong>
              <p className="muted">Only public facts are counted. Thin or poorly cited profiles are held for review.</p>
            </div>
            <div className="evidence-item">
              <strong>Preview before sharing</strong>
              <p className="muted">Ready profiles point to the public route that anonymous visitors will see.</p>
            </div>
          </div>
        </aside>
      </div>

      <section className="app-card" style={{ marginTop: 20 }}>
        <h2>Next blockers</h2>
        {nextBlockers.length > 0 ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>Profile</th>
                <th>Blocker</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {nextBlockers.map((issue) => (
                <tr key={issue.id}>
                  <td>
                    <Link href={`/app/people/${issue.personId}`}>{issue.personName}</Link>
                  </td>
                  <td>
                    <strong>{issue.title}</strong>
                    <div className="muted">{issue.detail}</div>
                  </td>
                  <td>{issue.action}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No blocking publication issues found in the current demo set.</p>
        )}
      </section>
    </AppShell>
  );
}

function statusTone(status: PublicationStatus): "ok" | "warning" | "danger" {
  if (status === "ready") {
    return "ok";
  }
  if (status === "needs_review") {
    return "warning";
  }
  return "danger";
}
