import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { CaseResearchGuide } from "@/components/case-research-guide";
import { CaseTaskList } from "@/components/case-task-list";
import { DemoCaseResearchBrief } from "@/components/demo-case-research-brief";
import { DemoGuidedCaseJourney } from "@/components/demo-guided-case-journey";
import { EvidenceRecordDetails, EvidenceScan } from "@/components/evidence-scan";
import { Confidence, Status } from "@/components/ui";
import { getSessionContext, workspaceOptionsForSession } from "@/lib/auth-session";
import { isDnaResearchCase, projectResearchCaseForDnaCapability } from "@/lib/case-search";
import { demoArchiveMediaForEvidence } from "@/lib/demo-archive-media";
import { isGuidedResearchEnabled } from "@/lib/guided-research-config";
import { resolveHostedCapabilities } from "@/lib/hosted-capabilities";
import { publicDemoGuidedCaseId } from "@/lib/public-demo-contract";
import { hasPermission } from "@/lib/rbac";
import { readWorkspace } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

export default async function CaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const capabilities = resolveHostedCapabilities();
  const { id } = await params;
  const session = await getSessionContext(await headers());
  if (!session) notFound();
  const workspace = await readWorkspace(workspaceOptionsForSession(session));
  const researchCase = workspace.cases.find((item) => item.id === id);
  const guidedResearchEnabled = isGuidedResearchEnabled();
  const canWriteCases = session.kind !== "demo-guest" && hasPermission(session.role, "cases:write");

  if (!researchCase || (!capabilities.dna && isDnaResearchCase(researchCase))) {
    notFound();
  }
  const visibleResearchCase = projectResearchCaseForDnaCapability(researchCase, capabilities.dna);
  const dnaMatchesById = capabilities.dna
    ? new Map(workspace.dnaMatches.map((match) => [match.id, match]))
    : undefined;

  return (
    <AppShell title={visibleResearchCase.title} active="/app/cases" archiveName={workspace.archiveName}>
      <section className="app-card case-question-card">
        <div>
          <span className="card-kicker">Research question</span>
          <h2>{visibleResearchCase.question}</h2>
          <p className="muted">Focus: {visibleResearchCase.focus || "Not set yet"}</p>
        </div>
        <Status tone={visibleResearchCase.status === "planning" || visibleResearchCase.status === "paused" ? "warning" : "ok"}>{visibleResearchCase.status}</Status>
      </section>

      {session.kind === "demo-guest" ? (
        <div className="case-research-workspace demo-case-experience">
          {visibleResearchCase.id === publicDemoGuidedCaseId ? (
            <DemoGuidedCaseJourney initialCase={visibleResearchCase} />
          ) : (
            <DemoCaseResearchBrief researchCase={visibleResearchCase} />
          )}
        </div>
      ) : guidedResearchEnabled ? (
        <CaseResearchGuide
          initialCase={visibleResearchCase}
          canWrite={canWriteCases}
          dnaEnabled={capabilities.dna}
        />
      ) : (
        <section className="app-grid case-guide-disabled">
          <div className="app-card">
            <h2>Hypotheses</h2>
            <div className="evidence-list">
              {visibleResearchCase.hypotheses.map((hypothesis) => (
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
              caseId={visibleResearchCase.id}
              initialTasks={visibleResearchCase.tasks}
            />
          </aside>
        </section>
      )}

      <section className="app-card" style={{ marginTop: 20 }}>
        <h2>Evidence</h2>
        <div className="evidence-list">
          {visibleResearchCase.evidence.map((evidence) => {
            const scan = capabilities.datasetMode === "demo"
              ? demoArchiveMediaForEvidence(evidence.id)
              : undefined;

            return (
              <div className={`evidence-item${scan ? " evidence-item--scan" : ""}`} key={evidence.id}>
                {scan ? <EvidenceScan media={scan} /> : null}
                <div>
                  <div className="evidence-item-heading">
                    <strong>{evidence.title}</strong>
                    {evidence.linkedDnaMatchId && dnaMatchesById ? <Status tone="warning">DNA linked</Status> : <Status>{evidence.type}</Status>}
                  </div>
                  {evidence.linkedDnaMatchId && dnaMatchesById ? (
                    <p className="muted">Linked match: {dnaMatchesById.get(evidence.linkedDnaMatchId)?.displayName ?? evidence.linkedDnaMatchId}</p>
                  ) : null}
                  <p>{evidence.summary}</p>
                  <Confidence value={evidence.confidence} />
                  {scan ? <EvidenceRecordDetails media={scan} /> : null}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </AppShell>
  );
}
