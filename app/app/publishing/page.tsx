import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Icons } from "@/components/icons";
import { PaginationLinks } from "@/components/pagination-links";
import { Metric, Status } from "@/components/ui";
import { parsePositiveInteger, type SearchParamValue } from "@/lib/pagination";
import { buildPublicationReview, type PublicationStatus } from "@/lib/publishing";
import { readWorkspace } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

const publishingPageSize = 50;

type PublishingSearchParams = Record<string, SearchParamValue>;

export default async function PublishingPage({ searchParams }: { searchParams: Promise<PublishingSearchParams> }) {
  const params = await searchParams;
  const workspace = await readWorkspace();
  const review = buildPublicationReview(workspace.people, {
    profilePage: parsePositiveInteger(params.profilesPage, 1),
    blockerPage: parsePositiveInteger(params.blockersPage, 1),
    pageSize: publishingPageSize
  });

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
        <Metric label="Publishing score" value={`${review.score}%`} detail="demo readiness" />
        <Metric label="Ready" value={review.summary.ready} detail="safe to publish" />
        <Metric label="Needs review" value={review.summary.needsReview} detail={`${review.summary.warningCount} warnings`} />
        <Metric label="Blocked" value={review.summary.blocked} detail={`${review.summary.blockerCount} blockers`} />
      </div>

      <div className="app-grid">
        <section className="app-card">
          <div className="table-heading-row">
            <div>
              <h2>Profile readiness queue</h2>
              <p className="muted">
                Showing {review.profiles.start.toLocaleString()}-{review.profiles.end.toLocaleString()} of {review.profiles.total.toLocaleString()}
              </p>
            </div>
            <PaginationLinks ariaLabel="Profile readiness pages" page={review.profiles.page} pageCount={review.profiles.pageCount} pageParam="profilesPage" pathname="/app/publishing" searchParams={params} />
          </div>
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
              {review.profiles.items.map((profile) => (
                <tr key={profile.personId}>
                  <td>
                    <Status tone={statusTone(profile.status)}>{profile.status.replace("_", " ")}</Status>
                  </td>
                  <td>
                    <Link href={`/app/people/${encodeURIComponent(profile.personId)}`}>{profile.displayName}</Link>
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
          <div className="table-footer-row">
            <p className="muted">
              Page {review.profiles.page.toLocaleString()} of {review.profiles.pageCount.toLocaleString()}
            </p>
            <PaginationLinks ariaLabel="Profile readiness pages" page={review.profiles.page} pageCount={review.profiles.pageCount} pageParam="profilesPage" pathname="/app/publishing" searchParams={params} />
          </div>
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
        <div className="table-heading-row">
          <div>
            <h2>Next blockers</h2>
            <p className="muted">
              Showing {review.blockers.start.toLocaleString()}-{review.blockers.end.toLocaleString()} of {review.blockers.total.toLocaleString()}
            </p>
          </div>
          <PaginationLinks ariaLabel="Publication blocker pages" page={review.blockers.page} pageCount={review.blockers.pageCount} pageParam="blockersPage" pathname="/app/publishing" searchParams={params} />
        </div>
        {review.blockers.items.length > 0 ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>Profile</th>
                <th>Blocker</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {review.blockers.items.map((issue) => (
                <tr key={issue.id}>
                  <td>
                    <Link href={`/app/people/${encodeURIComponent(issue.personId)}`}>{issue.personName}</Link>
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
        <div className="table-footer-row">
          <p className="muted">
            Page {review.blockers.page.toLocaleString()} of {review.blockers.pageCount.toLocaleString()}
          </p>
          <PaginationLinks ariaLabel="Publication blocker pages" page={review.blockers.page} pageCount={review.blockers.pageCount} pageParam="blockersPage" pathname="/app/publishing" searchParams={params} />
        </div>
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
