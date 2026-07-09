"use client";

import { Icons } from "@/components/icons";

export default function WorkspaceError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="route-state route-state-error" id="main-content" tabIndex={-1}>
      <div className="route-state-message" role="alert">
        <span className="route-state-icon"><Icons.Shield size={24} aria-hidden /></span>
        <div>
          <h1>The workspace could not be opened</h1>
          <p>Your archive data was not changed. Try loading this view again.</p>
        </div>
      </div>
      <button className="button" onClick={reset} type="button">Try again</button>
    </main>
  );
}
