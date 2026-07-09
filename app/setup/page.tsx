import Link from "next/link";
import { PublicShell } from "@/components/public-shell";

export default function SetupPage() {
  return (
    <PublicShell>
      <div className="page-wrap">
        <section className="page-title section">
          <h1>First-run setup</h1>
          <p>Create the owner account, name the archive, import a GEDCOM, configure privacy defaults, and connect an OpenAI-compatible AI provider.</p>
        </section>
        <section className="grid-2">
          <div className="panel">
            <h2>Archive basics</h2>
            <div className="form-grid">
              <label className="field">
                <span>Archive name</span>
                <input defaultValue="Riemer - Zajicek Archive" />
              </label>
              <label className="field">
                <span>Accent color</span>
                <input defaultValue="#00634f" />
              </label>
              <label className="field">
                <span>Owner email</span>
                <input defaultValue="owner@example.com" />
              </label>
              <label className="field">
                <span>Living-person rule</span>
                <select defaultValue="conservative-100">
                  <option value="conservative-100">Conservative 100 year rule</option>
                </select>
              </label>
            </div>
          </div>
          <div className="panel">
            <h2>Import and AI</h2>
            <div className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
              <label className="field">
                <span>GEDCOM file</span>
                <input type="file" />
              </label>
              <label className="field">
                <span>AI base URL</span>
                <input defaultValue="https://api.openai.com/v1" />
              </label>
              <label className="field">
                <span>Chat model</span>
                <input defaultValue="gpt-5-mini" />
              </label>
            </div>
            <div className="hero-actions">
              <Link className="button" href="/app/imports">
                Continue to imports
              </Link>
            </div>
          </div>
        </section>
      </div>
    </PublicShell>
  );
}
