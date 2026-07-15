"use client";

import { OperationalErrorReporter } from "@/components/operational-error-reporter";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body>
        <OperationalErrorReporter />
        <main className="route-state route-state-error" id="main-content" tabIndex={-1}>
          <div className="route-state-message" role="alert">
            <div>
              <h1>Kin Resolve needs another try</h1>
              <p>Your archive data was not changed. Reload this view when you are ready.</p>
            </div>
          </div>
          <button className="button" onClick={reset} type="button">Try again</button>
        </main>
      </body>
    </html>
  );
}
