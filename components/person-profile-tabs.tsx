"use client";

import Link from "next/link";
import { useState, type KeyboardEvent } from "react";

import { EvidenceScan } from "@/components/evidence-scan";
import { Icons } from "@/components/icons";
import { Confidence, EmptyState, PersonMonogram, Status, TableScroll } from "@/components/ui";
import type { PersonProfileSource, PersonProfileView } from "@/lib/person-profile";

const tabs = [
  { id: "facts", label: "Facts" },
  { id: "sources", label: "Sources" },
  { id: "timeline", label: "Timeline" },
  { id: "notes", label: "Notes" },
  { id: "relationships", label: "Relationships" },
  { id: "ai-insights", label: "AI Insights" }
] as const;

export type PersonProfileTabId = (typeof tabs)[number]["id"];

export function personProfileTabAfterKey(
  currentTab: PersonProfileTabId,
  key: string
): PersonProfileTabId | undefined {
  const currentIndex = tabs.findIndex((tab) => tab.id === currentTab);
  if (key === "ArrowRight") return tabs[(currentIndex + 1) % tabs.length].id;
  if (key === "ArrowLeft") return tabs[(currentIndex - 1 + tabs.length) % tabs.length].id;
  if (key === "Home") return tabs[0].id;
  if (key === "End") return tabs[tabs.length - 1].id;
  return undefined;
}

