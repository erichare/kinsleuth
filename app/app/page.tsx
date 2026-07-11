import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Icons } from "@/components/icons";
import { Confidence, Metric, Status, TableScroll } from "@/components/ui";
import { buildDashboardSummary } from "@/lib/dashboard";
import { createDnaConnectionHypothesis } from "@/lib/dna";
import { readWorkspace } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

export default async function AppDashboardPage() {
  const workspace = await readWorkspace();
  const dashboard = buildDashboardSummary(workspace);
  const dnaHypotheses = dashboard.dnaLeads.slice(0, 2).map((match) => createDnaConnectionHypothesis(match, workspace.people));
  const visibleActions = dashboard.actions.slice(0, 5);
  const remainingActionCount = Math.max(0, dashboard.actions.length - visibleActions.length);

  return (
    <AppShell
      title="Investigation Dashboard"
      active="/app"
      archiveName={workspace.archiveName}
      actions={
        <div className="hero-actions" style={{ marginTop: 0 }}>
          <Link className="button" href="/app/cases">
            <Icons.FileSearch size={16} aria-hidden />
            New Case
          </Link>
          <Link className="button-secondary" href="/app/imports">
            <Icons.Upload size={16} aria-hidden />
            Import GEDCOM
          </Link>
        </div>
      }
    >
      <div className="metric-row">
        <Metric icon={<Icons.Users size={18} aria-hidden />} label="Imported people" value={dashboard.metrics.people.toLocaleString()} detail="from private workspace" />
        <Metric icon={<Icons.Database size={18} aria-hidden />} label="Source refs" value={dashboard.metrics.sourceReferences.toLocaleString()} detail={`${dashboard.metrics.sourceDocuments.toLocaleString()} source docs`} />
        <Metric icon={<Icons.Dna size={18} aria-hidden />} label="DNA matches" value={dashboard.metrics.dnaMatches.toLocaleString()} detail={`${dashboard.metrics.triagedDnaMatches.toLocaleString()} triaged`} />
        <Metric icon={<Icons.FileSearch size={18} aria-hidden />} label="Active cases" value={dashboard.metrics.activeCases.toLocaleString()} detail={`${dashboard.metrics.highPriorityDnaMatches.toLocaleString()} high-priority DNA`} />
      </div>

      <div className="dashboard-columns">
        <div className="dashboard-column">
          <section className="app-card dashboard-cases">
            <div className="app-card-header">
              <div>
                <span className="card-kicker">Research in motion</span>
                <h2>Cases</h2>
              </div>
              <Link className="button-ghost" href="/app/cases">View all</Link>
            </div>
            <TableScroll label="Active research cases">
              <table className="data-table dashboard-case-table">
                <thead>
                  <tr>
                    <th>Case</th>
                    <th>Status</th>
                    <th>Focus</th>
                    <th data-numeric>Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.caseRows.map((researchCase) => (
                    <tr key={researchCase.id}>
                      <td><Link href={`/app/cases/${researchCase.id}`}>{researchCase.title}</Link></td>
                      <td><Status tone={researchCase.status === "planning" ? "warning" : "ok"}>{researchCase.status}</Status></td>
                      <td>{researchCase.focus}</td>
                      <td data-numeric>
                        {researchCase.evidenceCount}
                        {researchCase.dnaEvidenceCount ? <div className="muted">{researchCase.dnaEvidenceCount} DNA</div> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </section>

          <section className="app-card surface-quiet dashboard-ai">
            <div className="app-card-header">
              <div>
                <span className="card-kicker">Pattern support</span>
                <h2>AI Analyst</h2>
              </div>
              <Link className="button-ghost" href="/app/ai">Open analyst</Link>
            </div>
            <div className="evidence-list">
              {dnaHypotheses.slice(0, 2).map((hypothesis) => (
                <div className="evidence-item surface-inset" key={hypothesis.matchId}>
                  <strong>{hypothesis.likelyBranch}</strong>
                  <p className="muted">{hypothesis.explanation}</p>
                  <Confidence value={hypothesis.confidence} />
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="dashboard-column">
          <aside className={`app-card dashboard-actions ${dashboard.actions.length ? "surface-warning" : "surface-quiet"}`}>
            <div className="app-card-header">
              <div>
                <span className="card-kicker">Needs attention</span>
                <h2>Action queue</h2>
              </div>
              <Status tone={dashboard.actions.length ? "danger" : "ok"}>{dashboard.actions.length}</Status>
            </div>
            <div className="evidence-list dashboard-action-list">
              {visibleActions.map((action) => (
                <Link className="evidence-item" href={action.href} key={action.id}>
                  <div className="evidence-item-heading">
                    <strong>{action.title}</strong>
                    <Status tone={action.tone}>{action.tone}</Status>
                  </div>
                  <p className="muted">{action.detail}</p>
                </Link>
              ))}
            </div>
            {remainingActionCount > 0 ? <Link className="dashboard-card-footer" href="/app/reports">Review {remainingActionCount} more items</Link> : null}
            {dashboard.actions.length === 0 ? <p className="muted empty-state">No urgent review items found.</p> : null}
          </aside>

          <section className="app-card dashboard-dna">
            <div className="app-card-header">
              <div>
                <span className="card-kicker">Recent signals</span>
                <h2>DNA triage</h2>
              </div>
              <Link className="button-ghost" href="/app/dna">Open queue</Link>
            </div>
            <div className="dashboard-dna-list">
              {dashboard.dnaLeads.map((match) => (
                <Link className="dashboard-dna-item" href="/app/dna" key={match.id}>
                  <div>
                    <strong>{match.displayName}</strong>
                    <span className="muted">{match.totalCm} cM · {match.side} · {match.treeStatus} tree</span>
                  </div>
                  <div className="dashboard-dna-signal">
                    <Confidence value={match.helpfulnessScore / 100} />
                    <Status tone={match.triageStatus === "high_priority" ? "warning" : "ok"}>{match.triageStatus.replace("_", " ")}</Status>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        </div>
      </div>
    </AppShell>
  );
}
