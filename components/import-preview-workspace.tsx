"use client";

import { upload } from "@vercel/blob/client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { ImportDiff, ImportSnapshot } from "@/lib/gedcom/importer";
import {
  createGedcomUploadPath,
  formatFileSize,
  maximumCombinedGedcomSizeBytes,
  maximumGedcomFileSizeBytes,
  shouldStageGedcomFiles,
  type GedcomUploadReference
} from "@/lib/gedcom/upload-policy";
import { workspaceStorageKeys, type StoredImportPreview } from "@/lib/workspace-snapshot";
import { Status } from "./ui";

type ImportResponse = {
  snapshot: Pick<ImportSnapshot, "id" | "sourceName" | "checksum" | "summary"> & { recordCount: number };
  diff?: ImportDiff;
  applied?: {
    import: {
      id: string;
      backupId: string;
      peopleImported: number;
      sourcesImported: number;
      rawRecordCount: number;
    };
    backup: {
      id: string;
      storageKey: string;
      peopleCount: number;
      sourcesCount: number;
    };
  };
};

export function ImportPreviewWorkspace() {
  const [sourceName, setSourceName] = useState("hartwell-mercer-fictional-demo.ged");
  const [currentFile, setCurrentFile] = useState<File | undefined>();
  const [previousFile, setPreviousFile] = useState<File | undefined>();
  const [currentUpload, setCurrentUpload] = useState<GedcomUploadReference | undefined>();
  const [previousUpload, setPreviousUpload] = useState<GedcomUploadReference | undefined>();
  const [currentContent, setCurrentContent] = useState("");
  const [previousContent, setPreviousContent] = useState("");
  const [result, setResult] = useState<ImportResponse | undefined>();
  const [recentPreviews, setRecentPreviews] = useState<StoredImportPreview[]>([]);
  const [status, setStatus] = useState<"idle" | "uploading" | "loading" | "applying" | "error">("idle");
  const [uploadProgress, setUploadProgress] = useState<{ fileName: string; percentage: number } | undefined>();
  const [error, setError] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [applyArmed, setApplyArmed] = useState(false);
  const currentFileInputRef = useRef<HTMLInputElement>(null);
  const previousFileInputRef = useRef<HTMLInputElement>(null);
  const requestInProgress = status === "uploading" || status === "loading" || status === "applying";

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const stored = readLocalJson<StoredImportPreview[]>(workspaceStorageKeys.importPreviews);
      if (stored?.length) {
        setRecentPreviews(stored);
      }
      setHydrated(true);
    }, 0);

    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!hydrated) {
      return;
    }
    window.localStorage.setItem(workspaceStorageKeys.importPreviews, JSON.stringify(recentPreviews));
  }, [hydrated, recentPreviews]);

  async function readCurrentFile(file: File | undefined) {
    releaseStagedUpload(currentUpload);
    setCurrentUpload(undefined);
    setCurrentFile(file);
    setCurrentContent("");
    setResult(undefined);
    setApplyArmed(false);
    setError("");
    setUploadProgress(undefined);

    if (!file) {
      return;
    }
    if (!validateSelectedFile(file, previousFile)) {
      setCurrentFile(undefined);
      if (currentFileInputRef.current) {
        currentFileInputRef.current.value = "";
      }
      return;
    }

    setSourceName(file.name);
    if (!shouldStageGedcomFiles([file])) {
      setCurrentContent(await file.text());
    }
  }

  async function readPreviousFile(file: File | undefined) {
    releaseStagedUpload(previousUpload);
    setPreviousUpload(undefined);
    setPreviousFile(file);
    setPreviousContent("");
    setResult(undefined);
    setApplyArmed(false);
    setError("");
    setUploadProgress(undefined);

    if (!file) {
      return;
    }
    if (!validateSelectedFile(file, currentFile)) {
      setPreviousFile(undefined);
      if (previousFileInputRef.current) {
        previousFileInputRef.current.value = "";
      }
      return;
    }
    if (!shouldStageGedcomFiles([file])) {
      setPreviousContent(await file.text());
    }
  }

  function validateSelectedFile(file: File, companionFile: File | undefined): boolean {
    if (!/\.(?:ged|gedcom)$/i.test(file.name)) {
      setStatus("error");
      setError("Choose a GEDCOM file ending in .ged or .gedcom.");
      return false;
    }
    if (file.size <= 0 || file.size > maximumGedcomFileSizeBytes) {
      setStatus("error");
      setError(`GEDCOM files must be between 1 byte and ${formatFileSize(maximumGedcomFileSizeBytes)}.`);
      return false;
    }
    if (file.size + (companionFile?.size ?? 0) > maximumCombinedGedcomSizeBytes) {
      setStatus("error");
      setError(`The current and previous GEDCOM files must total ${formatFileSize(maximumCombinedGedcomSizeBytes)} or less.`);
      return false;
    }
    setStatus("idle");
    return true;
  }

  async function previewImport() {
    setStatus("loading");
    setError("");
    setResult(undefined);
    setApplyArmed(false);

    try {
      const response = await sendImportRequest(false);

      if (!response.ok) {
        if (response.status === 404 || response.status === 409) {
          resetStagedUploads();
        }
        throw new Error(await responseError(response, "GEDCOM preview failed."));
      }

      const nextResult = await parseImportResponse(response);
      setResult(nextResult);
      setRecentPreviews((current) => [
        {
          id: nextResult.snapshot.id,
          sourceName: nextResult.snapshot.sourceName,
          checksum: nextResult.snapshot.checksum,
          importedAt: new Date().toISOString(),
          recordCount: nextResult.snapshot.recordCount,
          summary: nextResult.snapshot.summary
        },
        ...current.filter((preview) => preview.id !== nextResult.snapshot.id)
      ].slice(0, 8));
    } catch (requestError) {
      setStatus("error");
      setError(errorMessage(requestError));
    } finally {
      setUploadProgress(undefined);
      setStatus((current) => (current === "error" ? current : "idle"));
    }
  }

  async function applyImport() {
    if (!result || (!currentFile && !currentContent)) {
      return;
    }

    setStatus("applying");
    setError("");

    try {
      const response = await sendImportRequest(true);

      if (!response.ok) {
        if (response.status === 404 || response.status === 409) {
          resetStagedUploads();
        }
        throw new Error(await responseError(response, "GEDCOM import failed."));
      }

      setResult(await parseImportResponse(response));
      setCurrentUpload(undefined);
      setPreviousUpload(undefined);
      setApplyArmed(false);
    } catch (requestError) {
      setStatus("error");
      setError(errorMessage(requestError));
    } finally {
      setUploadProgress(undefined);
      setStatus((current) => (current === "error" ? current : "idle"));
    }
  }

  async function sendImportRequest(apply: boolean): Promise<Response> {
    if ((currentFile?.size ?? 0) + (previousFile?.size ?? 0) > maximumCombinedGedcomSizeBytes) {
      throw new Error(`The current and previous GEDCOM files must total ${formatFileSize(maximumCombinedGedcomSizeBytes)} or less.`);
    }
    if (shouldStageGedcomFiles([currentFile, previousFile])) {
      setStatus("uploading");
      const stagedCurrent = currentFile
        ? currentUpload ?? await stageFile(currentFile)
        : undefined;
      if (stagedCurrent && stagedCurrent !== currentUpload) {
        setCurrentUpload(stagedCurrent);
      }
      const stagedPrevious = previousFile
        ? previousUpload ?? await stageFile(previousFile)
        : undefined;
      if (stagedPrevious && stagedPrevious !== previousUpload) {
        setPreviousUpload(stagedPrevious);
      }
      setUploadProgress(undefined);
      setStatus(apply ? "applying" : "loading");

      return fetch("/api/imports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourceName,
          currentUpload: stagedCurrent,
          previousUpload: stagedPrevious,
          apply
        })
      });
    }

    if (currentFile) {
      const formData = new FormData();
      formData.set("sourceName", sourceName);
      formData.set("file", currentFile);
      formData.set("apply", String(apply));
      if (previousFile) {
        formData.set("previousFile", previousFile);
      } else if (previousContent) {
        formData.set("previousContent", previousContent);
      }

      return fetch("/api/imports", {
        method: "POST",
        body: formData
      });
    }

    return fetch("/api/imports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sourceName,
        content: currentContent,
        previousContent: previousContent || undefined,
        apply
      })
    });
  }

  async function stageFile(file: File): Promise<GedcomUploadReference> {
    const uploadId = crypto.randomUUID();
    const pathname = createGedcomUploadPath(uploadId, file.name);
    const blob = await upload(pathname, file, {
      access: "private",
      contentType: "text/plain",
      handleUploadUrl: "/api/imports/uploads",
      clientPayload: JSON.stringify({ uploadId, originalName: file.name, size: file.size }),
      onUploadProgress: ({ percentage }) => setUploadProgress({ fileName: file.name, percentage })
    });

    return { pathname: blob.pathname, etag: blob.etag, size: file.size };
  }

  function releaseStagedUpload(reference: GedcomUploadReference | undefined) {
    if (!reference) {
      return;
    }
    void fetch("/api/imports/uploads", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pathname: reference.pathname }),
      keepalive: true
    });
  }

  function resetStagedUploads() {
    releaseStagedUpload(currentUpload);
    releaseStagedUpload(previousUpload);
    setCurrentUpload(undefined);
    setPreviousUpload(undefined);
  }

  return (
    <div className="app-grid">
      <div aria-busy={status === "loading" || status === "uploading"} className="app-card">
        <h2>Preview GEDCOM import</h2>
        <p className="muted">Preview a GEDCOM, preserve raw records, and apply it to the private workspace with a backup before changes are saved.</p>
        <div className="form-grid">
          <label className="field">
            <span>New GEDCOM</span>
            <input accept=".ged,.gedcom,text/plain" disabled={requestInProgress} ref={currentFileInputRef} type="file" onChange={(event) => void readCurrentFile(event.target.files?.[0])} />
          </label>
          <label className="field">
            <span>Previous GEDCOM for diff</span>
            <input accept=".ged,.gedcom,text/plain" disabled={requestInProgress} ref={previousFileInputRef} type="file" onChange={(event) => void readPreviousFile(event.target.files?.[0])} />
          </label>
          <label className="field" style={{ gridColumn: "1 / -1" }}>
            <span>Source name</span>
            <input
              disabled={requestInProgress}
              value={sourceName}
              onChange={(event) => {
                setSourceName(event.target.value);
                setResult(undefined);
                setApplyArmed(false);
              }}
            />
          </label>
        </div>
        <div className="hero-actions">
          <button aria-busy={status === "loading" || status === "uploading"} className="button" disabled={requestInProgress || (!currentFile && currentContent.length === 0)} onClick={previewImport} type="button">
            {status === "uploading" ? "Uploading..." : status === "loading" ? "Parsing..." : "Preview import"}
          </button>
          <span aria-atomic="true" aria-live="polite" role="status">
            {uploadProgress ? (
              <Status>{uploadProgress.fileName}: {Math.round(uploadProgress.percentage)}% uploaded</Status>
            ) : currentFile ? (
              <Status>{formatFileSize(currentFile.size)} loaded</Status>
            ) : currentContent ? (
              <Status>{currentContent.length.toLocaleString()} characters loaded</Status>
            ) : (
              <Status tone="private">No file loaded</Status>
            )}
          </span>
        </div>
        {status === "error" ? <p aria-atomic="true" className="form-error" role="alert">{error}</p> : null}
      </div>

      <aside aria-busy={status === "applying"} className="app-card">
        <h2>Import result</h2>
        {result ? (
          <div className="evidence-list">
            <div className="evidence-item">
              <strong aria-label={`Preview ready: ${result.snapshot.sourceName}`} aria-live="polite" role="status">{result.snapshot.sourceName}</strong>
              <p className="muted">Checksum {result.snapshot.checksum}</p>
              <div className="grid-3">
                <MiniStat label="People" value={result.snapshot.summary.individuals} />
                <MiniStat label="Families" value={result.snapshot.summary.families} />
                <MiniStat label="Sources" value={result.snapshot.summary.sources} />
              </div>
            </div>
            <div className="evidence-item">
              <strong>Preserved raw data</strong>
              <p className="muted">
                {result.snapshot.summary.sourceReferences.toLocaleString()} source refs · {result.snapshot.summary.urls.toLocaleString()} URLs · {result.snapshot.summary.ancestryApids.toLocaleString()} Ancestry IDs · {result.snapshot.summary.notes.toLocaleString()} notes
              </p>
            </div>
            {result.applied ? null : applyArmed ? (
              <div className="hero-actions" style={{ marginTop: 0 }}>
                <button aria-busy={status === "applying"} className="button" disabled={status === "applying"} onClick={applyImport} type="button">
                  {status === "applying" ? "Applying..." : "Confirm apply - replaces matching records"}
                </button>
                <button className="button-secondary" disabled={status === "applying"} onClick={() => setApplyArmed(false)} type="button">
                  Cancel
                </button>
              </div>
            ) : (
              <button className="button" disabled={requestInProgress} onClick={() => setApplyArmed(true)} type="button">
                Apply import
              </button>
            )}
            {result.applied ? (
              <div className="evidence-item">
                <strong aria-atomic="true" aria-live="polite" role="status">Applied to workspace</strong>
                <p className="muted">
                  {result.applied.import.peopleImported.toLocaleString()} people · {result.applied.import.sourcesImported.toLocaleString()} sources · {result.applied.import.rawRecordCount.toLocaleString()} raw records
                </p>
                <p className="muted">Backup {result.applied.backup.id} saved to {result.applied.backup.storageKey}</p>
                <p className="muted">Private person pages are available now. Public profiles stay hidden until you curate privacy, living status, and publication.</p>
                <div className="hero-actions">
                  <Link className="button" href="/app/people">
                    Review people
                  </Link>
                  <Link className="button-secondary" href="/app/publishing">
                    Publication review
                  </Link>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="muted">Load a GEDCOM file to preview preserved records, dates, sources, media, notes, and re-import changes.</p>
        )}
      </aside>

      {result?.diff ? (
        <section className="app-card" style={{ gridColumn: "1 / -1" }}>
          <h2>Re-import diff</h2>
          <div className="metric-row">
            <MiniMetric label="Added" value={result.diff.added} />
            <MiniMetric label="Changed" value={result.diff.changed} />
            <MiniMetric label="Deleted" value={result.diff.deleted} />
            <MiniMetric label="Unchanged" value={result.diff.unchanged} />
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Xref</th>
                <th>Type</th>
              </tr>
            </thead>
            <tbody>
              {result.diff.records.slice(0, 12).map((record, index) => (
                <tr key={`${record.xref ?? "no-xref"}-${record.type}-${index}`}>
                  <td>
                    <Status tone={record.status === "changed" || record.status === "deleted" ? "warning" : "ok"}>{record.status}</Status>
                  </td>
                  <td>{record.xref ?? "no xref"}</td>
                  <td>{record.type}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.diff.omittedRecords ? <p className="muted">Showing the first {result.diff.records.length.toLocaleString()} diff records; {result.diff.omittedRecords.toLocaleString()} additional records are included in the totals above.</p> : null}
        </section>
      ) : null}

      {recentPreviews.length > 0 ? (
        <section className="app-card" style={{ gridColumn: "1 / -1" }}>
          <h2>Recent local previews</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Previewed</th>
                <th>People</th>
                <th>Families</th>
                <th>Raw records</th>
              </tr>
            </thead>
            <tbody>
              {recentPreviews.map((preview) => (
                <tr key={preview.id}>
                  <td>{preview.sourceName}</td>
                  <td>{new Date(preview.importedAt).toLocaleString()}</td>
                  <td>{preview.summary.individuals.toLocaleString()}</td>
                  <td>{preview.summary.families.toLocaleString()}</td>
                  <td>{preview.recordCount.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </div>
  );
}

function readLocalJson<T>(key: string): T | undefined {
  const value = window.localStorage.getItem(key);
  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

async function parseImportResponse(response: Response): Promise<ImportResponse> {
  const text = await response.text();

  try {
    return JSON.parse(text) as ImportResponse;
  } catch {
    throw new Error("The import service returned an unexpected response.");
  }
}

async function responseError(response: Response, fallback: string): Promise<string> {
  const text = await response.text();
  if (!text) {
    return fallback;
  }

  try {
    const body = JSON.parse(text) as { error?: unknown };
    return typeof body.error === "string" && body.error.trim() ? body.error : fallback;
  } catch {
    return text;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "GEDCOM request failed.";
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <strong>{value.toLocaleString()}</strong>
      <div className="muted">{label}</div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value.toLocaleString()}</strong>
    </div>
  );
}
