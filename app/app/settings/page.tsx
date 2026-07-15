import { AppShell } from "@/components/app-shell";
import { ArchiveBrandingForm } from "@/components/archive-branding-form";
import { Status } from "@/components/ui";
import { getRuntimeStatus } from "@/lib/runtime-status";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const runtime = await getRuntimeStatus();
  const archiveName = runtime.database.archiveName || "Private archive";
  const hosted = runtime.capabilities.deploymentMode === "hosted";
  const capabilityRows = [
    ["DNA", runtime.capabilities.dna],
    ["External AI", runtime.capabilities.externalAi],
    ["Public archive", runtime.capabilities.publicArchive],
    ["Public publishing", runtime.capabilities.publicPublishing],
    ["Binary evidence uploads", runtime.capabilities.evidenceBinaryUploads],
    ["Package media", runtime.capabilities.packageMedia],
    ["Plain GEDCOM", runtime.capabilities.plainGedcom]
  ] as const;

  return (
    <AppShell title="Settings" active="/app/settings" archiveName={archiveName}>
      <div className="app-grid">
        <div className="app-card">
          <h2>Archive branding</h2>
          <p className="muted">
            {runtime.capabilities.publicArchive
              ? "The name and tagline appear across the private workspace and the public archive."
              : "The name and tagline identify this private workspace."}
          </p>
          <ArchiveBrandingForm initialName={runtime.database.archiveName} initialTagline={runtime.database.archiveTagline} />
        </div>
        <aside className="app-card">
          {runtime.ai.enabled ? (
            <>
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
            </>
          ) : (
            <>
              <h2>Local analysis</h2>
              <p className="muted">
                Deterministic local analysis stays inside Kin Resolve and makes no external provider call.
              </p>
              <Status tone="private">External AI disabled</Status>
            </>
          )}
        </aside>
      </div>

      <section className="app-card" style={{ marginTop: 20 }}>
        <div className="app-card-header">
          <div>
            <h2>{hosted ? "Beta capabilities" : "Capabilities"}</h2>
            <p className="muted">Effective server-side feature gates for this deployment.</p>
          </div>
          <Status tone={runtime.capabilities.valid ? "ok" : "warning"}>
            {runtime.capabilities.valid ? "Configuration valid" : "Configuration invalid"}
          </Status>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Capability</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {capabilityRows.map(([label, enabled]) => (
              <tr key={label}>
                <td>{label}</td>
                <td><Status tone={enabled ? "ok" : "private"}>{enabled ? "Enabled" : "Disabled"}</Status></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="form-grid" style={{ marginTop: 16 }}>
          <label className="field">
            <span>GEDCOM file limit</span>
            <input readOnly value={hosted ? "10 MiB (10,485,760 bytes)" : "25 MiB"} />
          </label>
          <label className="field">
            <span>Archive people limit</span>
            <input readOnly value={hosted ? "40,000" : "No hosted limit"} />
          </label>
        </div>
      </section>

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
              <th>Whole-archive analysis</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Owner</td>
              <td>{hosted ? "Controls system settings, imports, users, and private research." : "Controls system settings, imports, users, publishing, and AI."}</td>
              <td>Yes</td>
            </tr>
            <tr>
              <td>Admin</td>
              <td>{hosted ? "Manages users, imports, and research operations." : "Manages users, imports, publishing, and research operations."}</td>
              <td>Yes</td>
            </tr>
            <tr>
              <td>Editor</td>
              <td>{hosted ? "Edits people, cases, evidence, and private research." : "Edits people, cases, evidence, DNA matches, and public stories."}</td>
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
