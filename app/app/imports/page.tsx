import { AppShell } from "@/components/app-shell";
import { ImportMaintenancePanel } from "@/components/import-maintenance-panel";
import { ImportPreviewWorkspace } from "@/components/import-preview-workspace";
import { Status } from "@/components/ui";
import { readWorkspace } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

export default async function ImportsPage() {
  const workspace = await readWorkspace();

  return (
    <AppShell title="GEDCOM Imports" active="/app/imports">
      <div className="app-grid">
        <div className="app-card">
          <h2>Applied imports</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Applied</th>
                <th>Status</th>
                <th>Records</th>
                <th>Backup</th>
              </tr>
            </thead>
            <tbody>
              {workspace.imports.length > 0 ? workspace.imports.map((item) => (
                <tr key={item.id}>
                  <td>{item.sourceName}</td>
                  <td>{new Date(item.appliedAt).toLocaleString()}</td>
                  <td>
                    <Status>applied</Status>
                  </td>
                  <td>{item.recordCount.toLocaleString()}</td>
                  <td>{item.backupId}</td>
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
          <h2>Import policy</h2>
          <p className="muted">
            KinSleuth previews every GEDCOM before applying it. New imports preserve raw records and later re-imports produce a reviewable diff so curated research is not overwritten silently.
          </p>
          <div className="evidence-list">
            <div className="evidence-item">
              <strong>Private by default</strong>
              <p className="muted">Imported facts, living people, DNA notes, and case evidence stay private until explicitly curated.</p>
            </div>
            <div className="evidence-item">
              <strong>Traceable by design</strong>
              <p className="muted">Raw xrefs, Ancestry IDs, URLs, citations, notes, and media pointers remain attached to imported records.</p>
            </div>
            <ImportMaintenancePanel rawRecordCount={workspace.rawRecords.length} />
          </div>
        </aside>
      </div>

      <section className="app-card" style={{ marginTop: 20, marginBottom: 20 }}>
        <h2>Diff review</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Record</th>
              <th>Type</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <Status>Added</Status>
              </td>
              <td>@I20437801951@</td>
              <td>INDI</td>
              <td>New source citation and event note preserved from Ancestry export.</td>
            </tr>
            <tr>
              <td>
                <Status tone="warning">Changed</Status>
              </td>
              <td>@F2545@</td>
              <td>FAM</td>
              <td>Relationship xref changed; curated overlay requires review.</td>
            </tr>
          </tbody>
        </table>
      </section>

      <ImportPreviewWorkspace />
    </AppShell>
  );
}
