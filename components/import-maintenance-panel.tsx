"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icons } from "@/components/icons";

type RepairResult = {
  rawRecordCount: number;
  importedPeopleChecked: number;
  updatedPeople: number;
  relationshipCount: number;
};

export function ImportMaintenancePanel({ rawRecordCount }: { rawRecordCount: number }) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "repairing" | "done" | "error">("idle");
  const [result, setResult] = useState<RepairResult | undefined>();
  const [error, setError] = useState("");

  async function repairRelationships() {
    setStatus("repairing");
    setResult(undefined);
    setError("");

    try {
      const response = await fetch("/api/imports/relationships", {
        method: "POST"
      });
      const body = await response.json().catch(() => undefined);

      if (!response.ok || !body) {
        throw new Error(typeof body?.error === "string" ? body.error : "Relationship repair failed");
      }

      setResult(body as RepairResult);
      setStatus("done");
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Relationship repair failed");
      setStatus("error");
    }
  }

  return (
    <div className="evidence-item">
      <strong>Relationship links</strong>
      <p className="muted">
        Rebuild parent, spouse, child, and sibling links from {rawRecordCount.toLocaleString()} stored raw GEDCOM records without uploading the file again.
      </p>
      <div aria-busy={status === "repairing"} className="hero-actions">
        <button
          aria-busy={status === "repairing"}
          className="button-secondary"
          disabled={status === "repairing" || rawRecordCount === 0}
          onClick={repairRelationships}
          type="button"
        >
          <Icons.GitBranch size={16} aria-hidden />
          {status === "repairing" ? "Repairing..." : "Repair links"}
        </button>
        {result ? (
          <span aria-atomic="true" className="muted" role="status">
            {result.updatedPeople.toLocaleString()} people updated · {result.relationshipCount.toLocaleString()} links
          </span>
        ) : null}
      </div>
      {status === "error" ? (
        <p aria-atomic="true" className="form-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
