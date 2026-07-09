import { AppShell } from "@/components/app-shell";
import { DnaTriageWorkspace } from "@/components/dna-triage-workspace";
import { createWorkspaceDnaHypotheses, readWorkspace, scoreWorkspaceDnaMatches } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

export default async function DnaPage() {
  const workspace = await readWorkspace();
  const scoredDnaMatches = scoreWorkspaceDnaMatches(workspace);
  const dnaHypotheses = createWorkspaceDnaHypotheses(workspace);

  return (
    <AppShell title="DNA Match Triage" active="/app/dna">
      <DnaTriageWorkspace initialCases={workspace.cases} initialMatches={scoredDnaMatches} initialHypotheses={dnaHypotheses} />
    </AppShell>
  );
}
