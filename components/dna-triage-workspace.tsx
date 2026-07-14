"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Icons } from "@/components/icons";
import type {
  DnaCaseOption,
  DnaHelpfulnessFilter,
  DnaSearchResult,
  DnaSideFilter,
  DnaSortKey,
  DnaStatusFilter,
  DnaTreeFilter,
  ScoredDnaMatch
} from "@/lib/dna-search";
import type { DnaConnectionHypothesis, DnaMatch, ResearchCase } from "@/lib/models";
import { Confidence, Metric, Status, TableScroll } from "./ui";

type DnaMatchesResponse = DnaSearchResult & { hypotheses?: DnaConnectionHypothesis[] };

type DnaAnalysisResponse = {
  helpfulnessScore: number;
  hypothesis: DnaConnectionHypothesis;
  match: ScoredDnaMatch;
};

type DnaImportResponse = {
  imported: number;
  skipped: Array<{ rowNumber: number; reason: string }>;
  matches: ScoredDnaMatch[];
  hypotheses: DnaConnectionHypothesis[];
};

type DnaUpdateResponse = {
  helpfulnessScore: number;
  hypothesis: DnaConnectionHypothesis;
  match: ScoredDnaMatch;
};

type CaseEvidenceResponse = {
  case: ResearchCase;
  evidence: ResearchCase["evidence"][number];
  match: ScoredDnaMatch;
  created: boolean;
};

type Props = {
  initialResult: DnaSearchResult;
  initialHypotheses?: DnaConnectionHypothesis[];
  initialCases: DnaCaseOption[];
};

type MatchEditForm = {
  side: DnaMatch["side"];
  treeStatus: DnaMatch["treeStatus"];
  triageStatus: DnaMatch["triageStatus"];
  predictedRelationship: string;
  ancestryUrl: string;
  notes: string;
};

type CaseLinkForm = {
  caseId: string;
  title: string;
  summary: string;
  confidence: string;
};

const defaultForm = {
  displayName: "M. Alder (fictional)",
  totalCm: "86",
  longestSegmentCm: "12.6",
  predictedRelationship: "invented estimate: likely 3C or 3C1R",
  side: "paternal",
  treeStatus: "partial",
  surnames: "Mercer, March, Rowan, Hartwell",
  places: "Northstar Cove, Lantern Bay",
  sharedMatches: "T. Pike (fictional)",
  notes: "A fictional descendant chart and shared-match grid connect M. Alder and T. Pike through Elowen Rowan, Maeve's unrecorded sister. The 86 cM value alone does not establish that path."
};

const pageSizeOptions = [10, 25, 50, 100];

