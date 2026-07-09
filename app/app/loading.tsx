import { Icons } from "@/components/icons";

export default function WorkspaceLoading() {
  return (
    <main className="route-state" id="main-content" tabIndex={-1}>
      <div className="route-state-message" role="status" aria-live="polite">
        <span className="route-state-icon"><Icons.TreePine size={24} aria-hidden /></span>
        <div>
          <h1>Opening the archive</h1>
          <p>Loading private research, sources, and case context…</p>
        </div>
      </div>
      <span className="route-state-progress" aria-hidden />
    </main>
  );
}
