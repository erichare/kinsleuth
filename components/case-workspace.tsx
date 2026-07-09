"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Icons } from "@/components/icons";
import {
  caseEvidenceQueue,
  searchCasesPage,
  type CaseEvidenceFilter,
  type CasePrivacyFilter,
  type CaseSortKey,
  type CaseStatusFilter
} from "@/lib/case-search";
import type { ResearchCase } from "@/lib/models";
import { Confidence, Metric, Status } from "./ui";

type CaseDraft = {
  title: string;
  question: string;
  focus: string;
  firstHypothesis: string;
  firstEvidence: string;
};

const initialDraft: CaseDraft = {
  title: "New DNA connection case",
  question: "How does this DNA match connect to the maternal Riemer line?",
  focus: "DNA + Chicago/Limerick evidence",
  firstHypothesis: "The match connects through the Riemer maternal branch before 1900.",
  firstEvidence: "The match shares 238 cM, has a partial Fletcher tree, and overlaps Chicago/Limerick/Cornwall places."
};

const pageSizeOptions = [10, 25, 50, 100];

export function CaseWorkspace({ initialCases }: { initialCases: ResearchCase[] }) {
  const [cases, setCases] = useState(initialCases);
  const [draft, setDraft] = useState(initialDraft);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<CaseStatusFilter>("all");
  const [privacy, setPrivacy] = useState<CasePrivacyFilter>("all");
  const [evidence, setEvidence] = useState<CaseEvidenceFilter>("all");
  const [sort, setSort] = useState<CaseSortKey>("status");
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const result = useMemo(
    () => searchCasesPage(cases, { query, status: statusFilter, privacy, evidence, sort }, { page, pageSize }),
    [cases, evidence, page, pageSize, privacy, query, sort, statusFilter]
  );
  const evidenceQueue = useMemo(() => caseEvidenceQueue(cases, 50), [cases]);

  async function createCase() {
    setStatus("loading");
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
                id: "hyp-draft",
                statement: draft.firstHypothesis,
                confidence: 0.45,
                status: "open"
              }
            ]
          : [],
        evidence: draft.firstEvidence
          ? [
              {
                id: "ev-draft",
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
      setStatus("error");
      return;
    }

    const created = (await response.json()) as ResearchCase;
    setCases((current) => [created, ...current]);
    setPage(1);
    setStatus("idle");
  }

  function resetPaging() {
    setPage(1);
  }

  return (
    <div className="people-workspace">
      <div className="metric-row">
        <Metric label="Cases" value={result.stats.total.toLocaleString()} detail="in workspace" />
        <Metric label="Current set" value={result.total.toLocaleString()} detail={`${result.start}-${result.end} shown`} />
        <Metric label="Evidence" value={result.stats.evidenceItems.toLocaleString()} detail={`${result.stats.dnaEvidence.toLocaleString()} DNA linked`} />
        <Metric label="Active" value={result.stats.active.toLocaleString()} detail={`${result.stats.planning.toLocaleString()} planning`} />
      </div>

      <div className="app-grid">
        <div className="app-card people-search-card">
          <div className="people-search-header">
            <div>
              <h2>Investigation cases</h2>
              <p className="muted">Filter by research question, status, privacy, evidence state, and DNA linkage.</p>
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
                  placeholder="DNA, Riemer, Chicago, unresolved..."
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
                ["dna", "DNA linked"],
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
              <p className="muted">
                Showing {result.start.toLocaleString()}-{result.end.toLocaleString()} of {result.total.toLocaleString()}
              </p>
            </div>
            <PaginationControls page={result.page} pageCount={result.pageCount} onPageChange={setPage} />
          </div>

          <table className="data-table">
            <thead>
              <tr>
                <th>Case</th>
                <th>Question</th>
                <th>Status</th>
                <th>Evidence</th>
                <th>Tasks</th>
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
                    {researchCase.dnaEvidenceCount ? <div className="muted">{researchCase.dnaEvidenceCount} DNA</div> : null}
                    {researchCase.weakestEvidenceConfidence !== undefined && researchCase.weakestEvidenceConfidence < 0.5 ? <div className="muted">low confidence</div> : null}
                  </td>
                  <td>
                    {researchCase.taskCount}
                    {researchCase.openTaskCount ? <div className="muted">{researchCase.openTaskCount} open</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {result.items.length === 0 ? <p className="muted empty-state">No cases match these filters.</p> : null}

          <div className="table-footer-row">
            <p className="muted">
              Page {result.page.toLocaleString()} of {result.pageCount.toLocaleString()}
            </p>
            <PaginationControls page={result.page} pageCount={result.pageCount} onPageChange={setPage} />
          </div>
        </div>

        <aside className="app-card">
          <h2>New case</h2>
          <div className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
            <Field label="Title" value={draft.title} onChange={(value) => setDraft({ ...draft, title: value })} />
            <TextArea label="Research question" value={draft.question} onChange={(value) => setDraft({ ...draft, question: value })} />
            <Field label="Focus" value={draft.focus} onChange={(value) => setDraft({ ...draft, focus: value })} />
            <TextArea label="First hypothesis" value={draft.firstHypothesis} onChange={(value) => setDraft({ ...draft, firstHypothesis: value })} />
            <TextArea label="First evidence note" value={draft.firstEvidence} onChange={(value) => setDraft({ ...draft, firstEvidence: value })} />
            <button className="button" disabled={status === "loading"} onClick={createCase} type="button">
              {status === "loading" ? "Creating..." : "Create case"}
            </button>
            {status === "error" ? <Status tone="warning">Case creation failed</Status> : null}
          </div>
        </aside>
      </div>

      <div className="app-card">
        <div className="table-heading-row">
          <div>
            <h2>Evidence confidence</h2>
            <p className="muted">Top 50 evidence items, prioritizing DNA links and low-confidence notes.</p>
          </div>
        </div>
        <div className="evidence-list">
          {evidenceQueue.map((item) => (
            <div className="evidence-item" key={`${item.caseId}-${item.id}`}>
              <div className="evidence-item-heading">
                <strong>{item.title}</strong>
                {item.linkedDnaMatchId ? <Status tone="warning">DNA linked</Status> : <Status>{item.type}</Status>}
              </div>
              <p className="muted">
                <Link href={`/app/cases/${item.caseId}`}>{item.caseTitle}</Link> · {item.summary}
              </p>
              <Confidence value={item.confidence} />
            </div>
          ))}
        </div>
        {evidenceQueue.length === 0 ? <p className="muted empty-state">No evidence has been linked yet.</p> : null}
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
      <span className="tag">{page.toLocaleString()}</span>
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