export function DnaTriageWorkspace({ initialResult, initialHypotheses = [], initialCases }: Props) {
  const [result, setResult] = useState(initialResult);
  const [hypotheses, setHypotheses] = useState(() => indexHypotheses(initialHypotheses));
  const [selected, setSelected] = useState<ScoredDnaMatch | undefined>(initialResult.items[0]);
  const [form, setForm] = useState(defaultForm);
  const [editForm, setEditForm] = useState<MatchEditForm>(() => createEditForm(initialResult.items[0]));
  const [linkForm, setLinkForm] = useState<CaseLinkForm>(() => createCaseLinkForm(initialResult.items[0], initialCases[0]?.id ?? ""));
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<DnaStatusFilter>("all");
  const [sideFilter, setSideFilter] = useState<DnaSideFilter>("all");
  const [treeFilter, setTreeFilter] = useState<DnaTreeFilter>("all");
  const [helpfulnessFilter, setHelpfulnessFilter] = useState<DnaHelpfulnessFilter>("all");
  const [sort, setSort] = useState<DnaSortKey>("helpfulness");
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [fetchError, setFetchError] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const [importStatus, setImportStatus] = useState<"idle" | "loading" | "error" | "success">("idle");
  const [importMessage, setImportMessage] = useState("");
  const [editStatus, setEditStatus] = useState<"idle" | "saving" | "deleting" | "error" | "success">("idle");
  const [editMessage, setEditMessage] = useState("");
  const [linkStatus, setLinkStatus] = useState<"idle" | "saving" | "error" | "success">("idle");
  const [linkMessage, setLinkMessage] = useState("");

  const resultSummary = `Showing ${result.start.toLocaleString()}-${result.end.toLocaleString()} of ${result.total.toLocaleString()}`;
  const [announcedResultSummary, setAnnouncedResultSummary] = useState(resultSummary);
  const selectedMatchIdRef = useRef(initialResult.items[0]?.id ?? "");
  const hypothesis = selected ? hypotheses[selected.id] ?? createFallbackHypothesis(selected) : createFallbackHypothesis();

  useEffect(() => {
    const timeout = window.setTimeout(() => setAnnouncedResultSummary(resultSummary), 400);
    return () => window.clearTimeout(timeout);
  }, [resultSummary]);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQuery(query), 250);
    return () => window.clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadMatches() {
      try {
        const response = await fetch(
          buildDnaApiPath({
            query: debouncedQuery,
            status: statusFilter,
            side: sideFilter,
            treeStatus: treeFilter,
            helpfulness: helpfulnessFilter,
            sort,
            page,
            pageSize
          }),
          { signal: controller.signal }
        );

        if (!response.ok) {
          throw new Error("DNA match search failed");
        }

        const body = (await response.json()) as DnaMatchesResponse;
        setResult(body);
        setHypotheses((current) => ({ ...current, ...indexHypotheses(body.hypotheses ?? []) }));
        // Keep the current selection when it merely paged out of view; refresh
        // its data when the new page contains it; fall back to the first row
        // only when nothing is selected (initial load or post-delete).
        setSelected((current) => {
          const fresh = current ? body.items.find((item) => item.id === current.id) : undefined;
          return fresh ?? current ?? body.items[0];
        });
        setFetchError("");
      } catch (requestError) {
        if (!controller.signal.aborted) {
          setFetchError(requestError instanceof Error ? requestError.message : "DNA match search failed");
        }
      }
    }

    void loadMatches();
    return () => controller.abort();
  }, [debouncedQuery, statusFilter, sideFilter, treeFilter, helpfulnessFilter, sort, page, pageSize, refreshKey]);

  // Explicit row clicks reset the forms in selectMatch (and update the ref
  // first), so this only reacts to implicit selection changes coming from the
  // fetch reconciliation above.
  useEffect(() => {
    if (selectedMatchIdRef.current === (selected?.id ?? "")) {
      return;
    }
    selectedMatchIdRef.current = selected?.id ?? "";
    setEditForm(createEditForm(selected));
    setLinkForm((current) => createCaseLinkForm(selected, current.caseId || initialCases[0]?.id || ""));
    setEditStatus("idle");
    setEditMessage("");
    setLinkStatus("idle");
    setLinkMessage("");
  }, [selected, initialCases]);

  function resetPaging() {
    setPage(1);
  }

  function refreshMatches() {
    setRefreshKey((current) => current + 1);
  }

  function selectMatch(match: ScoredDnaMatch) {
    selectedMatchIdRef.current = match.id;
    setSelected(match);
    setEditForm(createEditForm(match));
    setLinkForm((current) => createCaseLinkForm(match, current.caseId || initialCases[0]?.id || ""));
    setEditStatus("idle");
    setEditMessage("");
    setLinkStatus("idle");
    setLinkMessage("");
  }

  function upsertHypotheses(incoming: DnaConnectionHypothesis[]) {
    if (incoming.length === 0) {
      return;
    }

    setHypotheses((current) => ({
      ...current,
      ...indexHypotheses(incoming)
    }));
  }

  async function analyzeMatch() {
    setStatus("loading");
    setError("");

    const match: DnaMatch = {
      id: `dna-${form.displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "match"}-${crypto.randomUUID().slice(0, 8)}`,
      displayName: form.displayName,
      totalCm: Number(form.totalCm),
      longestSegmentCm: form.longestSegmentCm ? Number(form.longestSegmentCm) : undefined,
      predictedRelationship: form.predictedRelationship,
      side: form.side as DnaMatch["side"],
      treeStatus: form.treeStatus as DnaMatch["treeStatus"],
      surnames: splitList(form.surnames),
      places: splitList(form.places),
      sharedMatches: splitList(form.sharedMatches),
      notes: form.notes,
      triageStatus: "needs_review"
    };

    try {
      const response = await fetch("/api/dna/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(match)
      });

      if (!response.ok) {
        setStatus("error");
        setError((await response.text().catch(() => "")) || "DNA analysis failed.");
        return;
      }

      const body = (await response.json()) as DnaAnalysisResponse;
      const analyzedMatch = body.match ?? { ...match, helpfulnessScore: body.helpfulnessScore };
      upsertHypotheses([body.hypothesis]);
      selectMatch(analyzedMatch);
      refreshMatches();
    } catch (caught) {
      setStatus("error");
      setError(toErrorMessage(caught, "DNA analysis failed."));
    } finally {
      setStatus((current) => (current === "loading" ? "idle" : current));
    }
  }

  async function importCsv() {
    if (!importFile) {
      setImportStatus("error");
      setImportMessage("Choose a CSV file first.");
      return;
    }

    setImportStatus("loading");
    setImportMessage("");

    const formData = new FormData();
    formData.set("file", importFile);

    try {
      const response = await fetch("/api/dna/import", {
        method: "POST",
        body: formData
      });
      const body = (await response.json().catch(() => null)) as (Partial<DnaImportResponse> & { error?: string }) | null;

      if (!response.ok || !body) {
        setImportStatus("error");
        setImportMessage(body?.error ?? "DNA CSV import failed.");
        return;
      }

      const importedMatches = body.matches ?? [];
      const skippedCount = body.skipped?.length ?? 0;

      upsertHypotheses(body.hypotheses ?? []);
      if (importedMatches[0]) {
        selectMatch(importedMatches[0]);
      }
      refreshMatches();
      setImportFile(null);
      if (importFileInputRef.current) {
        importFileInputRef.current.value = "";
      }
      setImportStatus("success");
      setImportMessage(`${body.imported ?? importedMatches.length} imported${skippedCount ? `, ${skippedCount} skipped` : ""}.`);
    } catch (caught) {
      setImportStatus("error");
      setImportMessage(toErrorMessage(caught, "DNA CSV import failed."));
    } finally {
      setImportStatus((current) => (current === "loading" ? "idle" : current));
    }
  }

  async function saveSelectedMatch() {
    if (!selected) {
      return;
    }

    const targetMatchId = selected.id;
    setEditStatus("saving");
    setEditMessage("");

    try {
      const response = await fetch(`/api/dna/${encodeURIComponent(targetMatchId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          side: editForm.side,
          treeStatus: editForm.treeStatus,
          triageStatus: editForm.triageStatus,
          predictedRelationship: editForm.predictedRelationship,
          ancestryUrl: editForm.ancestryUrl || undefined,
          notes: editForm.notes
        })
      });
      const body = (await response.json().catch(() => null)) as (Partial<DnaUpdateResponse> & { error?: string }) | null;

      if (!response.ok || !body?.match) {
        if (selectedMatchIdRef.current === targetMatchId) {
          setEditStatus("error");
          setEditMessage(body?.error ?? "Could not update match.");
        }
        return;
      }

      if (body.hypothesis) {
        upsertHypotheses([body.hypothesis]);
      }
      refreshMatches();
      if (selectedMatchIdRef.current === targetMatchId) {
        setSelected(body.match);
        setEditForm(createEditForm(body.match));
        setEditStatus("success");
        setEditMessage("Match updated.");
      }
    } catch (caught) {
      if (selectedMatchIdRef.current === targetMatchId) {
        setEditStatus("error");
        setEditMessage(toErrorMessage(caught, "Could not update match."));
      }
    } finally {
      if (selectedMatchIdRef.current === targetMatchId) {
        setEditStatus((current) => (current === "saving" ? "idle" : current));
      }
    }
  }

  async function deleteSelectedMatch() {
    if (!selected || !window.confirm(`Delete ${selected.displayName} from DNA matches?`)) {
      return;
    }

    const targetMatchId = selected.id;
    setEditStatus("deleting");
    setEditMessage("");

    try {
      const response = await fetch(`/api/dna/${encodeURIComponent(targetMatchId)}`, {
        method: "DELETE"
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        if (selectedMatchIdRef.current === targetMatchId) {
          setEditStatus("error");
          setEditMessage(body?.error ?? "Could not delete match.");
        }
        return;
      }

      refreshMatches();
      if (selectedMatchIdRef.current === targetMatchId) {
        const nextSelected = result.items.find((match) => match.id !== targetMatchId);
        selectedMatchIdRef.current = nextSelected?.id ?? "";
        setSelected(nextSelected);
        setEditForm(createEditForm(nextSelected));
        setLinkForm((current) => createCaseLinkForm(nextSelected, current.caseId || initialCases[0]?.id || ""));
        setEditStatus("success");
        setEditMessage("Match deleted.");
      }
    } catch (caught) {
      if (selectedMatchIdRef.current === targetMatchId) {
        setEditStatus("error");
        setEditMessage(toErrorMessage(caught, "Could not delete match."));
      }
    } finally {
      if (selectedMatchIdRef.current === targetMatchId) {
        setEditStatus((current) => (current === "deleting" ? "idle" : current));
      }
    }
  }

  async function linkSelectedMatchToCase() {
    if (!selected || !linkForm.caseId) {
      setLinkStatus("error");
      setLinkMessage("Choose a case before linking evidence.");
      return;
    }

    const targetMatchId = selected.id;
    setLinkStatus("saving");
    setLinkMessage("");

    try {
      const response = await fetch(`/api/cases/${encodeURIComponent(linkForm.caseId)}/evidence`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          linkedDnaMatchId: targetMatchId,
          title: linkForm.title,
          summary: linkForm.summary,
          confidence: Number(linkForm.confidence)
        })
      });
      const body = (await response.json().catch(() => null)) as (Partial<CaseEvidenceResponse> & { error?: string }) | null;

      if (!response.ok || !body?.case || !body.evidence) {
        if (selectedMatchIdRef.current === targetMatchId) {
          setLinkStatus("error");
          setLinkMessage(body?.error ?? "Could not link DNA evidence.");
        }
        return;
      }

      if (selectedMatchIdRef.current === targetMatchId) {
        setLinkForm({
          caseId: body.case.id,
          title: body.evidence.title,
          summary: body.evidence.summary,
          confidence: String(body.evidence.confidence)
        });
        setLinkStatus("success");
        setLinkMessage(body.created ? "DNA evidence added to case." : "Existing DNA evidence updated.");
      }
    } catch (caught) {
      if (selectedMatchIdRef.current === targetMatchId) {
        setLinkStatus("error");
        setLinkMessage(toErrorMessage(caught, "Could not link DNA evidence."));
      }
    } finally {
      if (selectedMatchIdRef.current === targetMatchId) {
        setLinkStatus((current) => (current === "saving" ? "idle" : current));
      }
    }
  }

  return (
    <div className="app-grid">
      <div className="app-card dna-workspace">
        <div className="metric-row dna-metrics">
          <Metric label="Matches" value={result.stats.total.toLocaleString()} detail="in workspace" />
          <Metric label="Current set" value={result.total.toLocaleString()} detail={`${result.start}-${result.end} shown`} />
          <Metric label="High priority" value={result.stats.highPriority.toLocaleString()} detail="queue first" />
          <Metric label="Needs review" value={result.stats.needsReview.toLocaleString()} detail="not triaged" />
        </div>

        <div className="people-search-card">
          <div className="people-search-header">
            <div>
              <h2>DNA match queue</h2>
              <p className="muted">Search names, surnames, places, notes, shared matches, and Ancestry links.</p>
            </div>
            <button
              className="button-secondary"
              onClick={() => {
                setQuery("");
                setStatusFilter("all");
                setSideFilter("all");
                setTreeFilter("all");
                setHelpfulnessFilter("all");
                setSort("helpfulness");
                setPageSize(25);
                setPage(1);
              }}
              type="button"
            >
              Reset
            </button>
          </div>

          <div className="dna-filter-grid">
            <label className="field people-search-field">
              <span>Search</span>
              <span className="input-with-icon">
                <Icons.Search size={16} aria-hidden />
                <input
                  aria-label="Search DNA matches"
                  placeholder="Alder, Rowan, Northstar Cove..."
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    resetPaging();
                  }}
                />
              </span>
            </label>
            <SelectField label="Status" value={statusFilter} onChange={(value) => { setStatusFilter(value as DnaStatusFilter); resetPaging(); }} options={["all", "high_priority", "needs_review", "triaged", "ignored"]} />
            <SelectField label="Side" value={sideFilter} onChange={(value) => { setSideFilter(value as DnaSideFilter); resetPaging(); }} options={["all", "maternal", "paternal", "both", "unknown"]} />
            <SelectField label="Tree" value={treeFilter} onChange={(value) => { setTreeFilter(value as DnaTreeFilter); resetPaging(); }} options={["all", "public", "partial", "private", "none", "unknown"]} />
            <SelectField label="Helpfulness" value={helpfulnessFilter} onChange={(value) => { setHelpfulnessFilter(value as DnaHelpfulnessFilter); resetPaging(); }} options={["all", "high", "medium", "low"]} />
            <SelectField label="Sort" value={sort} onChange={(value) => { setSort(value as DnaSortKey); resetPaging(); }} options={["helpfulness", "cm", "name"]} />
            <SelectField label="Rows" value={String(pageSize)} onChange={(value) => { setPageSize(Number(value)); setPage(1); }} options={pageSizeOptions.map(String)} />
          </div>
        </div>

        <div>
          <div className="table-heading-row">
            <div>
              <h2>Ranked matches</h2>
              <p aria-atomic="true" aria-live="polite" className="muted" role="status">
                {announcedResultSummary}
              </p>
              {fetchError ? <p className="muted">{fetchError}</p> : null}
            </div>
            <PaginationControls page={result.page} pageCount={result.pageCount} onPageChange={setPage} />
          </div>

          <TableScroll label="Ranked DNA matches">
            <table className="data-table dna-table">
            <thead>
              <tr>
                <th>Match</th>
                <th>Total cM</th>
                <th>Predicted</th>
                <th>Side</th>
                <th>Tree</th>
                <th>Helpfulness</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((match) => (
                <tr className={match.id === selected?.id ? "selected-row" : undefined} key={match.id}>
                  <td>
                    <button
                      aria-controls="dna-match-details"
                      aria-pressed={match.id === selected?.id}
                      className="table-link"
                      onClick={() => selectMatch(match)}
                      type="button"
                    >
                      {match.displayName}
                    </button>
                    <div className="muted">{match.surnames.slice(0, 3).join(", ") || match.places.slice(0, 2).join(", ") || "No tree details yet"}</div>
                  </td>
                  <td>{match.totalCm}</td>
                  <td>{match.predictedRelationship ?? "Unknown"}</td>
                  <td>{match.side}</td>
                  <td>{match.treeStatus}</td>
                  <td>{match.helpfulnessScore}</td>
                  <td>
                    <Status tone={statusTone(match.triageStatus)}>{formatOption(match.triageStatus)}</Status>
                  </td>
                </tr>
              ))}
            </tbody>
            </table>
          </TableScroll>

          {result.items.length === 0 ? <p className="muted empty-state">No DNA matches match these filters.</p> : null}

          <div className="table-footer-row">
            <p className="muted">
              Page {result.page.toLocaleString()} of {result.pageCount.toLocaleString()}
            </p>
            <PaginationControls page={result.page} pageCount={result.pageCount} onPageChange={setPage} />
          </div>
        </div>

        <section aria-busy={importStatus === "loading"} className="section">
          <h2>Import DNA matches</h2>
          <div className="form-grid">
            <label className="field">
              <span>CSV file</span>
              <input accept=".csv,text/csv" ref={importFileInputRef} type="file" onChange={(event) => setImportFile(event.target.files?.[0] ?? null)} />
            </label>
            <label className="field">
              <span>Expected columns</span>
              <input readOnly value="Match name, shared cM, side, tree, surnames, places, notes" />
            </label>
          </div>
          <div className="hero-actions">
            <button aria-busy={importStatus === "loading"} className="button" disabled={importStatus === "loading"} onClick={importCsv} type="button">
              {importStatus === "loading" ? "Importing..." : "Import CSV"}
            </button>
            {importStatus === "error" ? <Status tone="warning">Import failed</Status> : null}
            {importStatus === "success" ? <Status>Import complete</Status> : null}
          </div>
          {importMessage ? (
            <p aria-atomic="true" className={importStatus === "error" ? "form-error" : "muted"} role={importStatus === "error" ? "alert" : "status"}>
              {importMessage}
            </p>
          ) : null}
        </section>

        <section aria-busy={status === "loading"} className="section">
          <h2>Analyze a match</h2>
          <p className="fiction-disclosure" role="note"><strong>Built-in example only:</strong> these Hartwell–Mercer names, locations, relationship estimates, shared-match names, and DNA values are entirely fictional.</p>
          <div className="form-grid">
            <TextField label="Match name" value={form.displayName} onChange={(value) => setForm({ ...form, displayName: value })} />
            <TextField inputMode="decimal" label="Total cM" min={0} step={0.1} type="number" value={form.totalCm} onChange={(value) => setForm({ ...form, totalCm: value })} />
            <TextField inputMode="decimal" label="Longest segment cM" min={0} step={0.1} type="number" value={form.longestSegmentCm} onChange={(value) => setForm({ ...form, longestSegmentCm: value })} />
            <TextField label="Predicted relationship" value={form.predictedRelationship} onChange={(value) => setForm({ ...form, predictedRelationship: value })} />
            <SelectField label="Side" value={form.side} onChange={(value) => setForm({ ...form, side: value })} options={["maternal", "paternal", "both", "unknown"]} />
            <SelectField label="Tree status" value={form.treeStatus} onChange={(value) => setForm({ ...form, treeStatus: value })} options={["public", "partial", "private", "none", "unknown"]} />
            <TextField label="Surnames" value={form.surnames} onChange={(value) => setForm({ ...form, surnames: value })} />
            <TextField label="Places" value={form.places} onChange={(value) => setForm({ ...form, places: value })} />
            <TextField label="Shared matches" value={form.sharedMatches} onChange={(value) => setForm({ ...form, sharedMatches: value })} />
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>Notes</span>
              <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
            </label>
          </div>
          <div className="hero-actions">
            <button aria-busy={status === "loading"} className="button" disabled={status === "loading"} onClick={analyzeMatch} type="button">
              {status === "loading" ? "Analyzing..." : "Analyze match"}
            </button>
            {status === "error" ? <Status tone="warning">Analysis failed</Status> : selected ? <Status>Helpfulness {selected.helpfulnessScore}</Status> : null}
          </div>
          {error ? <p aria-atomic="true" className="form-error" role="alert">{error}</p> : null}
        </section>
      </div>

      <aside className="app-card" id="dna-match-details">
        <h2 aria-atomic="true" aria-live="polite">Match: {selected?.displayName ?? "No match selected"}</h2>
        {selected ? (
          <>
            <div className="hero-actions" style={{ marginTop: 0 }}>
              <span className="tag">{selected.totalCm} cM</span>
              <span className="tag">{selected.predictedRelationship ?? "unknown relationship"}</span>
              <span className="tag">{selected.side} side</span>
            </div>
            <div className="hypothesis-panel" style={{ marginTop: 18 }}>
              <h2>AI connection hypothesis</h2>
              <p>{hypothesis.explanation}</p>
              <Confidence value={hypothesis.confidence} />
              <h3>Candidate ancestors</h3>
              <ul>
                {hypothesis.candidateCommonAncestors.map((ancestor) => (
                  <li key={ancestor}>{ancestor}</li>
                ))}
              </ul>
              <h3>Evidence</h3>
              <ul>
                {hypothesis.evidence.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
              <h3>Uncertainty</h3>
              <ul>
                {hypothesis.uncertainty.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>

            <div aria-busy={linkStatus === "saving"} className="section dna-edit-panel">
              <h2>Link to case</h2>
              {initialCases.length > 0 ? (
                <>
                  <div className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
                    <SelectField
                      label="Case"
                      value={linkForm.caseId}
                      onChange={(value) => setLinkForm({ ...linkForm, caseId: value })}
                      options={initialCases.map((researchCase) => [researchCase.id, researchCase.title])}
                    />
                    <TextField label="Evidence title" value={linkForm.title} onChange={(value) => setLinkForm({ ...linkForm, title: value })} />
                    <label className="field">
                      <span>Evidence summary</span>
                      <textarea value={linkForm.summary} onChange={(event) => setLinkForm({ ...linkForm, summary: event.target.value })} />
                    </label>
                    <TextField inputMode="decimal" label="Confidence" max={1} min={0} step={0.05} type="number" value={linkForm.confidence} onChange={(value) => setLinkForm({ ...linkForm, confidence: value })} />
                  </div>
                  <div className="hero-actions">
                    <button aria-busy={linkStatus === "saving"} className="button" disabled={linkStatus === "saving"} onClick={linkSelectedMatchToCase} type="button">
                      <Icons.FileSearch size={16} aria-hidden />
                      {linkStatus === "saving" ? "Linking..." : "Add evidence"}
                    </button>
                    {linkStatus === "success" ? (
                      <Link className="button-secondary" href={`/app/cases/${linkForm.caseId}`}>
                        View case
                      </Link>
                    ) : null}
                    {linkStatus === "error" ? <Status tone="warning">Link failed</Status> : null}
                    {linkStatus === "success" ? <Status>Linked</Status> : null}
                  </div>
                  {linkMessage ? (
                    <p aria-atomic="true" className={linkStatus === "error" ? "form-error" : "muted"} role={linkStatus === "error" ? "alert" : "status"}>
                      {linkMessage}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="muted">Create a case first, then link DNA evidence here.</p>
              )}
            </div>

            <div aria-busy={editStatus === "saving" || editStatus === "deleting"} className="section dna-edit-panel">
              <h2>Triage selected match</h2>
              <div className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
                <SelectField label="Status" value={editForm.triageStatus} onChange={(value) => setEditForm({ ...editForm, triageStatus: value as DnaMatch["triageStatus"] })} options={["high_priority", "needs_review", "triaged", "ignored"]} />
                <SelectField label="Side" value={editForm.side} onChange={(value) => setEditForm({ ...editForm, side: value as DnaMatch["side"] })} options={["maternal", "paternal", "both", "unknown"]} />
                <SelectField label="Tree status" value={editForm.treeStatus} onChange={(value) => setEditForm({ ...editForm, treeStatus: value as DnaMatch["treeStatus"] })} options={["public", "partial", "private", "none", "unknown"]} />
                <TextField label="Predicted relationship" value={editForm.predictedRelationship} onChange={(value) => setEditForm({ ...editForm, predictedRelationship: value })} />
                <TextField label="Ancestry/profile URL" value={editForm.ancestryUrl} onChange={(value) => setEditForm({ ...editForm, ancestryUrl: value })} />
                <label className="field">
                  <span>Notes</span>
                  <textarea value={editForm.notes} onChange={(event) => setEditForm({ ...editForm, notes: event.target.value })} />
                </label>
              </div>
              <div className="hero-actions">
                <button aria-busy={editStatus === "saving"} className="button" disabled={editStatus === "saving" || editStatus === "deleting"} onClick={saveSelectedMatch} type="button">
                  <Icons.Save size={16} aria-hidden />
                  {editStatus === "saving" ? "Saving..." : "Save"}
                </button>
                <button aria-busy={editStatus === "deleting"} className="button-secondary danger-action" disabled={editStatus === "saving" || editStatus === "deleting"} onClick={deleteSelectedMatch} type="button">
                  <Icons.Trash2 size={16} aria-hidden />
                  {editStatus === "deleting" ? "Deleting..." : "Delete"}
                </button>
                {editStatus === "error" ? <Status tone="warning">Update failed</Status> : null}
                {editStatus === "success" ? <Status>Saved</Status> : null}
              </div>
              {editMessage ? (
                <p aria-atomic="true" className={editStatus === "error" ? "form-error" : "muted"} role={editStatus === "error" ? "alert" : "status"}>
                  {editMessage}
                </p>
              ) : null}
            </div>
          </>
        ) : (
          <p className="muted">Import or analyze a DNA match to begin triage.</p>
        )}
      </aside>
    </div>
  );
}

function PaginationControls({ page, pageCount, onPageChange }: { page: number; pageCount: number; onPageChange: (page: number) => void }) {
  return (
    <div className="pagination-controls" aria-label="DNA match pages">
      <button className="button-secondary icon-button" disabled={page <= 1} onClick={() => onPageChange(page - 1)} type="button" aria-label="Previous page">
        <Icons.ChevronLeft size={16} aria-hidden />
      </button>
      <span aria-current="page" className="tag">{page.toLocaleString()}</span>
      <button className="button-secondary icon-button" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)} type="button" aria-label="Next page">
        <Icons.ChevronRight size={16} aria-hidden />
      </button>
    </div>
  );
}

function buildDnaApiPath(input: {
  query: string;
  status: DnaStatusFilter;
  side: DnaSideFilter;
  treeStatus: DnaTreeFilter;
  helpfulness: DnaHelpfulnessFilter;
  sort: DnaSortKey;
  page: number;
  pageSize: number;
}): string {
  const params = new URLSearchParams({
    query: input.query,
    status: input.status,
    side: input.side,
    treeStatus: input.treeStatus,
    helpfulness: input.helpfulness,
    sort: input.sort,
    page: String(input.page),
    pageSize: String(input.pageSize)
  });
  return `/api/dna/matches?${params.toString()}`;
}

function indexHypotheses(values: DnaConnectionHypothesis[]): Record<string, DnaConnectionHypothesis> {
  return Object.fromEntries(values.map((hypothesis) => [hypothesis.matchId, hypothesis]));
}

function createEditForm(match?: ScoredDnaMatch): MatchEditForm {
  return {
    side: match?.side ?? "unknown",
    treeStatus: match?.treeStatus ?? "unknown",
    triageStatus: match?.triageStatus ?? "needs_review",
    predictedRelationship: match?.predictedRelationship ?? "",
    ancestryUrl: match?.ancestryUrl ?? "",
    notes: match?.notes ?? ""
  };
}

function createFallbackHypothesis(match?: ScoredDnaMatch): DnaConnectionHypothesis {
  const matchId = match?.id ?? "dna-empty";
  return {
    matchId,
    likelyBranch: "Unknown side; prioritize shared-match clustering",
    likelyGeneration: "unknown generation",
    geography: [],
    candidateCommonAncestors: ["No candidate ancestor yet"],
    confidence: 0.1,
    evidence: ["No DNA match selected yet"],
    uncertainty: ["Add or import DNA matches to generate stronger hypotheses"],
    explanation: "Import or analyze a DNA match to generate a connection hypothesis."
  };
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
  inputMode,
  min,
  max,
  step
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  inputMode?: "decimal";
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input inputMode={inputMode} max={max} min={min} step={step} type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: Array<string | [string, string]>; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => {
          const [optionValue, optionLabel] = Array.isArray(option) ? option : [option, formatOption(option)];
          return (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
          );
        })}
      </select>
    </label>
  );
}

function splitList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function statusTone(status: DnaMatch["triageStatus"]): "ok" | "warning" | "private" | "danger" {
  if (status === "high_priority") return "warning";
  if (status === "ignored") return "private";
  return "ok";
}

function formatOption(value: string): string {
  return value.replace(/_/g, " ");
}

function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function createCaseLinkForm(match: ScoredDnaMatch | undefined, caseId: string): CaseLinkForm {
  return {
    caseId,
    title: match ? `${match.displayName} DNA match` : "",
    summary: match ? createDnaEvidenceSummary(match) : "",
    confidence: match ? String(Math.max(0.25, Math.min(0.95, match.helpfulnessScore / 100)).toFixed(2)) : "0.5"
  };
}

function createDnaEvidenceSummary(match: ScoredDnaMatch): string {
  const parts = [
    `${match.totalCm} cM`,
    match.predictedRelationship,
    match.side !== "unknown" ? `${match.side} side` : undefined,
    match.treeStatus !== "unknown" ? `${match.treeStatus} tree` : undefined,
    match.surnames.length ? `surnames: ${match.surnames.slice(0, 5).join(", ")}` : undefined,
    match.places.length ? `places: ${match.places.slice(0, 5).join(", ")}` : undefined,
    `${match.helpfulnessScore}/100 helpfulness`
  ].filter(Boolean);

  return parts.join("; ");
}
