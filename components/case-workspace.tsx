"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icons } from "@/components/icons";
import {
  isDnaEvidence,
  type CaseEvidenceFilter,
  type CasePrivacyFilter,
  type CaseSearchResult,
  type CaseSortKey,
  type CaseStatusFilter,
  type EvidenceQueueItem
} from "@/lib/case-search";
import { Confidence, Metric, Status, TableScroll } from "./ui";

type Props = {
  initialResult: CaseSearchResult;
  initialEvidenceQueue: EvidenceQueueItem[];
  dnaEnabled?: boolean;
};

type CaseDraft = {
  title: string;
  question: string;
  focus: string;
  firstHypothesis: string;
  firstEvidence: string;
};

const initialDraft: CaseDraft = {
  title: "The Samuel Mercer / Samuel March identity",
  question: "Were Samuel Mercer and Samuel March the same person?",
  focus: "1907 passenger notice, 1909 signature, and Maeve's 1906 letter",
  firstHypothesis: "Samuel Mercer and Samuel March were the same person, with March used on the 1907 passenger list.",
  firstEvidence: "The passenger-list and marriage signatures share an unusual tall final stroke; Maeve's independent 1906 letter says Samuel practiced signing both surnames. Matching age and route alone are not enough."
};

const pageSizeOptions = [10, 25, 50, 100];

