"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icons } from "@/components/icons";
import { type PeopleSearchResult } from "@/lib/people-search";
import { paginateItems } from "@/lib/pagination";
import {
  type CaseLinkOption,
  type PersonLinkOption,
  type SourceLinkFilter,
  type SourceListItem,
  type SourcePrivacyFilter,
  type SourceSearchResult,
  type SourceSortKey
} from "@/lib/source-search";
import { Confidence, Metric, Status, TableScroll } from "./ui";

type Props = {
  clientSideSearch?: boolean;
  initialResult: SourceSearchResult;
  initialPersonOptions: PersonLinkOption[];
  caseOptions: CaseLinkOption[];
  evidenceBinaryUploadsEnabled?: boolean;
  readOnly?: boolean;
};

const pageSizeOptions = [25, 50, 100, 250];

const initialForm = {
  title: "",
  sourceType: "Document",
  repository: "",
  citationDate: "",
  linkedPersonId: "",
  linkedCaseId: "",
  transcript: "",
  notes: "",
  privacy: "private",
  confidence: "0.70"
};

type SourceForm = typeof initialForm;

export function buildSourceSubmission(
  form: SourceForm,
  file: File | null,
  evidenceBinaryUploadsEnabled: boolean
): { body: BodyInit; headers?: Record<string, string> } {
  if (!evidenceBinaryUploadsEnabled) {
    return {
      body: JSON.stringify(form),
      headers: { "content-type": "application/json" }
    };
  }

  const formData = new FormData();
  for (const [key, value] of Object.entries(form)) {
    formData.set(key, value);
  }
  if (file) formData.set("file", file);
  return { body: formData };
}