export function PersonProfileTabs({
  personName,
  profile
}: {
  personName: string;
  profile: PersonProfileView;
}) {
  const [activeTab, setActiveTab] = useState<PersonProfileTabId>("facts");
  const counts: Record<PersonProfileTabId, number> = {
    facts: profile.facts.length,
    sources: profile.sourceTotal,
    timeline: profile.timeline.length,
    notes: profile.notes.length,
    relationships: profile.relationships.length,
    "ai-insights": profile.insights.length + profile.savedAnalyses.length
  };

  function selectTab(tabId: PersonProfileTabId, event?: KeyboardEvent<HTMLButtonElement>) {
    setActiveTab(tabId);
    if (!event) return;
    event.currentTarget.parentElement
      ?.querySelector<HTMLButtonElement>(`[data-profile-tab="${tabId}"]`)
      ?.focus();
  }

  function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, tabId: PersonProfileTabId) {
    const nextTab = personProfileTabAfterKey(tabId, event.key);
    if (!nextTab) return;
    event.preventDefault();
    selectTab(nextTab, event);
  }

  return (
    <section className="person-profile-workspace" aria-label={`${personName} profile details`}>
      <div className="tabs person-profile-tabs" role="tablist" aria-label="Person profile sections">
        {tabs.map((tab) => (
          <button
            aria-controls={`person-panel-${tab.id}`}
            aria-label={`${tab.label}, ${counts[tab.id]} item${counts[tab.id] === 1 ? "" : "s"}`}
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? "active" : undefined}
            data-profile-tab={tab.id}
            id={`person-tab-${tab.id}`}
            key={tab.id}
            onClick={() => selectTab(tab.id)}
            onKeyDown={(event) => handleTabKeyDown(event, tab.id)}
            role="tab"
            tabIndex={activeTab === tab.id ? 0 : -1}
            type="button"
          >
            {tab.label}
            <span className="tab-count" aria-hidden>{counts[tab.id]}</span>
          </button>
        ))}
      </div>

      <div
        aria-labelledby="person-tab-facts"
        className="person-tab-panel"
        hidden={activeTab !== "facts"}
        id="person-panel-facts"
        role="tabpanel"
        tabIndex={0}
      >
        <div className="table-panel">
          {profile.facts.length > 0 ? (
            <TableScroll label={`${personName} facts`}>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Fact</th>
                    <th>Date</th>
                    <th>Place</th>
                    <th>Source</th>
                    <th>Confidence</th>
                  </tr>
                </thead>
                <tbody>
                  {profile.facts.map((fact) => (
                    <tr key={fact.id}>
                      <td>
                        <strong>{fact.label}</strong>
                        {fact.value ? <div className="muted">{fact.value}</div> : null}
                      </td>
                      <td>{fact.date ?? "Unknown"}</td>
                      <td>{fact.place ?? "Unknown"}</td>
                      <td>{fact.source ?? "Needs source"}</td>
                      <td><Confidence value={fact.confidence} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          ) : (
            <EmptyState icon={<Icons.Users size={20} aria-hidden />} title="No dated facts imported for this person">
              Add a dated event to begin a timeline and evidence review.
            </EmptyState>
          )}
        </div>
      </div>

      <div
        aria-labelledby="person-tab-sources"
        className="person-tab-panel"
        hidden={activeTab !== "sources"}
        id="person-panel-sources"
        role="tabpanel"
        tabIndex={0}
      >
        <div className="person-source-grid">
          {profile.sources.map((source) => (
            <article className="person-source-card" key={source.id}>
              {source.media ? (
                <EvidenceScan compact media={source.media} />
              ) : (
                <div className="person-source-placeholder" aria-hidden>
                  <Icons.BookOpen size={30} />
                  <span>Catalogued citation</span>
                </div>
              )}
              <div className="person-source-card-body">
                <div className="evidence-item-heading">
                  <Status tone={source.origin === "fact-citation" ? "private" : "ok"}>
                    {sourceOriginLabel(source.origin)}
                  </Status>
                  {source.citationDate ? <span className="muted">{source.citationDate}</span> : null}
                </div>
                <h2>{source.title}</h2>
                <p className="muted">{source.sourceType}{source.repository ? ` · ${source.repository}` : ""}</p>
                {source.summary ? <p>{source.summary}</p> : null}
                <Confidence value={source.confidence} />
              </div>
            </article>
          ))}
        </div>
        {profile.sourceTotal > profile.sources.length ? (
          <p className="muted person-source-limit" role="status">
            Showing the first {profile.sources.length} of {profile.sourceTotal} linked sources. Open the Sources workspace to review the complete set.
          </p>
        ) : null}
        {profile.sources.length === 0 ? (
          <EmptyState icon={<Icons.FileSearch size={20} aria-hidden />} title="No sources linked yet">
            Add a citation to a fact or link a source record to this person.
          </EmptyState>
        ) : null}
      </div>

      <div
        aria-labelledby="person-tab-timeline"
        className="person-tab-panel"
        hidden={activeTab !== "timeline"}
        id="person-panel-timeline"
        role="tabpanel"
        tabIndex={0}
      >
        {profile.timeline.length > 0 ? (
          <div className="timeline person-profile-timeline">
            {profile.timeline.map((event) => (
              <article className="timeline-item" key={event.id}>
                <div className="timeline-item-heading">
                  <div>
                    <strong>{event.date}</strong>
                    <h2>{event.label}</h2>
                  </div>
                  <Confidence value={event.confidence} />
                </div>
                <p>{event.place}</p>
                {event.detail ? <p>{event.detail}</p> : null}
                {event.source ? <p className="muted">Source: {event.source}</p> : null}
              </article>
            ))}
          </div>
        ) : (
          <EmptyState icon={<Icons.BookOpen size={20} aria-hidden />} title="No timeline events yet">
            Dated facts will appear here in chronological order.
          </EmptyState>
        )}
      </div>

      <div
        aria-labelledby="person-tab-notes"
        className="person-tab-panel"
        hidden={activeTab !== "notes"}
        id="person-panel-notes"
        role="tabpanel"
        tabIndex={0}
      >
        {profile.isFictionalDemo ? (
          <p className="fiction-disclosure" role="note">
            <strong>Fictional demo note:</strong> every person, place, date, document, and family story shown here was invented for Kin Resolve.
          </p>
        ) : null}
        <div className="person-note-grid">
          {profile.notes.map((note) => (
            <article className="app-card person-note-card" key={note.id}>
              <span className="card-kicker">Curated note</span>
              <h2>{note.title}</h2>
              <p>{note.body}</p>
              <p className="muted">Attached to {personName}&apos;s profile.</p>
            </article>
          ))}
        </div>
        {profile.notes.length === 0 ? (
          <EmptyState icon={<Icons.BookOpen size={20} aria-hidden />} title="No profile notes yet">
            Add research context, family stories, or unresolved questions here.
          </EmptyState>
        ) : null}
      </div>

      <div
        aria-labelledby="person-tab-relationships"
        className="person-tab-panel"
        hidden={activeTab !== "relationships"}
        id="person-panel-relationships"
        role="tabpanel"
        tabIndex={0}
      >
        <div className="person-relationship-grid">
          {profile.relationships.map((relationship) => (
            <Link
              className="person-relationship-card"
              href={`/app/people/${encodeURIComponent(relationship.id)}`}
              key={relationship.id}
            >
              <PersonMonogram name={relationship.displayName} variant="small" />
              <span>
                <span className="card-kicker">{relationship.relationship}</span>
                <strong>{relationship.displayName}</strong>
                <span className="muted">{relationship.lifeSummary}</span>
                {relationship.birthPlace ? <span className="muted">{relationship.birthPlace}</span> : null}
              </span>
              <Icons.ChevronRight size={18} aria-hidden />
            </Link>
          ))}
        </div>
        {profile.relationships.length === 0 ? (
          <EmptyState icon={<Icons.GitBranch size={20} aria-hidden />} title="No linked relatives yet">
            Add a family connection to build this person&apos;s relationship view.
          </EmptyState>
        ) : null}
      </div>

      <div
        aria-labelledby="person-tab-ai-insights"
        className="person-tab-panel"
        hidden={activeTab !== "ai-insights"}
        id="person-panel-ai-insights"
        role="tabpanel"
        tabIndex={0}
      >
        <div className="ai-insight-notice">
          <Icons.Brain size={22} aria-hidden />
          <div>
            <strong>Reviewable, read-only analysis</strong>
            <p>These profile checks use saved facts, citations, confidence, and case links. Nothing is written back to the tree.</p>
          </div>
        </div>

        {profile.savedAnalyses.length > 0 ? (
          <section className="saved-analysis-section" aria-labelledby="saved-analysis-title">
            <h2 id="saved-analysis-title">Saved AI analyses</h2>
            <div className="person-insight-grid">
              {profile.savedAnalyses.map((analysis) => (
                <article className="app-card saved-analysis-card" key={analysis.id}>
                  <span className="card-kicker">Saved analysis · {analysis.createdAt.slice(0, 10)}</span>
                  <h3>{analysis.question}</h3>
                  <p>{analysis.answer}</p>
                  {analysis.uncertainty.length > 0 ? (
                    <div className="saved-analysis-uncertainty">
                      <strong>Uncertainty retained</strong>
                      <ul>{analysis.uncertainty.map((item) => <li key={item}>{item}</li>)}</ul>
                    </div>
                  ) : null}
                  {analysis.provider || analysis.model ? (
                    <p className="muted">{[analysis.provider, analysis.model].filter(Boolean).join(" · ")}</p>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        ) : null}

        <section aria-labelledby="profile-review-title">
          <h2 id="profile-review-title">Profile review</h2>
          <div className="person-insight-grid">
            {profile.insights.map((insight) => (
              <article className="app-card person-insight-card" key={insight.id}>
                <div className="evidence-item-heading">
                  <span className="card-kicker">{insight.title}</span>
                  <Status tone={insight.tone === "attention" ? "warning" : insight.tone === "neutral" ? "private" : "ok"}>
                    {insight.tone === "attention" ? "Review" : insight.tone === "neutral" ? "Context" : "Covered"}
                  </Status>
                </div>
                <p><strong>{insight.summary}</strong></p>
                <p className="muted">{insight.detail}</p>
                {insight.confidence !== undefined ? <Confidence value={insight.confidence} /> : null}
              </article>
            ))}
          </div>
        </section>
      </div>
    </section>
  );
}

function sourceOriginLabel(origin: PersonProfileSource["origin"]): string {
  if (origin === "source-record") return "Source record";
  if (origin === "case-evidence") return "Case evidence";
  return "Fact citation";
}
