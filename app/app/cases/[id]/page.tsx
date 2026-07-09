import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { Confidence, Status } from "@/components/ui";
import { readWorkspace } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

export default async function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspace = await readWorkspace();
  const researchCase = workspace.cases.find((item) => item.id === id);
  const dnaMatchesById = new Map(workspace.dnaMatches.map((match) => [match.id, match]));

  if (!researchCase) {
    notFound();
  }

  return (
    <AppShell title={researchCase.title} active="/app/cases">
      <section className="app-grid">
        <div className="app-card">
          <h2>{researchCase.question}</h2>
          <p className="muted">Focus: {researchCase.focus}</p>
          <Status tone={researchCase.status === "planning" ? "warning" : "ok"}>{researchCase.status}</Status>

          <div className="section">
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
        </div>
        <aside className="app-card">
          <h2>Tasks</h2>
          <div className="evidence-list">
            {researchCase.tasks.map((task) => (
              <div className="evidence-item" key={task.id}>
                <strong>{task.title}</strong>
                <div className="muted">{task.status}</div>
              </div>
            ))}
          </div>
        </aside>
      </section>

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
