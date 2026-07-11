import { AppShell } from "@/components/app-shell";
import { PaginationLinks } from "@/components/pagination-links";
import { Metric, Status } from "@/components/ui";
import { parsePositiveInteger, type SearchParamValue } from "@/lib/pagination";
import { buildQualityReportPage } from "@/lib/quality";
import { readWorkspace } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

const reportPageSize = 50;

type ReportsSearchParams = Record<string, SearchParamValue>;

export default async function ReportsPage({ searchParams }: { searchParams: Promise<ReportsSearchParams> }) {
  const params = await searchParams;
  const workspace = await readWorkspace();
  const report = buildQualityReportPage(workspace.people, workspace.dnaMatches, workspace.cases, {
    page: parsePositiveInteger(params.issuesPage, 1),
    pageSize: reportPageSize
  });

  return (
    <AppShell title="Quality Reports" active="/app/reports" archiveName={workspace.archiveName}>
      <div className="metric-row">
        <Metric label="Archive quality" value={`${report.score}%`} detail="from automated checks" />
        <Metric label="High severity" value={report.summary.high} detail="fix before publishing" />
        <Metric label="Source gaps" value={report.summary.sourceGaps} detail="vital facts" />
        <Metric label="DNA gaps" value={report.summary.dnaGaps} detail="triage blockers" />
      </div>

      <section className="app-card">
        <div className="table-heading-row">
          <div>
            <h2>Prioritized review queue</h2>
            <p className="muted">
              Showing {report.issues.start.toLocaleString()}-{report.issues.end.toLocaleString()} of {report.issues.total.toLocaleString()}
            </p>
          </div>
          <PaginationLinks ariaLabel="Quality report issue pages" page={report.issues.page} pageCount={report.issues.pageCount} pageParam="issuesPage" pathname="/app/reports" searchParams={params} />
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Severity</th>
              <th>Area</th>
              <th>Issue</th>
              <th>Recommended action</th>
            </tr>
          </thead>
          <tbody>
            {report.issues.items.map((issue) => (
              <tr key={issue.id}>
                <td>
                  <Status tone={issue.severity === "high" || issue.severity === "medium" ? "warning" : "private"}>{issue.severity}</Status>
                </td>
                <td>{issue.area}</td>
                <td>
                  <strong>{issue.title}</strong>
                  <div className="muted">{issue.detail}</div>
                </td>
                <td>{issue.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {report.issues.items.length === 0 ? <p className="muted empty-state">No quality issues found.</p> : null}
        <div className="table-footer-row">
          <p className="muted">
            Page {report.issues.page.toLocaleString()} of {report.issues.pageCount.toLocaleString()}
          </p>
          <PaginationLinks ariaLabel="Quality report issue pages" page={report.issues.page} pageCount={report.issues.pageCount} pageParam="issuesPage" pathname="/app/reports" searchParams={params} />
        </div>
      </section>
    </AppShell>
  );
}
