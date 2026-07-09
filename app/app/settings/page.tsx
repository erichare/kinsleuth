import { AppShell } from "@/components/app-shell";
import { Status } from "@/components/ui";
import { getRuntimeStatus } from "@/lib/runtime-status";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const runtime = await getRuntimeStatus();

  return (
    <AppShell title="Settings" active="/app/settings">
      <div className="app-grid">
        <div className="app-card">
          <h2>Archive branding</h2>
          <div className="form-grid">
            <label className="field">
              <span>Archive name</span>
              <input defaultValue="Riemer - Zajicek Archive" />
            </label>
            <label className="field">
              <span>Tagline</span>
              <input defaultValue="A free and open archive of curated family history." />
            </label>
            <label className="field">
              <span>Accent color</span>
              <input defaultValue="#00634f" />
            </label>
            <label className="field">
              <span>Public root</span>
              <input defaultValue="/" />
            </label>
          </div>
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
            <p className="muted">Postgres is the active workspace store for people, sources, DNA, cases, imports, tasks, and AI runs.</p>
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
