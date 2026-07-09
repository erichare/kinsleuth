"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Icons } from "@/components/icons";
import { Metric, Status, TableScroll } from "@/components/ui";
import { type PeopleListItem, type PeopleLivingFilter, type PeoplePrivacyFilter, type PeoplePublicationFilter, type PeopleSearchResult, type PeopleSortKey } from "@/lib/people-search";

type Props = {
  initialResult: PeopleSearchResult;
};

const pageSizeOptions = [25, 50, 100, 250];

export function PeopleWorkspace({ initialResult }: Props) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [publication, setPublication] = useState<PeoplePublicationFilter>("all");
  const [privacy, setPrivacy] = useState<PeoplePrivacyFilter>("all");
  const [livingStatus, setLivingStatus] = useState<PeopleLivingFilter>("all");
  const [sort, setSort] = useState<PeopleSortKey>("name");
  const [pageSize, setPageSize] = useState(50);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(initialResult);
  const [error, setError] = useState("");
  const privateRecordCount = Math.max(result.stats.total - result.stats.published, 0);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQuery(query), 250);
    return () => window.clearTimeout(timeout);
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadPeople() {
      try {
        const response = await fetch(buildPeopleApiPath({ query: debouncedQuery, publication, privacy, livingStatus, sort, page, pageSize }), {
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error("People search failed");
        }

        setResult((await response.json()) as PeopleSearchResult);
        setError("");
      } catch (requestError) {
        if (!controller.signal.aborted) {
          setError(requestError instanceof Error ? requestError.message : "People search failed");
        }
      }
    }

    void loadPeople();
    return () => controller.abort();
  }, [debouncedQuery, publication, privacy, livingStatus, sort, page, pageSize]);

  function resetPaging() {
    setPage(1);
  }

  return (
    <div className="people-workspace">
      <div className="metric-row">
        <Metric label="People" value={result.stats.total.toLocaleString()} detail="in workspace" />
        <Metric label="Current set" value={result.total.toLocaleString()} detail={`${result.start}-${result.end} shown`} />
        <Metric label="Published" value={result.stats.published.toLocaleString()} detail="public profiles" />
        <Metric label="Protected" value={result.stats.protectedCount.toLocaleString()} detail={`${result.stats.living.toLocaleString()} living`} />
      </div>

      {privateRecordCount > 0 ? (
        <div className="workspace-notice">
          <Icons.Lock size={18} aria-hidden />
          <div>
            <strong>{privateRecordCount.toLocaleString()} people are private or unpublished</strong>
            <p className="muted">Imported people get private workspace pages immediately. Public profiles only appear after curation marks them public, deceased, and published.</p>
          </div>
          <Link className="button-secondary" href="/app/publishing">
            Publication review
          </Link>
        </div>
      ) : null}

      <div className="app-card people-search-card">
        <div className="people-search-header">
          <div>
            <h2>Find people</h2>
            <p className="muted">Search names, places, dates, notes, facts, and GEDCOM identifiers.</p>
          </div>
          <button
            className="button-secondary"
            onClick={() => {
              setQuery("");
              setPublication("all");
              setPrivacy("all");
              setLivingStatus("all");
              setSort("name");
              setPageSize(50);
              setPage(1);
            }}
            type="button"
          >
            Reset
          </button>
        </div>

        <div className="people-filter-grid">
          <label className="field people-search-field">
            <span>Search</span>
            <span className="input-with-icon">
              <Icons.Search size={16} aria-hidden />
              <input
                aria-label="Search people"
                placeholder="Riemer, Zajicek, Chicago, 1884..."
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  resetPaging();
                }}
              />
            </span>
          </label>
          <SelectField
            label="Publication"
            value={publication}
            options={[
              ["all", "All"],
              ["published", "Published"],
              ["unpublished", "Unpublished"]
            ]}
            onChange={(value) => {
              setPublication(value as PeoplePublicationFilter);
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
              setPrivacy(value as PeoplePrivacyFilter);
              resetPaging();
            }}
          />
          <SelectField
            label="Life status"
            value={livingStatus}
            options={[
              ["all", "All"],
              ["living", "Living"],
              ["deceased", "Deceased"],
              ["unknown", "Unknown"]
            ]}
            onChange={(value) => {
              setLivingStatus(value as PeopleLivingFilter);
              resetPaging();
            }}
          />
          <SelectField
            label="Sort"
            value={sort}
            options={[
              ["name", "Name"],
              ["birth", "Birth date"],
              ["death", "Death date"],
              ["facts", "Fact count"]
            ]}
            onChange={(value) => {
              setSort(value as PeopleSortKey);
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
      </div>

      <div className="app-card">
        <div className="table-heading-row">
          <div>
            <h2>Imported and curated people</h2>
            <p className="muted">
              Showing {result.start.toLocaleString()}-{result.end.toLocaleString()} of {result.total.toLocaleString()}
            </p>
            {error ? <p className="muted">{error}</p> : null}
          </div>
          <PaginationControls page={result.page} pageCount={result.pageCount} onPageChange={setPage} />
        </div>

        <TableScroll label="Imported and curated people">
          <table className="data-table people-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Birth</th>
              <th>Death</th>
              <th>Privacy</th>
              <th>Facts</th>
              <th>Profile</th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((person) => (
              <tr key={person.id}>
                <td>
                  <Link className="person-name-link" href={`/app/people/${encodeURIComponent(person.id)}`}>
                    <span>{person.displayName}</span>
                    <small>{person.surname || person.slug}</small>
                  </Link>
                </td>
                <td>{formatVital(person.birthDate, person.birthPlace)}</td>
                <td>{formatVital(person.deathDate, person.deathPlace)}</td>
                <td>
                  <div className="status-stack">
                    <Status tone={person.published ? "ok" : "private"}>{person.published ? "published" : "private"}</Status>
                    <Status tone={privacyTone(person.privacy)}>{person.privacy}</Status>
                    {person.livingStatus === "living" ? <Status tone="warning">living</Status> : null}
                  </div>
                </td>
                <td>{person.factCount}</td>
                <td>
                  <Link className="row-action-link" href={`/app/people/${encodeURIComponent(person.id)}`} aria-label={`Open ${person.displayName} profile`}>
                    Open
                    <Icons.ChevronRight size={14} aria-hidden />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
          </table>
        </TableScroll>

        {result.items.length === 0 ? <p className="muted empty-state">No people match these filters.</p> : null}

        <div className="table-footer-row">
          <p className="muted">
            Page {result.page.toLocaleString()} of {result.pageCount.toLocaleString()}
          </p>
          <PaginationControls page={result.page} pageCount={result.pageCount} onPageChange={setPage} />
        </div>
      </div>
    </div>
  );
}

function PaginationControls({ page, pageCount, onPageChange }: { page: number; pageCount: number; onPageChange: (page: number) => void }) {
  return (
    <div className="pagination-controls" aria-label="People pages">
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

function formatVital(date?: string, place?: string): string {
  return [date, place].filter(Boolean).join(" · ") || "Unknown";
}

function privacyTone(privacy: PeopleListItem["privacy"]): "ok" | "private" | "warning" | "danger" {
  if (privacy === "public") return "ok";
  if (privacy === "sensitive") return "danger";
  return "private";
}

function buildPeopleApiPath(input: {
  query: string;
  publication: PeoplePublicationFilter;
  privacy: PeoplePrivacyFilter;
  livingStatus: PeopleLivingFilter;
  sort: PeopleSortKey;
  page: number;
  pageSize: number;
}): string {
  const params = new URLSearchParams({
    query: input.query,
    publication: input.publication,
    privacy: input.privacy,
    livingStatus: input.livingStatus,
    sort: input.sort,
    page: String(input.page),
    pageSize: String(input.pageSize)
  });
  return `/api/people?${params.toString()}`;
}
