import { AppShell } from "@/components/app-shell";
import { ArchiveBrandingForm } from "@/components/archive-branding-form";
import { Status } from "@/components/ui";
import { getRuntimeStatus } from "@/lib/runtime-status";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const runtime = await getRuntimeStatus();
  const archiveName = runtime.database.archiveName || "Private archive";

  return (
    <AppShell title="Settings" active="/app/settings" archiveName={archiveName}>
      <div className="app-grid">
        <div className="app-card">
          <h2>Archive branding</h2>
          <p className="muted">The name and tagline appear across the private workspace and the public archive.</p>
          <ArchiveBrandingForm initialName={runtime.database.archiveName} initialTagline={runtime.database.archiveTagline} />
        </div>
        <aside className="app-card">
          <h2>AI provider</h2>
          <div className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
            <label className="field">
              <span>Base URL</span>
              <input readOnly value={runtime.ai.baseUrl} />
            </label>
            <label className="field">
              <span>Chat model</span>
              <input readOnly value={runtime.ai.chatModel} />
            </label>
            <label className="field">
              <span>Embedding model</span>
              <input readOnly value={runtime.ai.embeddingModel} />
            </label>
            <label className="field">
              <span>API mode</span>
              <input readOnly value={runtime.ai.mode} />
            </label>
            <Status tone={runtime.ai.configured ? "ok" : "warning"}>{runtime.ai.configured ? "Provider key configured" : "API key stored server-side only"}</Status>
          </div>
        </aside>
      </div>

      <section className="app-card" style={{ marginTop: 20 }}>
        <div className="app-card-header">
          <div>
            <h2>Runtime storage</h2>
            <p className="muted">Postgres stores workspace data; private Blob storage stages large GEDCOM files outside the function request path.</p>
          </div>
          <Status tone={runtime.database.connected ? "ok" : "warning"}>{runtime.database.connected ? "Postgres connected" : "Database unavailable"}</Status>
        </div>
        <div className="form-grid">
          <label className="field">
            <span>Database</span>
            <input readOnly value={runtime.database.configured ? "Configured in DATABASE_URL" : "Missing DATABASE_URL"} />
          </label>
          <label className="field">
            <span>Archive id</span>
            <input readOnly value={runtime.database.archiveId} />
          </label>
          <label className="field">
            <span>Large-file staging</span>
            <input readOnly value={runtime.storage.configured ? "Private Blob configured" : "Missing BLOB_READ_WRITE_TOKEN"} />
          </label>
          <label className="field">
            <span>People</span>
            <input readOnly value={runtime.database.peopleCount.toLocaleString()} />
          </label>
          <label className="field">
            <span>Cases</span>
            <input readOnly value={runtime.database.caseCount.toLocaleString()} />
          </label>
          <label className="field">
            <span>AI runs</span>
            <input readOnly value={runtime.database.aiRunCount.toLocaleString()} />
          </label>
        </div>
        {runtime.database.error ? <p className="form-error" role="alert">{runtime.database.error}</p> : null}
      </section>

      <section className="app-card" style={{ marginTop: 20 }}>
        <h2>Roles</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Role</th>
              <th>Purpose</th>
              <th>Whole-tree AI</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Owner</td>
              <td>Controls system settings, imports, users, publishing, and AI.</td>
              <td>Yes</td>
            </tr>
            <tr>
              <td>Admin</td>
              <td>Manages users, imports, publishing, and research operations.</td>
              <td>Yes</td>
            </tr>
            <tr>
              <td>Editor</td>
              <td>Edits people, cases, evidence, DNA matches, and public stories.</td>
              <td>No</td>
            </tr>
            <tr>
              <td>Contributor</td>
              <td>Adds evidence, tasks, notes, and research observations.</td>
              <td>No</td>
            </tr>
            <tr>
              <td>Viewer</td>
              <td>Reads approved private content.</td>
              <td>No</td>
            </tr>
          </tbody>
        </table>
      </section>
    </AppShell>
  );
}
