import { AppShell } from "@/components/app-shell";
import { AIAnalystWorkspace } from "@/components/ai-analyst-workspace";
import { findStructuredAnomalies } from "@/lib/ai";
import { createWorkspaceDnaHypotheses, readWorkspace } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

const initialQuestion = "Where is J. Fletcher most likely to connect to the Riemer maternal line, and which evidence should be checked next?";

export default async function AIPage() {
  const workspace = await readWorkspace();
  const dnaHypotheses = createWorkspaceDnaHypotheses(workspace);
  const anomalies = findStructuredAnomalies(workspace.people);

  return (
    <AppShell title="AI Analyst" active="/app/ai" archiveName={workspace.archiveName}>
      <AIAnalystWorkspace
        initialQuestion={initialQuestion}
        cases={workspace.cases}
        initialRuns={workspace.aiRuns}
        anomalies={anomalies}
        counts={{
          people: workspace.people.length,
          cases: workspace.cases.length,
          dnaHypotheses: dnaHypotheses.length
        }}
        dnaHypotheses={dnaHypotheses}
      />
    </AppShell>
  );
}