export function SourceWorkspace({
  clientSideSearch = false,
  initialResult,
  initialPersonOptions,
  caseOptions,
  evidenceBinaryUploadsEnabled = true,
  readOnly = false
}: Props) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [privacy, setPrivacy] = useState<SourcePrivacyFilter>("all");
  const [sourceType, setSourceType] = useState("all");
  const [linkStatus, setLinkStatus] = useState<SourceLinkFilter>("all");
  const [sort, setSort] = useState<SourceSortKey>("created");
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(initialResult);
  const [refreshKey, setRefreshKey] = useState(0);
  const [form, setForm] = useState(initialForm);
  const [file, setFile] = useState<File | null>(null);
  const [personQuery, setPersonQuery] = useState("");
  const [debouncedPersonQuery, setDebouncedPersonQuery] = useState("");
  const [searchedPersonOptions, setSearchedPersonOptions] = useState<PersonLinkOption[]>([]);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [searchError, setSearchError] = useState("");
  const [lookupError, setLookupError] = useState("");
  const [isSearching, setIsSearching] = useState(false);

  const sourceTypeOptions = useMemo(() => {
    const values = sourceType !== "all" && !result.types.includes(sourceType) ? [sourceType, ...result.types] : result.types;
    return values.map((type) => [type, type] as [string, string]);
  }, [result.types, sourceType]);
  const activePersonOptions = debouncedPersonQuery.trim() ? searchedPersonOptions : initialPersonOptions;
  const visiblePersonOptions = useMemo(() => {
    if (!form.linkedPersonId || activePersonOptions.some((option) => option.id === form.linkedPersonId)) {
      return activePersonOptions;
    }

    return [{ id: form.linkedPersonId, displayName: form.linkedPersonId, detail: "Selected person" }, ...activePersonOptions];
  }, [activePersonOptions, form.linkedPersonId]);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQuery(query), 250);
    return () => window.clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedPersonQuery(personQuery), 250);
    return () => window.clearTimeout(timeout);
  }, [personQuery]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadSources() {
      setIsSearching(true);
      if (clientSideSearch) {
        setResult(searchInitialSources(initialResult, {
          query: debouncedQuery,
          privacy,
          sourceType,
          linkStatus,
          sort,
          page,
          pageSize
        }));
        setSearchError("");
        setIsSearching(false);
        return;
      }

      try {
        const response = await fetch(buildSourceApiPath({ query: debouncedQuery, privacy, sourceType, linkStatus, sort, page, pageSize }), {
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error("Source search failed");
        }

        setResult((await response.json()) as SourceSearchResult);
        setSearchError("");
      } catch (requestError) {
        if (!controller.signal.aborted) {
          setSearchError(requestError instanceof Error ? requestError.message : "Source search failed");
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsSearching(false);
        }
      }
    }

    void loadSources();
    return () => controller.abort();
  }, [clientSideSearch, debouncedQuery, privacy, sourceType, linkStatus, sort, page, pageSize, refreshKey, initialResult]);

  useEffect(() => {
    if (!debouncedPersonQuery.trim()) {
      return;
    }

    const controller = new AbortController();

    async function loadPeople() {
      if (clientSideSearch) {
        const terms = normalizeSearchTerms(debouncedPersonQuery);
        setSearchedPersonOptions(initialPersonOptions.filter((person) => {
          const searchable = normalizeSearchValue([person.id, person.displayName, person.detail].join(" "));
          return terms.every((term) => searchable.includes(term));
        }).slice(0, 25));
        setLookupError("");
        return;
      }

      try {
        const response = await fetch(`/api/people?query=${encodeURIComponent(debouncedPersonQuery)}&page=1&pageSize=25&sort=name`, {
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error("Person lookup failed");
        }

        const peopleResult = (await response.json()) as PeopleSearchResult;
        setSearchedPersonOptions(
          peopleResult.items.map((person) => ({
            id: person.id,
            displayName: person.displayName,
            detail: [person.birthDate, person.birthPlace].filter(Boolean).join(" · ") || person.slug
          }))
        );
        setLookupError("");
      } catch (requestError) {
        if (!controller.signal.aborted) {
          setLookupError(requestError instanceof Error ? requestError.message : "Person lookup failed");
        }
      }
    }

    void loadPeople();
    return () => controller.abort();
  }, [clientSideSearch, debouncedPersonQuery, initialPersonOptions]);

  function resetPaging() {
    setPage(1);
  }

  function updateForm(patch: Partial<typeof initialForm>) {
    setForm((current) => ({ ...current, ...patch }));
    setStatus((current) => (current === "saved" ? "idle" : current));
  }

  async function saveSource() {
    setStatus("saving");
    setError("");

    const submission = buildSourceSubmission(form, file, evidenceBinaryUploadsEnabled);

    try {
      const response = await fetch("/api/uploads", {
        method: "POST",
        ...submission
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(body || "Upload failed");
      }

      setForm(initialForm);
      setFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      setPage(1);
      setRefreshKey((current) => current + 1);
      setStatus("saved");
    } catch (requestError) {
      setStatus("error");
      setError(requestError instanceof Error ? requestError.message : "Upload failed");
    } finally {
      setStatus((current) => (current === "saving" ? "idle" : current));
    }
  }

  return (
    <div className="people-workspace">
      <div className="metric-row">
        <Metric label="Sources" value={result.stats.total.toLocaleString()} detail="in workspace" />
        <Metric label="Current set" value={result.total.toLocaleString()} detail={`${result.start}-${result.end} shown`} />
        <Metric label="Linked" value={result.stats.linked.toLocaleString()} detail={`${result.stats.unlinked.toLocaleString()} unlinked`} />
        <Metric label="Transcripts" value={result.stats.transcripts.toLocaleString()} detail={`${result.stats.protectedCount.toLocaleString()} protected`} />
      </div>

      <div className="app-grid" style={readOnly ? { gridTemplateColumns: "minmax(0, 1fr)" } : undefined}>
        <section aria-busy={isSearching} className="app-card people-search-card">
          <div className="people-search-header">
            <div>
              <h2>Source register</h2>
              <p className="muted">Search source titles, repositories, transcripts, notes, linked people, and linked cases.</p>
            </div>
            <button
              className="button-secondary"
              onClick={() => {
                setQuery("");
                setPrivacy("all");
                setSourceType("all");
                setLinkStatus("all");
                setSort("created");
                setPageSize(50);
                setPage(1);
              }}
              type="button"
            >
              Reset
            </button>
          </div>

          <div className="source-filter-grid">
            <label className="field people-search-field">
              <span>Search</span>
              <span className="input-with-icon">
                <Icons.Search size={16} aria-hidden />
                <input
                  aria-label="Search sources"
                  placeholder="Harbor ledger, Bellandi, Lantern Bay..."
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    resetPaging();
                  }}
                />
              </span>
            </label>
            <SelectField
              label="Type"
              value={sourceType}
              options={[["all", "All"], ...sourceTypeOptions]}
              onChange={(value) => {
                setSourceType(value);
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
                setPrivacy(value as SourcePrivacyFilter);
                resetPaging();
              }}
            />
            <SelectField
              label="Link"
              value={linkStatus}
              options={[
                ["all", "All"],
                ["linked", "Linked"],
                ["unlinked", "Unlinked"],
                ["person", "Person"],
                ["case", "Case"]
              ]}
              onChange={(value) => {
                setLinkStatus(value as SourceLinkFilter);
                resetPaging();
              }}
            />
            <SelectField
              label="Sort"
              value={sort}
              options={[
                ["created", "Newest"],
                ["title", "Title"],
                ["confidence", "Confidence"]
              ]}
              onChange={(value) => {
                setSort(value as SourceSortKey);
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
              <h2>Evidence sources</h2>
              <p aria-atomic="true" aria-live="polite" className="muted">
                Showing {result.start.toLocaleString()}-{result.end.toLocaleString()} of {result.total.toLocaleString()}
                {isSearching ? " · Updating..." : ""}
              </p>
              {searchError ? <p aria-atomic="true" className="form-error" role="alert">{searchError}</p> : null}
            </div>
            <PaginationControls page={result.page} pageCount={result.pageCount} onPageChange={setPage} />
          </div>

          <TableScroll label="Evidence sources">
            <table className="data-table source-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Type</th>
                <th>Linked to</th>
                <th>Privacy</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((source) => (
                <tr key={source.id}>
                  <td>
                    <strong>{source.title}</strong>
                    <div className="muted">
                      {source.fileName ?? "Transcript only"} · {source.repository || "No repository yet"}
                    </div>
                  </td>
                  <td>{source.sourceType}</td>
                  <td>
                    {source.linkedPersonId ? <div>{source.linkedPersonName ?? source.linkedPersonId}</div> : null}
                    {source.linkedCaseId ? <div>{source.linkedCaseTitle ?? source.linkedCaseId}</div> : null}
                    {!source.linkedPersonId && !source.linkedCaseId ? <span className="muted">Unlinked</span> : null}
                  </td>
                  <td>
                    <Status tone={source.privacy === "public" ? "ok" : source.privacy === "sensitive" ? "warning" : "private"}>{source.privacy}</Status>
                  </td>
                  <td>
                    <Confidence value={source.confidence} />
                  </td>
                </tr>
              ))}
            </tbody>
            </table>
          </TableScroll>

          {result.items.length === 0 ? <p className="muted empty-state">No sources match these filters.</p> : null}

          <div className="table-footer-row">
            <p className="muted">
              Page {result.page.toLocaleString()} of {result.pageCount.toLocaleString()}
            </p>
            <PaginationControls page={result.page} pageCount={result.pageCount} onPageChange={setPage} />
          </div>
        </section>

        {!readOnly ? (
          <aside aria-busy={status === "saving"} className="app-card">
            <h2>Add source</h2>
            {!evidenceBinaryUploadsEnabled ? (
              <p className="muted" role="status">
                Transcript-only in this private beta. Paste text or a transcript below; binary files stay on your device.
              </p>
            ) : null}
            <div className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
              <Field label="Title" value={form.title} onChange={(value) => updateForm({ title: value })} />
              <Field label="Type" value={form.sourceType} onChange={(value) => updateForm({ sourceType: value })} />
              <Field label="Repository" value={form.repository} onChange={(value) => updateForm({ repository: value })} />
              <Field label="Citation date" value={form.citationDate} onChange={(value) => updateForm({ citationDate: value })} />
              <Field label="Find linked person" value={personQuery} onChange={setPersonQuery} />
              {lookupError ? <p aria-atomic="true" className="form-error" role="alert">{lookupError}</p> : null}
              <SelectField label="Linked person" value={form.linkedPersonId} onChange={(value) => updateForm({ linkedPersonId: value })} options={[["", "Unlinked"], ...visiblePersonOptions.map((person) => [person.id, `${person.displayName} - ${person.detail}`] as [string, string])]} />
              <SelectField label="Linked case" value={form.linkedCaseId} onChange={(value) => updateForm({ linkedCaseId: value })} options={[["", "Unlinked"], ...caseOptions.map((researchCase) => [researchCase.id, researchCase.title] as [string, string])]} />
              <SelectField
                label="Privacy"
                value={form.privacy}
                onChange={(value) => updateForm({ privacy: value })}
                options={[
                  ["private", "Private"],
                  ["sensitive", "Sensitive"],
                  ["public", "Public"]
                ]}
              />
              <Field inputMode="decimal" label="Confidence 0-1" max={1} min={0} step={0.05} type="number" value={form.confidence} onChange={(value) => updateForm({ confidence: value })} />
              {evidenceBinaryUploadsEnabled ? (
                <label className="field">
                  <span>File</span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    onChange={(event) => {
                      setFile(event.target.files?.[0] ?? null);
                      setStatus((current) => (current === "saved" ? "idle" : current));
                    }}
                  />
                </label>
              ) : null}
              <TextArea label="Transcript" value={form.transcript} onChange={(value) => updateForm({ transcript: value })} />
              <TextArea label="Notes" value={form.notes} onChange={(value) => updateForm({ notes: value })} />
              <button aria-busy={status === "saving"} className="button" disabled={status === "saving"} onClick={saveSource} type="button">
                {status === "saving" ? "Saving..." : "Save source"}
              </button>
              {status === "saved" ? (
                <div aria-atomic="true" role="status">
                  <Status>Source saved</Status>
                </div>
              ) : null}
              {status === "error" || error ? (
                <div aria-atomic="true" role="alert">
                  {status === "error" ? <Status tone="warning">{sourceSaveFailureLabel(evidenceBinaryUploadsEnabled)}</Status> : null}
                  {error ? <p className={status === "error" ? "muted" : "form-error"}>{error}</p> : null}
                </div>
              ) : null}
            </div>
          </aside>
        ) : null}
      </div>

      <section className="app-card">
        <div className="table-heading-row">
          <div>
            <h2>Transcript previews</h2>
            <p className="muted">Bounded previews from the current source result set.</p>
          </div>
        </div>
        <div className="evidence-list">
          {result.items
            .filter((source) => source.transcriptPreview)
            .map((source) => (
              <div className="evidence-item" key={source.id}>
                <strong>{source.title}</strong>
                <p>{source.transcriptPreview}</p>
                {source.notesPreview ? <p className="muted">{source.notesPreview}</p> : null}
              </div>
            ))}
        </div>
        {result.items.every((source) => !source.transcriptPreview) ? <p className="muted empty-state">No transcripts on this page.</p> : null}
      </section>
    </div>
  );
}

