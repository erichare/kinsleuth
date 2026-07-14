import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { CaseResearchGuide } from "@/components/case-research-guide";
import { CaseTaskList } from "@/components/case-task-list";
import { Confidence, Status } from "@/components/ui";
import { getSessionContext } from "@/lib/auth-session";
import { isGuidedResearchEnabled } from "@/lib/guided-research-config";
import { hasPermission } from "@/lib/rbac";
import { readWorkspace } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

export default async function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSessionContext(await headers());
  const workspace = await readWorkspace(session ? { archiveId: session.archiveId } : {});
  const researchCase = workspace.cases.find((item) => item.id === id);
  const dnaMatchesById = new Map(workspace.dnaMatches.map((match) => [match.id, match]));
  const guidedResearchEnabled = isGuidedResearchEnabled();
  const canWriteCases = Boolean(session && hasPermission(session.role, "cases:write"));

  if (!researchCase) {
    notFound();
  }

  return (
    <AppShell title={researchCase.title} active="/app/cases" archiveName={workspace.archiveName}>
      <section className="app-card case-question-card">
        <div>
          <span className="card-kicker">Research question</span>
          <h2>{researchCase.question}</h2>
          <p className="muted">Focus: {researchCase.focus || "Not set yet"}</p>
        </div>
        <Status tone={researchCase.status === "planning" || researchCase.status === "paused" ? "warning" : "ok"}>{researchCase.status}</Status>
      </section>

      {guidedResearchEnabled ? (
        <CaseResearchGuide initialCase={researchCase} canWrite={canWriteCases} />
      ) : (
        <section className="app-grid case-guide-disabled">
          <div className="app-card">
            <h2>Hypotheses</h2>
            <div className="evidence-list">
              {researchCase.hypotheses.map((hypothesis) => (
                <div className="hypothesis-panel" key={hypothesis.id}>
                  <strong>{hypothesis.statement}</strong>
                  <p>Status: {hypothesis.status}</p>
                  <Confidence value={hypothesis.confidence} />
                </div>
              ))}
            </div>
          </div>
          <aside className="app-card">
            <h2>Tasks</h2>
            <CaseTaskList
              allowManualCompletion
              canWrite={canWriteCases}
              caseId={researchCase.id}
              initialTasks={researchCase.tasks}
            />
          </aside>
        </section>
      )}

      <section className="app-card" style={{ marginTop: 20 }}>
        <h2>Evidence</h2>
        <div className="evidence-list">
          {researchCase.evidence.map((evidence) => (
            <div className="evidence-item" key={evidence.id}>
              <div className="evidence-item-heading">
                <strong>{evidence.title}</strong>
                {evidence.linkedDnaMatchId ? <Status tone="warning">DNA linked</Status> : <Status>{evidence.type}</Status>}
              </div>
              {evidence.linkedDnaMatchId ? (
                <p className="muted">Linked match: {dnaMatchesById.get(evidence.linkedDnaMatchId)?.displayName ?? evidence.linkedDnaMatchId}</p>
              ) : null}
              <p>{evidence.summary}</p>
              <Confidence value={evidence.confidence} />
            </div>
          ))}
        </div>
      </section>
    </AppShell>
  );
}
