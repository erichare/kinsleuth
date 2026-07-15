"use client";

import { useEffect } from "react";

export function OperationalErrorReporter() {
  useEffect(() => {
    const body = JSON.stringify({ event: "browser-unhandled-error" });
    void fetch("/api/observability/client-errors", {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: { "content-type": "application/json" },
      body
    }).catch(() => undefined);
  }, []);

  return null;
}