export function sourceSaveFailureLabel(evidenceBinaryUploadsEnabled: boolean): string {
  return evidenceBinaryUploadsEnabled ? "Upload failed" : "Save failed";
}

function searchInitialSources(
  initialResult: SourceSearchResult,
  input: {
    query: string;
    privacy: SourcePrivacyFilter;
    sourceType: string;
    linkStatus: SourceLinkFilter;
    sort: SourceSortKey;
    page: number;
    pageSize: number;
  }
): SourceSearchResult {
  const terms = normalizeSearchTerms(input.query);
  const items = initialResult.items
    .filter((source) => {
      if (input.privacy !== "all" && source.privacy !== input.privacy) return false;
      if (input.sourceType !== "all" && source.sourceType !== input.sourceType) return false;
      const linked = Boolean(source.linkedPersonId || source.linkedCaseId);
      if (input.linkStatus === "linked" && !linked) return false;
      if (input.linkStatus === "unlinked" && linked) return false;
      if (input.linkStatus === "person" && !source.linkedPersonId) return false;
      if (input.linkStatus === "case" && !source.linkedCaseId) return false;
      if (terms.length === 0) return true;

      const searchable = normalizeSearchValue([
        source.id,
        source.title,
        source.sourceType,
        source.repository,
        source.fileName,
        source.citationDate,
        source.linkedPersonId,
        source.linkedPersonName,
        source.linkedCaseId,
        source.linkedCaseTitle,
        source.transcriptPreview,
        source.notesPreview,
        source.privacy
      ].filter(Boolean).join(" "));
      return terms.every((term) => searchable.includes(term));
    })
    .sort((left, right) => compareSourceListItems(left, right, input.sort));
  const page = paginateItems(items, { page: input.page, pageSize: input.pageSize });
  return { ...page, stats: initialResult.stats, types: initialResult.types };
}