export function CaseWorkspace({ initialResult, initialEvidenceQueue, dnaEnabled = true }: Props) {
  const [draft, setDraft] = useState(initialDraft);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<CaseStatusFilter>("all");
  const [privacy, setPrivacy] = useState<CasePrivacyFilter>("all");
  const [evidence, setEvidence] = useState<CaseEvidenceFilter>("all");
  const [sort, setSort] = useState<CaseSortKey>("status");
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(initialResult);
  const [evidenceQueue, setEvidenceQueue] = useState(initialEvidenceQueue);
  const [searchError, setSearchError] = useState("");
  // Bumped after a successful case creation so both fetch effects reload.
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState("");
  const visibleEvidenceQueue = dnaEnabled
    ? evidenceQueue
    : evidenceQueue.filter((item) => !isDnaEvidence(item));
  const resultSummary = `Showing ${result.start.toLocaleString()}-${result.end.toLocaleString()} of ${result.total.toLocaleString()}`;
  const [announcedResultSummary, setAnnouncedResultSummary] = useState(resultSummary);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQuery(query), 250);
    return () => window.clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadCases() {
      try {
        const response = await fetch(buildCasesApiPath({ query: debouncedQuery, status: statusFilter, privacy, evidence, sort, page, pageSize }), {
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error("Case search failed");
        }

        setResult((await response.json()) as CaseSearchResult);
        setSearchError("");
      } catch (requestError) {
        if (!controller.signal.aborted) {
          setSearchError(requestError instanceof Error ? requestError.message : "Case search failed");
        }
      }
    }

    void loadCases();
    return () => controller.abort();
  }, [debouncedQuery, statusFilter, privacy, evidence, sort, page, pageSize, refreshNonce]);

  useEffect(() => {
    // The server rendered the initial queue; only refetch after a mutation.
    if (refreshNonce === 0) {
      return;
    }
    const controller = new AbortController();

    async function loadEvidenceQueue() {
      try {
        const response = await fetch("/api/cases?view=evidence-queue", { signal: controller.signal });
        if (!response.ok) {
          throw new Error("Evidence queue refresh failed");
        }
        setEvidenceQueue((await response.json()) as EvidenceQueueItem[]);
      } catch {
        // The queue keeps its previous contents; the case list error surface
        // already reports fetch problems.
      }
    }

    void loadEvidenceQueue();
    return () => controller.abort();
  }, [refreshNonce]);

  useEffect(() => {
    const timeout = window.setTimeout(() => setAnnouncedResultSummary(resultSummary), 400);
    return () => window.clearTimeout(timeout);
  }, [resultSummary]);

  async function createCase() {
    setStatus("loading");
    setError("");

    try {
      const response = await fetch("/api/cases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: draft.title,
          question: draft.question,
          focus: draft.focus,
          hypotheses: draft.firstHypothesis
            ? [
                {
                  statement: draft.firstHypothesis,
                  confidence: 0.45
                }
              ]
            : [],
          evidence: draft.firstEvidence
            ? [
                {
                  title: "Initial evidence note",
                  type: "Research note",
                  summary: draft.firstEvidence,
                  confidence: 0.5
                }
              ]
            : []
        })
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Case creation failed");
      }

      setPage(1);
      setRefreshNonce((current) => current + 1);
      setStatus("success");
    } catch (requestError) {
      setStatus("error");
      setError(requestError instanceof Error ? requestError.message : "Case creation failed");
    } finally {
      setStatus((current) => (current === "loading" ? "idle" : current));
    }
  }

  function resetPaging() {
    setPage(1);
  }

  function updateDraft(patch: Partial<CaseDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setStatus((current) => (current === "success" ? "idle" : current));
  }

  return (
    <div className="people-workspace">
      <div className="metric-row">
        <Metric label="Cases" value={result.stats.total.toLocaleString()} detail="in workspace" />
        <Metric label="Current set" value={result.total.toLocaleString()} detail={`${result.start}-${result.end} shown`} />
        <Metric
          label="Evidence"
          value={result.stats.evidenceItems.toLocaleString()}
          detail={dnaEnabled ? `${result.stats.dnaEvidence.toLocaleString()} DNA linked` : "case evidence items"}
        />
        <Metric label="Active" value={result.stats.active.toLocaleString()} detail={`${result.stats.planning.toLocaleString()} planning`} />
      </div>

      <div className="app-grid">
        <div className="app-card people-search-card">
          <div className="people-search-header">
            <div>
              <h2>Investigation cases</h2>
              <p className="muted">
                {dnaEnabled
                  ? "Filter by research question, status, privacy, evidence state, and DNA linkage."
                  : "Filter by research question, status, privacy, and documentary evidence state."}
              </p>
            </div>
            <button
              className="button-secondary"
              onClick={() => {
                setQuery("");
                setStatusFilter("all");
                setPrivacy("all");
                setEvidence("all");
                setSort("status");
                setPageSize(25);
                setPage(1);
              }}
              type="button"
            >
              Reset
            </button>
          </div>

          <div className="case-filter-grid">
            <label className="field people-search-field">
              <span>Search</span>
              <span className="input-with-icon">
                <Icons.Search size={16} aria-hidden />
                <input
                  aria-label="Search cases"
                  placeholder="Mercer, blue tin, Lantern Bay, unresolved..."
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    resetPaging();
                  }}
                />
              </span>
            </label>
            <SelectField
              label="Status"
              value={statusFilter}
              options={[
                ["all", "All"],
                ["active", "Active"],
                ["planning", "Planning"],
                ["paused", "Paused"],
                ["resolved", "Resolved"]
              ]}
              onChange={(value) => {
                setStatusFilter(value as CaseStatusFilter);
                resetPaging();
              }}
            />
            <SelectField
              label="Privacy"
              value={privacy}
              options={[
                ["all", "All"],
                ["public", "Public"],
                ["private", "Private"],
                ["sensitive", "Sensitive"]
              ]}
              onChange={(value) => {
                setPrivacy(value as CasePrivacyFilter);
                resetPaging();
              }}
            />
            <SelectField
              label="Evidence"
              value={evidence}
              options={[
                ["all", "All"],
                ...(dnaEnabled ? [["dna", "DNA linked"] as [string, string]] : []),
                ["no_evidence", "No evidence"],
                ["low_confidence", "Low confidence"]
              ]}
              onChange={(value) => {
                setEvidence(value as CaseEvidenceFilter);
                resetPaging();
              }}
            />
            <SelectField
              label="Sort"
              value={sort}
              options={[
                ["status", "Status"],
                ["title", "Title"],
                ["evidence", "Evidence"]
              ]}
              onChange={(value) => {
                setSort(value as CaseSortKey);
                resetPaging();
              }}
            />
            <SelectField
              label="Rows"
              value={String(pageSize)}
              options={pageSizeOptions.map((option) => [String(option), String(option)] as [string, string])}
              onChange={(value) => {
                setPageSize(Number(value));
                setPage(1);
              }}
            />
          </div>

          <div className="table-heading-row">
            <div>
              <h2>Case queue</h2>
              <p aria-atomic="true" aria-live="polite" className="muted" role="status">
                {announcedResultSummary}
              </p>
              {searchError ? <p className="muted">{searchError}</p> : null}
            </div>
            <PaginationControls page={result.page} pageCount={result.pageCount} onPageChange={setPage} />
          </div>

          <TableScroll label="Investigation case queue">
            <table className="data-table">
            <thead>
              <tr>
                <th>Case</th>
                <th>Question</th>
                <th>Status</th>
                <th>Evidence</th>
                {dnaEnabled ? <th>Tasks</th> : null}
              </tr>
            </thead>
            <tbody>
              {result.items.map((researchCase) => (
                <tr key={researchCase.id}>
                  <td>
                    <Link href={`/app/cases/${researchCase.id}`}>{researchCase.title}</Link>
                    <div className="muted">{researchCase.focus || researchCase.privacy}</div>
                  </td>
                  <td>{researchCase.question}</td>
                  <td>
                    <Status tone={researchCase.status === "planning" ? "warning" : researchCase.status === "paused" ? "private" : "ok"}>{researchCase.status}</Status>
                  </td>
                  <td>
                    {researchCase.evidenceCount}
                    {dnaEnabled && researchCase.dnaEvidenceCount ? <div className="muted">{researchCase.dnaEvidenceCount} DNA</div> : null}
                    {researchCase.weakestEvidenceConfidence !== undefined && researchCase.weakestEvidenceConfidence < 0.5 ? <div className="muted">low confidence</div> : null}
                  </td>
                  {dnaEnabled ? (
                    <td>
                      {researchCase.taskCount}
                      {researchCase.openTaskCount ? <div className="muted">{researchCase.openTaskCount} open</div> : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
            </table>
          </TableScroll>

          {result.items.length === 0 ? <p className="muted empty-state">No cases match these filters.</p> : null}

          <div className="table-footer-row">
            <p className="muted">
              Page {result.page.toLocaleString()} of {result.pageCount.toLocaleString()}
            </p>
            <PaginationControls page={result.page} pageCount={result.pageCount} onPageChange={setPage} />
          </div>
        </div>

        <aside aria-busy={status === "loading"} className="app-card">
          <h2>New case</h2>
          <p className="fiction-disclosure" role="note">
            <strong>Built-in example only:</strong> every Hartwell–Mercer name, date, place, record, and photograph
            {dnaEnabled ? ", plus every DNA clue," : ""} is fictional. Replace these values when working in your own private archive.
          </p>
          <div className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
            <Field label="Title" value={draft.title} onChange={(value) => updateDraft({ title: value })} />
            <TextArea label="Research question" value={draft.question} onChange={(value) => updateDraft({ question: value })} />
            <Field label="Focus" value={draft.focus} onChange={(value) => updateDraft({ focus: value })} />
            <TextArea label="First hypothesis" value={draft.firstHypothesis} onChange={(value) => updateDraft({ firstHypothesis: value })} />
            <TextArea label="First evidence note" value={draft.firstEvidence} onChange={(value) => updateDraft({ firstEvidence: value })} />
            <button aria-busy={status === "loading"} className="button" disabled={status === "loading"} onClick={createCase} type="button">
              {status === "loading" ? "Creating..." : "Create case"}
            </button>
            {status === "success" ? (
              <div aria-atomic="true" role="status">
                <Status>Case created</Status>
              </div>
            ) : null}
            {status === "error" ? (
              <div aria-atomic="true" role="alert">
                <Status tone="warning">Case creation failed</Status>
                {error ? <p className="muted">{error}</p> : null}
              </div>
            ) : null}
          </div>
        </aside>
      </div>

      <div className="app-card">
        <div className="table-heading-row">
          <div>
            <h2>Evidence confidence</h2>
            <p className="muted">
              {dnaEnabled
                ? "Top 50 evidence items, prioritizing DNA links and low-confidence notes."
                : "Top 50 documentary evidence items, prioritizing low-confidence notes."}
            </p>
          </div>
        </div>
        <div className="evidence-list">
          {visibleEvidenceQueue.map((item) => (
            <div className="evidence-item" key={`${item.caseId}-${item.id}`}>
              <div className="evidence-item-heading">
                <strong>{item.title}</strong>
                {dnaEnabled && item.linkedDnaMatchId ? <Status tone="warning">DNA linked</Status> : <Status>{item.type}</Status>}
              </div>
              <p className="muted">
                <Link href={`/app/cases/${item.caseId}`}>{item.caseTitle}</Link> · {item.summary}
              </p>
              <Confidence value={item.confidence} />
            </div>
          ))}
        </div>
        {visibleEvidenceQueue.length === 0 ? <p className="muted empty-state">No evidence has been linked yet.</p> : null}
      </div>
    </div>
  );
}

function PaginationControls({ page, pageCount, onPageChange }: { page: number; pageCount: number; onPageChange: (page: number) => void }) {
  return (
    <div className="pagination-controls" aria-label="Case pages">
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

function Field({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: Array<[string, string]>; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function buildCasesApiPath(input: {
  query: string;
  status: CaseStatusFilter;
  privacy: CasePrivacyFilter;
  evidence: CaseEvidenceFilter;
  sort: CaseSortKey;
  page: number;
  pageSize: number;
}): string {
  const params = new URLSearchParams({
    query: input.query,
    status: input.status,
    privacy: input.privacy,
    evidence: input.evidence,
    sort: input.sort,
    page: String(input.page),
    pageSize: String(input.pageSize)
  });
  return `/api/cases?${params.toString()}`;
}
