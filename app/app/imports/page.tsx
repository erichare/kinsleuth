import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { DataSourcesWorkspace } from "@/components/data-sources-workspace";
import { ImportMaintenancePanel } from "@/components/import-maintenance-panel";
import { Status } from "@/components/ui";
import { getSessionContext } from "@/lib/auth-session";
import { getIntegrationFeatureFlags } from "@/lib/integrations/feature-flags";
import { toPublicIntegrationConnection } from "@/lib/integrations/public-projections";
import { listIntegrationConnections } from "@/lib/integrations/store";
import { hasPermission } from "@/lib/rbac";
import { readWorkspace } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

export default async function ImportsPage() {
  const session = await getSessionContext(await headers());
  if (!session || !hasPermission(session.role, "imports:manage")) {
    notFound();
  }

  const archiveOptions = { archiveId: session.archiveId };
  const [workspace, storedConnections] = await Promise.all([
    readWorkspace(archiveOptions),
    listIntegrationConnections(archiveOptions)
  ]);
  const integrationFlags = getIntegrationFeatureFlags();
  const connections = storedConnections.map(toPublicIntegrationConnection);
  const importHistory = workspace.imports.map((item) => ({
    id: item.id,
    sourceName: item.sourceName,
    appliedAt: item.appliedAt,
    recordCount: item.recordCount,
    backupAvailable: Boolean(item.backupId)
  }));

  return (
    <AppShell title="Data sources" active="/app/imports" archiveName={workspace.archiveName}>
      <DataSourcesWorkspace
        desktopMediaRetentionEnabled={
          integrationFlags.desktopMedia && integrationFlags.desktopMediaLegalReviewApproved
        }
        exportRefreshEnabled={integrationFlags.exportRefresh}
        initialConnections={connections}
      />

      <div className="app-grid data-source-history">
        <div className="app-card">
          <h2>Applied import history</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Applied</th>
                <th>Status</th>
                <th>Records</th>
                <th>Backup available</th>
              </tr>
            </thead>
            <tbody>
              {importHistory.length > 0 ? importHistory.map((item) => (
                <tr key={item.id}>
                  <td>{item.sourceName}</td>
                  <td>{new Date(item.appliedAt).toLocaleString()}</td>
                  <td>
                    <Status>applied</Status>
                  </td>
                  <td>{item.recordCount.toLocaleString()}</td>
                  <td>{item.backupAvailable ? "Yes" : "No"}</td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={5}>No GEDCOM has been applied to this workspace yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <aside className="app-card">
          <h2>Archive portability</h2>
          <p className="muted">
            Kin Resolve previews every GEDCOM before applying it. New imports preserve raw records and later re-imports produce a reviewable diff so curated research is not overwritten silently.
          </p>
          <div className="evidence-list">
            <div className="evidence-item">
              <strong>Traceable by design</strong>
              <p className="muted">Raw xrefs, Ancestry IDs, URLs, citations, notes, and media pointers remain attached to imported records.</p>
            </div>
            <div className="evidence-item">
              <strong>Yours to take anywhere</strong>
              <p className="muted">Download the whole archive as GEDCOM 5.5.1 at any time. Compatibility-preserved curation tags let another Kin Resolve instance restore them on import.</p>
              <a className="button-secondary" href="/api/exports/gedcom" download>
                Export GEDCOM
              </a>
            </div>
            <ImportMaintenancePanel rawRecordCount={workspace.rawRecords.length} />
          </div>
        </aside>
      </div>
    </AppShell>
  );
}