function compareSourceListItems(left: SourceListItem, right: SourceListItem, sort: SourceSortKey): number {
  if (sort === "title") {
    return left.title.localeCompare(right.title, undefined, { sensitivity: "base" });
  }
  if (sort === "confidence") {
    return right.confidence - left.confidence || compareSourceCreatedAt(left, right);
  }
  return compareSourceCreatedAt(left, right);
}

function compareSourceCreatedAt(left: SourceListItem, right: SourceListItem): number {
  return compareOptionalText(right.createdAt, left.createdAt)
    || left.title.localeCompare(right.title, undefined, { sensitivity: "base" });
}

function compareOptionalText(left?: string, right?: string): number {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function normalizeSearchTerms(value: string): string[] {
  return normalizeSearchValue(value).split(/\s+/).filter(Boolean);
}

function normalizeSearchValue(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

function PaginationControls({ page, pageCount, onPageChange }: { page: number; pageCount: number; onPageChange: (page: number) => void }) {
  return (
    <div className="pagination-controls" aria-label="Source pages">
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

function Field({
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

function buildSourceApiPath(input: {
  query: string;
  privacy: SourcePrivacyFilter;
  sourceType: string;
  linkStatus: SourceLinkFilter;
  sort: SourceSortKey;
  page: number;
  pageSize: number;
}): string {
  const params = new URLSearchParams({
    query: input.query,
    privacy: input.privacy,
    sourceType: input.sourceType,
    linkStatus: input.linkStatus,
    sort: input.sort,
    page: String(input.page),
    pageSize: String(input.pageSize)
  });

  return `/api/sources?${params.toString()}`;
}
