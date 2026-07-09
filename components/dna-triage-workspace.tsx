"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Icons } from "@/components/icons";
import { filterDnaMatches, paginateDnaMatches, type DnaHelpfulnessFilter, type DnaSideFilter, type DnaSortKey, type DnaStatusFilter, type DnaTreeFilter, type ScoredDnaMatch } from "@/lib/dna-search";
import type { DnaConnectionHypothesis, DnaMatch, ResearchCase } from "@/lib/models";
import { Confidence, Metric, Status, TableScroll } from "./ui";

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
  initialMatches: ScoredDnaMatch[];
  initialHypotheses?: DnaConnectionHypothesis[];
  initialCases: ResearchCase[];
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
  displayName: "J. Fletcher",
  totalCm: "238",
  longestSegmentCm: "23.4",
  predictedRelationship: "likely 2C1R",
  side: "maternal",
  treeStatus: "partial",
  surnames: "Fletcher, Zajicek, Riemer",
  places: "Chicago, Limerick, Cornwall",
  sharedMatches: "M. O'Donnell, A. Zajicek, S. Riemer",
  notes: "Partial tree reaches a Fletcher household in Chicago with Irish and Cornwall place overlap."
};

const pageSizeOptions = [10, 25, 50, 100];

export function DnaTriageWorkspace({ initialMatches, initialHypotheses = [], initialCases }: Props) {
  const [matches, setMatches] = useState(initialMatches);
  const [cases, setCases] = useState(initialCases);
  const [hypotheses, setHypotheses] = useState(() => indexHypotheses(initialHypotheses));
  const [selectedMatchId, setSelectedMatchId] = useState(initialMatches[0]?.id ?? "");
  const [form, setForm] = useState(defaultForm);
  const [editForm, setEditForm] = useState<MatchEditForm>(() => createEditForm(initialMatches[0]));
  const [linkForm, setLinkForm] = useState<CaseLinkForm>(() => createCaseLinkForm(initialMatches[0], initialCases[0]?.id ?? ""));
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<DnaStatusFilter>("all");
  const [sideFilter, setSideFilter] = useState<DnaSideFilter>("all");
  const [treeFilter, setTreeFilter] = useState<DnaTreeFilter>("all");
  const [helpfulnessFilter, setHelpfulnessFilter] = useState<DnaHelpfulnessFilter>("all");
  const [sort, setSort] = useState<DnaSortKey>("helpfulness");
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importStatus, setImportStatus] = useState<"idle" | "loading" | "error" | "success">("idle");
  const [importMessage, setImportMessage] = useState("");
  const [editStatus, setEditStatus] = useState<"idle" | "saving" | "deleting" | "error" | "success">("idle");
  const [editMessage, setEditMessage] = useState("");
  const [linkStatus, setLinkStatus] = useState<"idle" | "saving" | "error" | "success">("idle");
  const [linkMessage, setLinkMessage] = useState("");

  const filteredMatches = useMemo(
    () =>
      filterDnaMatches(matches, {
        query,
        status: statusFilter,
        side: sideFilter,
        treeStatus: treeFilter,
        helpfulness: helpfulnessFilter,
        sort
      }),
    [matches, query, statusFilter, sideFilter, treeFilter, helpfulnessFilter, sort]
  );
  const pagination = useMemo(() => paginateDnaMatches(filteredMatches, page, pageSize), [filteredMatches, page, pageSize]);
  const resultSummary = `Showing ${pagination.start.toLocaleString()}-${pagination.end.toLocaleString()} of ${pagination.total.toLocaleString()}`;
  const [announcedResultSummary, setAnnouncedResultSummary] = useState(resultSummary);
  const selectedMatch = useMemo(
    () => matches.find((match) => match.id === selectedMatchId) ?? pagination.items[0] ?? matches[0],
    [matches, pagination.items, selectedMatchId]
  );
  const hypothesis = selectedMatch ? hypotheses[selectedMatch.id] ?? createFallbackHypothesis(selectedMatch) : createFallbackHypothesis();
  const highPriorityCount = useMemo(() => matches.filter((match) => match.triageStatus === "high_priority").length, [matches]);
  const needsReviewCount = useMemo(() => matches.filter((match) => match.triageStatus === "needs_review").length, [matches]);

  useEffect(() => {
    const timeout = window.setTimeout(() => setAnnouncedResultSummary(resultSummary), 400);
    return () => window.clearTimeout(timeout);
  }, [resultSummary]);

  function resetPaging() {
    setPage(1);
  }

  function selectMatch(match: ScoredDnaMatch) {
    setSelectedMatchId(match.id);
    setEditForm(createEditForm(match));
    setLinkForm(createCaseLinkForm(match, linkForm.caseId || cases[0]?.id || ""));
    setEditStatus("idle");
    setEditMessage("");
    setLinkStatus("idle");
    setLinkMessage("");
  }

  async function analyzeMatch() {
    setStatus("loading");
    setError("");

    const match: DnaMatch = {
      id: `dna-${form.displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "match"}`,
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

    const response = await fetch("/api/dna/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(match)
    });

    if (!response.ok) {
      setStatus("error");
      setError((await response.text()) || "DNA analysis failed.");
      return;
    }

    const result = (await response.json()) as DnaAnalysisResponse;
    const analyzedMatch = result.match ?? { ...match, helpfulnessScore: result.helpfulnessScore };
    upsertMatches([analyzedMatch]);
    upsertHypotheses([result.hypothesis]);
    selectMatch(analyzedMatch);
    setStatus("idle");
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

    const response = await fetch("/api/dna/import", {
      method: "POST",
      body: formData
    });
    const body = (await response.json()) as Partial<DnaImportResponse> & { error?: string };

    if (!response.ok) {
      setImportStatus("error");
      setImportMessage(body.error ?? "DNA CSV import failed.");
      return;
    }

    const importedMatches = body.matches ?? [];
    const skippedCount = body.skipped?.length ?? 0;

    upsertMatches(importedMatches);
    upsertHypotheses(body.hypotheses ?? []);
    if (importedMatches[0]) {
      selectMatch(importedMatches[0]);
    }
    setImportStatus("success");
    setImportMessage(`${body.imported ?? importedMatches.length} imported${skippedCount ? `, ${skippedCount} skipped` : ""}.`);
  }

  async function saveSelectedMatch() {
    if (!selectedMatch) {
      return;
    }

    setEditStatus("saving");
    setEditMessage("");

    const response = await fetch(`/api/dna/${encodeURIComponent(selectedMatch.id)}`, {
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
    const body = (await response.json()) as Partial<DnaUpdateResponse> & { error?: string };

    if (!response.ok || !body.match) {
      setEditStatus("error");
      setEditMessage(body.error ?? "Could not update match.");
      return;
    }

    upsertMatches([body.match]);
    if (body.hypothesis) {
      upsertHypotheses([body.hypothesis]);
    }
    setEditForm(createEditForm(body.match));
    setEditStatus("success");
    setEditMessage("Match updated.");
  }

  async function deleteSelectedMatch() {
    if (!selectedMatch || !window.confirm(`Delete ${selectedMatch.displayName} from DNA matches?`)) {
      return;
    }

    setEditStatus("deleting");
    setEditMessage("");

    const response = await fetch(`/api/dna/${encodeURIComponent(selectedMatch.id)}`, {
      method: "DELETE"
    });

    if (!response.ok) {
      const body = (await response.json()) as { error?: string };
      setEditStatus("error");
      setEditMessage(body.error ?? "Could not delete match.");
      return;
    }

    const nextMatches = matches.filter((match) => match.id !== selectedMatch.id);
    const nextSelected = nextMatches[0];
    setMatches(nextMatches);
    setSelectedMatchId(nextSelected?.id ?? "");
    setEditForm(createEditForm(nextSelected));
    setLinkForm(createCaseLinkForm(nextSelected, linkForm.caseId || cases[0]?.id || ""));
    setEditStatus("success");
    setEditMessage("Match deleted.");
  }

  async function linkSelectedMatchToCase() {
    if (!selectedMatch || !linkForm.caseId) {
      setLinkStatus("error");
      setLinkMessage("Choose a case before linking evidence.");
      return;
    }

    setLinkStatus("saving");
    setLinkMessage("");

    const response = await fetch(`/api/cases/${encodeURIComponent(linkForm.caseId)}/evidence`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        linkedDnaMatchId: selectedMatch.id,
        title: linkForm.title,
        summary: linkForm.summary,
        confidence: Number(linkForm.confidence)
      })
    });
    const body = (await response.json()) as Partial<CaseEvidenceResponse> & { error?: string };

    if (!response.ok || !body.case || !body.evidence) {
      setLinkStatus("error");
      setLinkMessage(body.error ?? "Could not link DNA evidence.");
      return;
    }

    setCases((current) => current.map((researchCase) => (researchCase.id === body.case?.id ? body.case : researchCase)));
    setLinkForm({
      caseId: body.case.id,
      title: body.evidence.title,
      summary: body.evidence.summary,
      confidence: String(body.evidence.confidence)
    });
    setLinkStatus("success");
    setLinkMessage(body.created ? "DNA evidence added to case." : "Existing DNA evidence updated.");
  }

  function upsertMatches(incoming: ScoredDnaMatch[]) {
    if (incoming.length === 0) {
      return;
    }

    setMatches((current) => mergeScoredMatches(incoming, current));
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

  return (
    <div className="app-grid">
      <div className="app-card dna-workspace">
        <div className="metric-row dna-metrics">
          <Metric label="Matches" value={matches.length.toLocaleString()} detail="in workspace" />
          <Metric label="Current set" value={filteredMatches.length.toLocaleString()} detail={`${pagination.start}-${pagination.end} shown`} />
          <Metric label="High priority" value={highPriorityCount.toLocaleString()} detail="queue first" />
          <Metric label="Needs review" value={needsReviewCount.toLocaleString()} detail="not triaged" />
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
                  placeholder="Riemer, Chicago, shared match..."
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
            </div>
            <PaginationControls page={pagination.page} pageCount={pagination.pageCount} onPageChange={setPage} />
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
              {pagination.items.map((match) => (
                <tr className={match.id === selectedMatch?.id ? "selected-row" : undefined} key={match.id}>
                  <td>
                    <button
                      aria-controls="dna-match-details"
                      aria-pressed={match.id === selectedMatch?.id}
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

          {pagination.items.length === 0 ? <p className="muted empty-state">No DNA matches match these filters.</p> : null}

          <div className="table-footer-row">
            <p className="muted">
              Page {pagination.page.toLocaleString()} of {pagination.pageCount.toLocaleString()}
            </p>
            <PaginationControls page={pagination.page} pageCount={pagination.pageCount} onPageChange={setPage} />
          </div>
        </div>

        <section aria-busy={importStatus === "loading"} className="section">
          <h2>Import DNA matches</h2>
          <div className="form-grid">
            <label className="field">
              <span>CSV file</span>
              <input accept=".csv,text/csv" type="file" onChange={(event) => setImportFile(event.target.files?.[0] ?? null)} />
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
          <div className="form-grid">
            <TextField label="Match name" value={form.displayName} onChange={(value) => setForm({ ...form, displayName: value })} />
            <TextField label="Total cM" value={form.totalCm} onChange={(value) => setForm({ ...form, totalCm: value })} />
            <TextField label="Longest segment cM" value={form.longestSegmentCm} onChange={(value) => setForm({ ...form, longestSegmentCm: value })} />
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
            {status === "error" ? <Status tone="warning">Analysis failed</Status> : selectedMatch ? <Status>Helpfulness {selectedMatch.helpfulnessScore}</Status> : null}
          </div>
          {error ? <p aria-atomic="true" className="form-error" role="alert">{error}</p> : null}
        </section>
      </div>

      <aside className="app-card" id="dna-match-details">
        <h2 aria-atomic="true" aria-live="polite">Match: {selectedMatch?.displayName ?? "No match selected"}</h2>
        {selectedMatch ? (
          <>
            <div className="hero-actions" style={{ marginTop: 0 }}>
              <span className="tag">{selectedMatch.totalCm} cM</span>
              <span className="tag">{selectedMatch.predictedRelationship ?? "unknown relationship"}</span>
              <span className="tag">{selectedMatch.side} side</span>
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
              {cases.length > 0 ? (
                <>
                  <div className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
                    <SelectField
                      label="Case"
                      value={linkForm.caseId}
                      onChange={(value) => setLinkForm({ ...linkForm, caseId: value })}
                      options={cases.map((researchCase) => [researchCase.id, researchCase.title])}
                    />
                    <TextField label="Evidence title" value={linkForm.title} onChange={(value) => setLinkForm({ ...linkForm, title: value })} />
                    <label className="field">
                      <span>Evidence summary</span>
                      <textarea value={linkForm.summary} onChange={(event) => setLinkForm({ ...linkForm, summary: event.target.value })} />
                    </label>
                    <TextField label="Confidence" value={linkForm.confidence} onChange={(value) => setLinkForm({ ...linkForm, confidence: value })} />
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

function mergeScoredMatches(incoming: ScoredDnaMatch[], current: ScoredDnaMatch[]): ScoredDnaMatch[] {
  const incomingIds = new Set(incoming.map((match) => match.id));
  return [...incoming, ...current.filter((match) => !incomingIds.has(match.id))];
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

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
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
