import { AppShell } from "@/components/app-shell";
import { AIAnalystWorkspace } from "@/components/ai-analyst-workspace";
import { findStructuredAnomalies } from "@/lib/ai";
import { createWorkspaceDnaHypotheses, readWorkspace } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

const initialQuestion = "Could Samuel Mercer and Samuel March be the same person, and which fictional Hartwell–Mercer record should be checked next?";

export default async function AIPage() {
  const workspace = await readWorkspace();
  const dnaHypotheses = createWorkspaceDnaHypotheses(workspace);
  const anomalies = findStructuredAnomalies(workspace.people);

  return (
    <AppShell title="AI Analyst" active="/app/ai" archiveName={workspace.archiveName}>
      <p className="fiction-disclosure" role="note"><strong>Built-in prompt only:</strong> the Hartwell–Mercer names, places, dates, records, photograph, and DNA clues are entirely fictional. Your own workspace content is not demo data.</p>
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
