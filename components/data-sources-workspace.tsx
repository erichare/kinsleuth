"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  DESKTOP_MEDIA_RIGHTS_ACKNOWLEDGEMENT_VERSION,
  MEDIA_OWNERSHIP_ATTESTATION_VERSION
} from "@/lib/integrations/types";
import type { PublicIntegrationConnection } from "@/lib/integrations/public-projections";

type Provider = "ancestry_export" | "family_tree_maker" | "rootsmagic" | "gedcom";

export type DataSourceConnection = PublicIntegrationConnection;

export type ImportPhase =
  | "idle"
  | "staging"
  | "queued"
  | "parsing"
  | "processing_delayed"
  | "cancelling"
  | "cancelled"
  | "review_ready"
  | "applied"
  | "rolled_back"
  | "failed";

type ImportState = {
  phase: ImportPhase;
  connectionId?: string;
  message?: string;
  runId?: string;
  artifactId?: string;
  report?: SyncRunReport | null;
  reviewOpen?: boolean;
  backupAvailable?: boolean;
};

type ReviewStatus =
  | "loading"
  | "ready"
  | "applying"
  | "applied"
  | "rolling_back"
  | "rolled_back"
  | "error";

export function canApplyReviewedChanges({
  status,
  hasBlockingResolutions,
  summaryLoaded
}: {
  status: ReviewStatus;
  hasBlockingResolutions: boolean;
  summaryLoaded: boolean;
}): boolean {
  return summaryLoaded
    && !hasBlockingResolutions
    && (status === "ready" || status === "error");
}

export function isDataSourceWorkActive(phase?: ImportPhase): boolean {
  return Boolean(phase && [
    "staging",
    "queued",
    "parsing",
    "processing_delayed",
    "cancelling"
  ].includes(phase));
}

export function supportsFieldLevelResolution(entityType: string): boolean {
  return entityType === "person" || entityType === "source";
}

type BrowserRun = {
  id: string;
  connectionId: string;
  status: string;
  artifactId?: string;
  errorMessage?: string;
  backupAvailable: boolean;
};

export type SyncRunReport = {
  counts: Record<string, number>;
  warnings: string[];
  sourceMetadata: Record<string, unknown>;
  limits?: Record<string, { total: number; returned: number; truncated: boolean }>;
};

type ReviewChange = {
  id: string;
  entityType: string;
  externalId?: string;
  classification: "remote_only" | "local_only" | "same" | "conflict" | "deletion";
  proposedAction: "accept_incoming" | "keep_local" | "no_op" | "review";
  resolutionPayload?: Record<string, unknown>;
};

type ChangeSummary = {
  total: number;
  filtered: number;
  unresolved: number;
  byClassification: Record<ReviewChange["classification"], number>;
};

type IntegrationMediaItem = {
  id: string;
  provider: "family_tree_maker" | "rootsmagic";
  fileName: string;
  mimeType: string;
  size: number;
  licenseClass: "third_party_restricted" | "user_owned";
  privacy: "private";
  publishable: false;
  aiEligible: false;
};

type DirectUploadInstruction =
  | {
      strategy: "presigned_post";
      method: "POST";
      url: string;
      fields: Record<string, string>;
      expiresAt: string;
    }
  | {
      strategy: "vercel_blob_client";
      pathname: string;
      clientToken: string;
      access: "private";
      contentType: string;
      multipart: true;
      expiresAt: string;
    };

const sourceCards: Array<{
  provider: Provider;
  title: string;
  eyebrow: string;
  description: string;
  accept: string;
  media: boolean;
  steps?: string[];
  helpUrl?: string;
  helpLabel?: string;
}> = [
  {
    provider: "ancestry_export",
    title: "Ancestry",
    eyebrow: "Import from Ancestry",
    description: "Download your tree from Ancestry, then bring the ZIP or GEDCOM here. Kin Resolve remembers the tree so the next export becomes a reviewable refresh.",
    accept: ".zip,.ged,.gedcom,application/zip,text/plain",
    media: false,
    steps: [
      "Open the tree menu on Ancestry and choose Tree Settings.",
      "Choose Export tree, then Download your GEDCOM ZIP.",
      "Import or Refresh from an Ancestry export by selecting that ZIP here."
    ],
    helpUrl: "https://ancestry.my.site.com/FrCa/articles/en_US/Support_Site/Uploading-and-Downloading-Trees",
    helpLabel: "Official Ancestry tree download instructions"
  },
  {
    provider: "family_tree_maker",
    title: "Family Tree Maker",
    eyebrow: "GEDCOM + media package",
    description: "Export one GEDCOM with its referenced media tree. Kin Resolve reports exactly which files arrived, which are missing, and which paths are ambiguous.",
    accept: ".zip,.ged,.gedcom,application/zip,text/plain",
    media: true,
    steps: [
      "Export a GEDCOM from Family Tree Maker.",
      "Place the GEDCOM and its referenced media folder in one ZIP.",
      "Choose that ZIP here; Kin Resolve does not read proprietary FTM databases."
    ],
    helpUrl: "https://support.mackiev.com/444769-Whats-Not-Synced-with-FamilySync-in-FTM-2024",
    helpLabel: "FamilySync transfer limitations"
  },
  {
    provider: "rootsmagic",
    title: "RootsMagic",
    eyebrow: "GEDCOM + media package",
    description: "Export a GEDCOM and its media into one ZIP. Later exports compare with the last snapshot without overwriting local research.",
    accept: ".zip,.ged,.gedcom,application/zip,text/plain",
    media: true,
    steps: [
      "Export a GEDCOM from RootsMagic.",
      "Place the GEDCOM and its referenced media folder in one ZIP.",
      "Choose that ZIP here; Kin Resolve does not read proprietary RootsMagic databases."
    ],
    helpUrl: "https://help.rootsmagic.com/RM11/ancestry-treeshare.html",
    helpLabel: "RootsMagic TreeShare help"
  },
  {
    provider: "gedcom",
    title: "GEDCOM",
    eyebrow: "Any genealogy app",
    description: "Import a standards-based GEDCOM from another tool and keep it as a named, refreshable data source.",
    accept: ".ged,.gedcom,text/plain",
    media: false
  }
];

export function DataSourcesWorkspace({
  initialConnections,
  exportRefreshEnabled,
  desktopMediaRetentionEnabled
}: {
  initialConnections: DataSourceConnection[];
  exportRefreshEnabled: boolean;
  desktopMediaRetentionEnabled: boolean;
}) {
  const [connections, setConnections] = useState(initialConnections);
  const [newSourceAuthority, setNewSourceAuthority] = useState(
    initialConnections.find((connection) => connection.status === "active")?.authority ?? "ancestry"
  );
  const [states, setStates] = useState<Record<string, ImportState>>({});
  const resumeChecked = useRef(new Set<string>());

  const pollRun = useCallback(async (connectionId: string, runId: string) => {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (attempt > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
      }
      try {
        const response = await fetch(`/api/integration-runs/${encodeURIComponent(runId)}`, {
          cache: "no-store"
        });
        const payload = await responsePayload(response);
        const run = payload.run as BrowserRun;
        const report = isSyncRunReport(payload.report) ? payload.report : null;
        if (["review_ready", "ready"].includes(run.status)) {
          setStates((current) => ({
            ...current,
            [connectionId]: {
              ...current[connectionId],
              phase: "review_ready",
              connectionId,
              message: "Changes are ready to review.",
              runId,
              artifactId: run.artifactId,
              report,
              reviewOpen: true,
              backupAvailable: run.backupAvailable
            }
          }));
          return;
        }
        if (run.status === "applied" || run.status === "rolled_back") {
          const phase = browserPhase(run.status);
          setStates((current) => ({
            ...current,
            [connectionId]: {
              ...current[connectionId],
              phase,
              connectionId,
              message: run.status === "applied"
                ? run.backupAvailable
                  ? "The reviewed refresh was applied. A restorable backup was created."
                  : "The reviewed refresh was applied. Its restore point expired under the backup-retention policy."
                : "This refresh was undone from its pre-apply backup.",
              runId,
              artifactId: run.artifactId,
              report,
              reviewOpen: false,
              backupAvailable: run.backupAvailable
            }
          }));
          return;
        }
        if (run.status === "cancelled" || run.status === "failed") {
          const phase = browserPhase(run.status);
          setStates((current) => ({
            ...current,
            [connectionId]: {
              ...current[connectionId],
              phase,
              connectionId,
              message: run.status === "cancelled"
                ? "Refresh cancelled."
                : run.errorMessage || "The refresh could not be prepared.",
              runId,
              reviewOpen: false
            }
          }));
          return;
        }
        setStates((current) => ({
          ...current,
          [connectionId]: {
            ...current[connectionId],
            phase: run.status === "cancel_requested" ? "cancelling" : run.status === "queued" ? "queued" : "parsing",
            connectionId,
            message: run.status === "cancel_requested"
              ? "Cancelling this refresh…"
              : run.status === "queued"
                ? "Refresh queued…"
                : "Comparing this export with the saved baseline…",
            runId,
            reviewOpen: false
          }
        }));
      } catch (error) {
        setStates((current) => ({
          ...current,
          [connectionId]: {
            ...current[connectionId],
            phase: "processing_delayed",
            connectionId,
            message: `Status checks paused while this refresh may still be processing: ${errorMessage(error)} Reload this page to resume safely.`,
            runId,
            reviewOpen: false
          }
        }));
        return;
      }
    }
    setStates((current) => ({
      ...current,
      [connectionId]: {
        ...current[connectionId],
        phase: "processing_delayed",
        connectionId,
        message: "This refresh is still processing. Reload this page to resume status checks; refresh and disconnect remain locked.",
        runId,
        reviewOpen: false
      }
    }));
  }, []);

  useEffect(() => {
    for (const connection of connections) {
      if (connection.status !== "active" || resumeChecked.current.has(connection.id)) continue;
      resumeChecked.current.add(connection.id);
      void (async () => {
        try {
          const latestPayload = await responsePayload(await fetch(
            `/api/integrations/${encodeURIComponent(connection.id)}/sync-runs`,
            { cache: "no-store" }
          ));
          const run = isBrowserRun(latestPayload.run) ? latestPayload.run : null;
          if (!run) return;
          if (["queued", "parsing", "applying", "cancel_requested"].includes(run.status)) {
            setStates((current) => ({
              ...current,
              [connection.id]: {
                phase: run.status === "cancel_requested" ? "cancelling" : run.status === "queued" ? "queued" : "parsing",
                connectionId: connection.id,
                message: run.status === "cancel_requested"
                  ? "Cancelling this refresh…"
                  : run.status === "queued"
                    ? "Refresh queued…"
                    : "Comparing this export with the saved baseline…",
                runId: run.id,
                artifactId: run.artifactId,
                reviewOpen: false,
                backupAvailable: run.backupAvailable
              }
            }));
            void pollRun(connection.id, run.id);
            return;
          }

          let report: SyncRunReport | null = null;
          if (["review_ready", "applied", "rolled_back"].includes(run.status)) {
            const detail = await responsePayload(await fetch(
              `/api/integration-runs/${encodeURIComponent(run.id)}`,
              { cache: "no-store" }
            ));
            report = isSyncRunReport(detail.report) ? detail.report : null;
          }
          const phase = browserPhase(run.status);
          setStates((current) => ({
            ...current,
            [connection.id]: {
              phase,
              connectionId: connection.id,
              message: browserRunMessage(run),
              runId: run.id,
              artifactId: run.artifactId,
              report,
              reviewOpen: false,
              backupAvailable: run.backupAvailable
            }
          }));
        } catch (error) {
          setStates((current) => ({
            ...current,
            [connection.id]: {
              phase: "processing_delayed",
              connectionId: connection.id,
              message: `The previous refresh status could not be restored safely: ${errorMessage(error)} Reload this page to try again.`,
              reviewOpen: false
            }
          }));
        }
      })();
    }
  }, [connections, pollRun]);

  async function importPackage(
    provider: Provider,
    file: File,
    connectionId?: string,
    mediaRightsAcknowledged = false,
    displayName?: string
  ) {
    if (!exportRefreshEnabled) return;
    const acknowledgeDesktopZip = mediaRightsAcknowledged && /\.zip$/i.test(file.name);
    const card = sourceCards.find((candidate) => candidate.provider === provider);
    if (!card) return;
    const normalizedDisplayName = displayName?.trim();
    if (!connectionId && !normalizedDisplayName) {
      setStates((current) => ({
        ...current,
        [transientStateKey(provider)]: {
          phase: "failed",
          message: `Name this ${card.title} ${provider === "ancestry_export" ? "tree" : "source"} before choosing a file.`,
          reviewOpen: false
        }
      }));
      return;
    }

    let stateKey = connectionId ?? transientStateKey(provider);
    setStates((current) => ({
      ...current,
      [stateKey]: { phase: "staging", connectionId, message: "Staging privately…", reviewOpen: false }
    }));
    try {
      let connection = connectionId
        ? connections.find((candidate) => (
            candidate.id === connectionId
            && candidate.provider === provider
            && candidate.status === "active"
          ))
        : undefined;
      if (connectionId && !connection) {
        throw new Error("This remembered data source is no longer available. Reload the page and try again.");
      }
      if (!connection) {
        const response = await fetch("/api/integrations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            provider,
            authority: newSourceAuthority,
            displayName: normalizedDisplayName
          })
        });
        const payload = await responsePayload(response);
        connection = payload.connection as DataSourceConnection;
        setConnections((current) => [...current, connection as DataSourceConnection]);
        const previousKey = stateKey;
        stateKey = connection.id;
        setStates((current) => {
          const next = {
            ...current,
            [stateKey]: { ...current[previousKey], connectionId: connection?.id }
          };
          delete next[previousKey];
          return next;
        });
      }

      const artifact = await uploadPrivateArtifact(connection.id, file, acknowledgeDesktopZip, (message) => {
        setStates((current) => ({
          ...current,
          [stateKey]: {
            ...current[stateKey],
            phase: "staging",
            connectionId: connection?.id,
            message,
            reviewOpen: false
          }
        }));
      });

      const runResponse = await fetch(`/api/integrations/${encodeURIComponent(connection.id)}/sync-runs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          artifactId: artifact.id,
          declaredAuthority: connection.authority,
          ...(acknowledgeDesktopZip ? {
            mediaRightsAcknowledgement: {
              accepted: true,
              version: DESKTOP_MEDIA_RIGHTS_ACKNOWLEDGEMENT_VERSION
            }
          } : {})
        })
      });
      const runPayload = await responsePayload(runResponse);
      const run = runPayload.run as { id: string; status: string };
      setStates((current) => ({
        ...current,
        [connection.id]: {
          phase: "queued",
          connectionId: connection.id,
          message: "Refresh queued…",
          runId: run.id,
          artifactId: artifact.id,
          reviewOpen: false
        }
      }));
      void pollRun(connection.id, run.id);
    } catch (error) {
      setStates((current) => ({
        ...current,
        [stateKey]: {
          ...current[stateKey],
          phase: "failed",
          message: errorMessage(error),
          reviewOpen: false
        }
      }));
    }
  }

  async function cancelRefresh(connectionId: string, runId: string) {
    try {
      const payload = await responsePayload(await fetch(`/api/integration-runs/${encodeURIComponent(runId)}`, {
        method: "DELETE"
      }));
      const run = payload.run as BrowserRun;
      if (run.status === "cancel_requested") {
        setStates((current) => ({
          ...current,
          [connectionId]: {
            ...current[connectionId],
            phase: "cancelling",
            connectionId,
            message: "Cancelling this refresh…",
            runId,
            reviewOpen: false
          }
        }));
        void pollRun(connectionId, runId);
        return;
      }
      setStates((current) => ({
        ...current,
        [connectionId]: {
          ...current[connectionId],
          phase: "cancelled",
          connectionId,
          message: "Refresh cancelled.",
          runId,
          reviewOpen: false
        }
      }));
    } catch (error) {
      setStates((current) => ({
        ...current,
        [connectionId]: {
          ...current[connectionId],
          phase: "processing_delayed",
          connectionId,
          message: `Cancellation could not be confirmed while this refresh may still be processing: ${errorMessage(error)} Reload this page to resume safely.`,
          runId,
          reviewOpen: false
        }
      }));
    }
  }

  async function disconnectConnection(connectionId: string) {
    if (!window.confirm("Disconnect this data source? Imported research will remain in your Kin Resolve archive.")) {
      return;
    }
    try {
      await responsePayload(await fetch(`/api/integrations/${encodeURIComponent(connectionId)}`, {
        method: "DELETE"
      }));
      setConnections((current) => current.filter((connection) => connection.id !== connectionId));
      setStates((current) => {
        const next = { ...current };
        delete next[connectionId];
        return next;
      });
    } catch (error) {
      setStates((current) => ({
        ...current,
        [connectionId]: {
          ...current[connectionId],
          phase: "failed",
          connectionId,
          message: errorMessage(error),
          reviewOpen: false
        }
      }));
    }
  }

  return (
    <div className="data-sources-workspace">
      {!exportRefreshEnabled ? (
        <section className="app-card data-source-notice" role="status">
          <strong>Data-source imports are paused for this deployment</strong>
          <span>Existing research remains available, but new imports and refreshes are disabled by the export-refresh rollout flag.</span>
        </section>
      ) : null}
      <section className="app-card data-source-authority-card" aria-labelledby="authority-heading">
        <div>
          <span className="eyebrow">One important choice</span>
          <h2 id="authority-heading">Where will edits for a new data source happen?</h2>
          <p className="muted">Kin Resolve is an inbound research and analysis layer. It will never silently push edits back to another tree.</p>
        </div>
        <fieldset>
          <legend>Choose where authoritative tree edits happen for the next data source</legend>
          {[
            ["ancestry", "Ancestry"],
            ["family_tree_maker", "Family Tree Maker"],
            ["rootsmagic", "RootsMagic"],
            ["another_genealogy_app", "Another genealogy app"]
          ].map(([value, label]) => (
            <label key={value}>
              <input
                checked={newSourceAuthority === value}
                name="authority"
                onChange={() => setNewSourceAuthority(value)}
                type="radio"
                value={value}
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>
      </section>

      <section className="data-source-grid" aria-label="Available data sources">
        {sourceCards.map((card) => (
          <SourceCard
            card={card}
            connectionStates={states}
            connections={connections.filter((connection) => connection.provider === card.provider && connection.status === "active")}
            desktopMediaRetentionEnabled={desktopMediaRetentionEnabled}
            enabled={exportRefreshEnabled}
            key={card.provider}
            newImportState={states[transientStateKey(card.provider)]}
            onCancel={cancelRefresh}
            onDisconnect={disconnectConnection}
            onImport={(file, connectionId, mediaRightsAcknowledged, displayName) => (
              importPackage(card.provider, file, connectionId, mediaRightsAcknowledged, displayName)
            )}
            onReopen={(connectionId) => setStates((current) => ({
              ...current,
              [connectionId]: { ...current[connectionId], reviewOpen: true }
            }))}
          />
        ))}
      </section>

      {Object.entries(states).map(([stateKey, state]) =>
        state.runId
        && state.reviewOpen !== false
        && ["review_ready", "applied", "rolled_back"].includes(state.phase) ? (
          <RunReview
            artifactId={state.artifactId}
            connectionId={state.connectionId}
            initialBackupAvailable={state.backupAvailable === true}
            key={state.runId}
            initialPhase={state.phase}
            onPhase={(phase, message, backupAvailable) => setStates((current) => ({
              ...current,
              [stateKey]: { ...current[stateKey], phase, message, backupAvailable }
            }))}
            report={state.report}
            runId={state.runId}
          />
        ) : null
      )}

      <PrivateMediaPanel
        enabled={desktopMediaRetentionEnabled}
        key={Object.values(states).map((state) => state.phase).join(":")}
        refreshToken={Object.values(states).map((state) => state.phase).join(":")}
      />

      <section className="app-card data-source-safety-card">
        <div>
          <span className="eyebrow">Review before apply</span>
          <h2>Your archive stays in control</h2>
        </div>
        <div className="data-source-safety-grid">
          <p><strong>Remote changes wait for approval.</strong> Additions, edits, conflicts, and deletions are grouped for review. A remote deletion keeps the local record by default.</p>
          <p><strong>Local research is protected.</strong> Publication settings, privacy choices, and locally curated fields are preserved through every refresh.</p>
          <p><strong>Every apply is reversible.</strong> Kin Resolve creates a restorable backup and offers an explicit rollback for the applied refresh.</p>
        </div>
      </section>
    </div>
  );
}

function RunReview({
  runId,
  connectionId,
  artifactId,
  report,
  initialPhase,
  initialBackupAvailable,
  onPhase
}: {
  runId: string;
  connectionId?: string;
  artifactId?: string;
  report?: SyncRunReport | null;
  initialPhase: ImportState["phase"];
  initialBackupAvailable: boolean;
  onPhase: (phase: ImportState["phase"], message: string, backupAvailable: boolean) => void;
}) {
  const [changes, setChanges] = useState<ReviewChange[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [query, setQuery] = useState("");
  const [classificationFilter, setClassificationFilter] = useState<"all" | ReviewChange["classification"]>("all");
  const [summary, setSummary] = useState<ChangeSummary | null>(null);
  const [decisions, setDecisions] = useState<Record<string, "accept_incoming" | "keep_local" | "no_op">>({});
  const [fieldDecisions, setFieldDecisions] = useState<Record<string, Record<string, "accept_incoming" | "keep_local">>>({});
  const [identityDecisions, setIdentityDecisions] = useState<Record<string, string>>({});
  const [knownClassifications, setKnownClassifications] = useState<Record<string, ReviewChange["classification"]>>({});
  const [knownAmbiguousChanges, setKnownAmbiguousChanges] = useState<Record<string, boolean>>({});
  const [acceptAllSafeIncoming, setAcceptAllSafeIncoming] = useState(false);
  const [backupAvailable, setBackupAvailable] = useState(initialBackupAvailable);
  const [status, setStatus] = useState<ReviewStatus>(
    initialPhase === "applied" ? "applied" : initialPhase === "rolled_back" ? "rolled_back" : "loading"
  );
  const [loadedReviewKey, setLoadedReviewKey] = useState<string>();
  const [error, setError] = useState("");
  const applyKey = useRef(`apply-${runId}-${cryptoId()}`);
  const rollbackKey = useRef(`rollback-${runId}-${cryptoId()}`);
  const reviewRequestKey = `${classificationFilter}\u0000${query}`;

  useEffect(() => {
    if (initialPhase === "applied" || initialPhase === "rolled_back") return;
    let cancelled = false;
    const timeout = window.setTimeout(() => void (async () => {
      try {
        setStatus("loading");
        const payload = await fetchChangePage(runId, {
          query,
          classification: classificationFilter === "all" ? undefined : classificationFilter
        });
        if (!cancelled) {
          setChanges(payload.items);
          setNextCursor(payload.nextCursor);
          setSummary(payload.summary);
          rememberLoadedChanges(payload.items);
          setLoadedReviewKey(reviewRequestKey);
          setStatus("ready");
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(errorMessage(loadError));
          setStatus("error");
        }
      }
    })(), 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [classificationFilter, initialPhase, query, reviewRequestKey, runId]);

  const visible = changes;
  const resolvedConflictCount = Object.entries(decisions).filter(
    ([changeId]) => knownClassifications[changeId] === "conflict"
  ).length;
  const unresolvedConflicts = summary
    ? Math.max(0, summary.unresolved - resolvedConflictCount)
    : changes.filter((change) => change.classification === "conflict" && !decisions[change.id]).length;
  const unresolvedIdentities = Object.entries(decisions).filter(([changeId, action]) => {
    if (!knownAmbiguousChanges[changeId]) return false;
    return resolutionAcceptsIncoming(action, fieldDecisions[changeId]) && !identityDecisions[changeId];
  }).length;
  const knownConflictCount = Object.values(knownClassifications).filter((value) => value === "conflict").length;
  const unresolvedOutsideLoaded = summary ? Math.max(0, summary.unresolved - knownConflictCount) : 0;
  const reviewedRemoteOnlyCount = Object.entries(decisions).filter(
    ([changeId]) => knownClassifications[changeId] === "remote_only"
  ).length;
  const unresolvedRemoteOnly = acceptAllSafeIncoming
    ? 0
    : Math.max(0, (summary?.byClassification.remote_only ?? 0) - reviewedRemoteOnlyCount);
  const hasBlockingResolutions = unresolvedConflicts > 0
    || unresolvedIdentities > 0
    || unresolvedRemoteOnly > 0;
  const applyEnabled = canApplyReviewedChanges({
    status,
    hasBlockingResolutions,
    summaryLoaded: summary !== null && loadedReviewKey === reviewRequestKey
  });

  function acceptSafeIncoming() {
    setAcceptAllSafeIncoming(true);
    setDecisions((current) => ({
      ...current,
      ...Object.fromEntries(
        changes
          .filter((change) => change.classification === "remote_only")
          .map((change) => [change.id, "accept_incoming"])
      )
    }));
  }

  function rememberLoadedChanges(items: ReviewChange[]) {
    setKnownClassifications((current) => ({
      ...current,
      ...Object.fromEntries(items.map((change) => [change.id, change.classification]))
    }));
    setKnownAmbiguousChanges((current) => ({
      ...current,
      ...Object.fromEntries(items.map((change) => [change.id, ambiguousLocalEntityIds(change).length > 0]))
    }));
  }

  async function loadMoreChanges() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError("");
    try {
      const payload = await fetchChangePage(runId, {
        cursor: nextCursor,
        query,
        classification: classificationFilter === "all" ? undefined : classificationFilter
      });
      setChanges((current) => {
        const existing = new Set(current.map((change) => change.id));
        return [...current, ...payload.items.filter((change) => !existing.has(change.id))];
      });
      setNextCursor(payload.nextCursor);
      setSummary(payload.summary);
      rememberLoadedChanges(payload.items);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoadingMore(false);
    }
  }

  function setRecordDecision(
    change: ReviewChange,
    value: "" | "accept_incoming" | "keep_local" | "no_op"
  ) {
    setDecisions((current) => {
      const next = { ...current };
      if (value) next[change.id] = value;
      else delete next[change.id];
      return next;
    });
  }

  function setIdentityDecision(changeId: string, localEntityId: string) {
    setIdentityDecisions((current) => {
      const next = { ...current };
      if (localEntityId) next[changeId] = localEntityId;
      else delete next[changeId];
      return next;
    });
  }

  function setFieldDecision(changeId: string, fieldName: string, value: "" | "accept_incoming" | "keep_local") {
    setFieldDecisions((current) => {
      const nextFields = { ...(current[changeId] ?? {}) };
      if (value) nextFields[fieldName] = value;
      else delete nextFields[fieldName];
      const next = { ...current };
      if (Object.keys(nextFields).length > 0) next[changeId] = nextFields;
      else delete next[changeId];
      return next;
    });
    if (value) {
      setDecisions((current) => ({ ...current, [changeId]: current[changeId] ?? "keep_local" }));
    }
  }

  async function applyChanges() {
    if (!applyEnabled) return;
    setStatus("applying");
    setError("");
    try {
      const payload = await responsePayload(await fetch(`/api/integration-runs/${encodeURIComponent(runId)}/apply`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": applyKey.current
        },
        body: JSON.stringify({
          acceptAllSafeIncoming,
          resolutions: Object.entries(decisions).map(([changeId, action]) => {
            const fields = fieldDecisions[changeId];
            return {
              changeId,
              action,
              ...(resolutionAcceptsIncoming(action, fields) && identityDecisions[changeId]
                ? { localEntityId: identityDecisions[changeId] }
                : {}),
              ...(fields ? { fields } : {})
            };
          })
        })
      }));
      const appliedRun = isBrowserRun(payload.run) ? payload.run : null;
      const hasBackup = appliedRun?.backupAvailable === true;
      setBackupAvailable(hasBackup);
      setStatus("applied");
      onPhase(
        "applied",
        hasBackup
          ? "The reviewed refresh was applied. A restorable backup was created."
          : "The reviewed refresh was applied. Its restore point is no longer available.",
        hasBackup
      );
    } catch (applyError) {
      setError(errorMessage(applyError));
      setStatus("error");
    }
  }

  async function rollback() {
    setStatus("rolling_back");
    setError("");
    try {
      await responsePayload(await fetch(`/api/integration-runs/${encodeURIComponent(runId)}/rollback`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": rollbackKey.current
        },
        body: "{}"
      }));
      setStatus("rolled_back");
      setBackupAvailable(false);
      onPhase("rolled_back", "This refresh was undone from its pre-apply backup.", false);
    } catch (rollbackError) {
      setError(errorMessage(rollbackError));
      setStatus("error");
    }
  }

  return (
    <section className="app-card sync-review" aria-labelledby={`review-${runId}`}>
      <div className="sync-review-heading">
        <div>
          <span className="eyebrow">Review before apply</span>
          <h2 id={`review-${runId}`}>Proposed refresh changes</h2>
          <p className="muted">Search, group, and resolve every incoming change. Nothing is written back to the source tree.</p>
        </div>
        <div className="sync-review-heading-actions">
          {connectionId && artifactId ? (
            <a
              className="button-secondary"
              href={`/api/integrations/${encodeURIComponent(connectionId)}/artifacts/${encodeURIComponent(artifactId)}/download`}
            >
              Download original export
            </a>
          ) : null}
          <button
            className="button-secondary"
            disabled={status !== "ready" || acceptAllSafeIncoming}
            onClick={acceptSafeIncoming}
            type="button"
          >
            {acceptAllSafeIncoming
              ? "All safe incoming changes approved"
              : "Approve all safe incoming changes (including unloaded pages)"}
          </button>
        </div>
      </div>

      {report ? <ImportReport report={report} /> : null}

      <div className="sync-review-filters">
        <label className="sync-review-search">
          <span>Search proposed changes</span>
          <input onChange={(event) => setQuery(event.target.value)} placeholder="Person, source, xref, or classification" type="search" value={query} />
        </label>
        <label className="sync-review-search">
          <span>Classification</span>
          <select
            onChange={(event) => setClassificationFilter(event.target.value as typeof classificationFilter)}
            value={classificationFilter}
          >
            <option value="all">All changes ({summary?.total ?? "…"})</option>
            {reviewGroups.map((group) => (
              <option key={group.classification} value={group.classification}>
                {group.label} ({summary?.byClassification[group.classification] ?? "…"})
              </option>
            ))}
          </select>
        </label>
        <small className="muted">
          Server search found {summary?.filtered.toLocaleString() ?? "…"}; {changes.length.toLocaleString()} loaded in this browser.
        </small>
      </div>

      <div className="sync-review-policy" aria-label="Change review policy">
        <span><strong>Remote-only changes</strong> can be accepted safely.</span>
        <span><strong>Local-only changes</strong> stay local by default.</span>
        <span><strong>Conflicts require a decision</strong> before apply.</span>
        <span><strong>Remote deletions keep local records</strong> by default.</span>
      </div>

      {status === "loading" ? <p className="muted">Loading proposed changes…</p> : null}
      {(["ready", "applying", "error"].includes(status) && changes.length > 0) ? (
        <div className="sync-change-groups">
          {reviewGroups.map((group) => {
            const items = visible.filter((change) => change.classification === group.classification);
            if (items.length === 0) return null;
            return (
              <section className="sync-change-group" key={group.classification}>
                <h3>{group.label} <span>{items.length}</span></h3>
                <div className="sync-change-list">
                  {items.map((change) => {
                    const selected = decisions[change.id] ?? (
                      change.proposedAction === "review"
                      || (change.classification === "remote_only" && !acceptAllSafeIncoming)
                        ? ""
                        : change.proposedAction
                    );
                    const identityCandidates = ambiguousLocalEntityIds(change);
                    return (
                      <div className="sync-change-row" key={change.id}>
                        <div>
                          <strong>{change.entityType}</strong>
                          <span>{change.externalId ?? "No external identifier"}</span>
                          {identityCandidates.length > 0 ? (
                            <label className="sync-identity-choice">
                              <span>Select matching local record</span>
                              <select
                                aria-label={`Select matching local record for ${change.externalId ?? change.id}`}
                                onChange={(event) => setIdentityDecision(change.id, event.target.value)}
                                value={identityDecisions[change.id] ?? ""}
                              >
                                <option value="">Choose a candidate…</option>
                                {identityCandidates.map((candidateId) => (
                                  <option key={candidateId} value={candidateId}>{candidateId}</option>
                                ))}
                              </select>
                              <small className="muted">Candidate IDs are shown only inside this authenticated archive review.</small>
                            </label>
                          ) : null}
                          <ChangeFieldComparison
                            editable={
                              change.classification === "conflict"
                              && supportsFieldLevelResolution(change.entityType)
                            }
                            fieldDecisions={fieldDecisions[change.id]}
                            onFieldDecision={(fieldName, value) => setFieldDecision(change.id, fieldName, value)}
                            resolutionPayload={change.resolutionPayload}
                          />
                        </div>
                        <label>
                          <span className="visually-hidden">Resolution</span>
                          <select
                            aria-label={`Resolution for ${change.externalId ?? change.id}`}
                            onChange={(event) => setRecordDecision(
                              change,
                              event.target.value as "" | "accept_incoming" | "keep_local" | "no_op"
                            )}
                            value={selected}
                          >
                            {change.classification === "conflict"
                            || (change.classification === "remote_only" && !acceptAllSafeIncoming)
                              ? <option value="">Choose…</option>
                              : null}
                            {change.classification !== "deletion" ? (
                              <option
                                disabled={identityCandidates.length > 0 && !identityDecisions[change.id]}
                                value="accept_incoming"
                              >
                                Accept incoming
                              </option>
                            ) : null}
                            <option value="keep_local">Keep local</option>
                            {change.classification === "same" ? <option value="no_op">No change</option> : null}
                          </select>
                        </label>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      ) : null}

      {nextCursor && ["ready", "error"].includes(status) ? (
        <div className="sync-review-pagination">
          <span className="muted">{changes.length.toLocaleString()} changes loaded</span>
          <button className="button-secondary" disabled={loadingMore} onClick={loadMoreChanges} type="button">
            {loadingMore ? "Loading…" : "Load more changes"}
          </button>
        </div>
      ) : null}

      {status === "ready" || status === "applying" || status === "error" ? (
        <div className="sync-review-actions">
          <span className="muted">
            {unresolvedConflicts > 0 ? `${unresolvedConflicts} conflict decision(s) required. ` : ""}
            {unresolvedIdentities > 0 ? `${unresolvedIdentities} identity selection(s) required. ` : ""}
            {unresolvedRemoteOnly > 0 ? `${unresolvedRemoteOnly} incoming addition decision(s) required. ` : ""}
            {unresolvedOutsideLoaded > 0 ? `${unresolvedOutsideLoaded} unresolved conflict(s) remain outside the loaded changes.` : ""}
            {!hasBlockingResolutions ? "All required decisions are complete." : ""}
          </span>
          <button className="button" disabled={!applyEnabled} onClick={applyChanges} type="button">
            {status === "applying" ? "Applying…" : "Apply reviewed changes"}
          </button>
        </div>
      ) : null}

      {status === "applied" || status === "rolling_back" ? (
        <div className="sync-review-actions">
          {backupAvailable ? (
            <>
              <span>The refresh is applied and can be restored from its backup.</span>
              <button className="button-secondary" disabled={status === "rolling_back"} onClick={rollback} type="button">
                {status === "rolling_back" ? "Restoring…" : "Undo this refresh"}
              </button>
            </>
          ) : (
            <span>This refresh is applied, but its restore point expired under the archive backup-retention policy.</span>
          )}
        </div>
      ) : null}
      {status === "rolled_back" ? <p role="status">This refresh has been undone.</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </section>
  );
}

const reportCountLabels: Array<[string, string]> = [
  ["people", "People"],
  ["families", "Families"],
  ["sources", "Sources"],
  ["facts", "Facts"],
  ["relationships", "Relationships"],
  ["citations", "Citations"],
  ["notes", "Notes"],
  ["mediaReferences", "Media references"],
  ["retainedMedia", "Retained media files"],
  ["missingMedia", "Missing media"],
  ["ambiguousMedia", "Ambiguous media"],
  ["unsupported", "Unsupported records and tags"],
  ["livingPeople", "Living people"],
  ["privatePeople", "Private people"],
  ["sensitivePeople", "Sensitive people"]
];

export function ImportReport({ report }: { report: SyncRunReport }) {
  const unsupportedRecords = metadataRecords(report.sourceMetadata, "unsupportedRecords");
  const missingMedia = metadataRecords(report.sourceMetadata, "missingMedia");
  const ambiguousMedia = metadataRecords(report.sourceMetadata, "ambiguousMedia");
  const unsupportedTags = metadataUnsupportedTags(report.sourceMetadata);
  const counts = reportCountLabels.filter(([key]) => Number.isFinite(report.counts[key]));
  const truncationNotices = Object.entries(report.limits ?? {})
    .filter(([, limit]) => limit.truncated)
    .map(([key, limit]) => `${humanizeFieldName(key)}: showing ${limit.returned.toLocaleString()} of ${limit.total.toLocaleString()}.`);

  return (
    <section className="sync-import-report" aria-label="Import report">
      <div className="sync-import-report-heading">
        <div>
          <span className="eyebrow">Import report</span>
          <h3>What arrived in this export</h3>
        </div>
        <dl className="sync-import-counts">
          {counts.map(([key, label]) => (
            <div key={key}>
              <dt>{label}</dt>
              <dd>{report.counts[key].toLocaleString()}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="sync-import-findings">
        <ReportFinding title="Warnings" empty="No parser warnings were reported.">
          {report.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}
        </ReportFinding>
        <ReportFinding title="Report limits" empty="Every reported finding is shown.">
          {truncationNotices.map((notice) => <li key={notice}>{notice}</li>)}
        </ReportFinding>
        <ReportFinding title="Unsupported data" empty="No unsupported records or nested tags were reported.">
          {[
            ...unsupportedRecords.map((record, index) => (
              <li key={`unsupported-${index}`}>
                <code>{metadataText(record.type, "Unknown record")}</code>
                {record.externalId ? ` · ${metadataText(record.externalId, "")}` : ""}
              </li>
            )),
            ...unsupportedTags.tags.map((entry) => (
              <li key={`unsupported-tag-${entry.tag}`}>
                Nested tag <code>{entry.tag}</code> · {entry.count.toLocaleString()} occurrence(s)
              </li>
            )),
            ...(unsupportedTags.truncated ? [
              <li key="unsupported-tags-truncated">
                Additional nested tag types were retained but are not listed in this bounded report.
              </li>
            ] : [])
          ]}
        </ReportFinding>
        <ReportFinding title="Missing media" empty="No referenced media files were missing.">
          {missingMedia.map((record, index) => (
            <li key={`missing-${index}`}>
              <code>{metadataPath(record)}</code>
            </li>
          ))}
        </ReportFinding>
        <ReportFinding title="Ambiguous media" empty="No media paths matched more than one file.">
          {ambiguousMedia.map((record, index) => {
            const archivePaths = Array.isArray(record.archivePaths)
              ? record.archivePaths.filter((value): value is string => typeof value === "string")
              : [];
            return (
              <li key={`ambiguous-${index}`}>
                <code>{metadataPath(record)}</code>
                {archivePaths.length > 0 ? (
                  <ul>
                    {archivePaths.map((path) => <li key={path}><code>{path}</code></li>)}
                  </ul>
                ) : null}
                {typeof record.archivePathCount === "number" && record.archivePathCount > archivePaths.length ? (
                  <span className="muted">
                    Showing {archivePaths.length.toLocaleString()} of {record.archivePathCount.toLocaleString()} candidate paths.
                  </span>
                ) : null}
              </li>
            );
          })}
        </ReportFinding>
      </div>
    </section>
  );
}

export function ChangeFieldComparison({
  resolutionPayload,
  editable = false,
  fieldDecisions = {},
  onFieldDecision
}: {
  resolutionPayload?: Record<string, unknown>;
  editable?: boolean;
  fieldDecisions?: Record<string, "accept_incoming" | "keep_local">;
  onFieldDecision?: (fieldName: string, value: "" | "accept_incoming" | "keep_local") => void;
}) {
  if (!resolutionPayload) return null;
  const sides = comparisonSides(resolutionPayload);
  if (!sides.some((side) => side.present)) return null;

  const fieldNames = Array.from(new Set(
    sides.flatMap((side) => isRecord(side.value) ? Object.keys(side.value) : [])
  )).sort((left, right) => left.localeCompare(right));
  const rows = fieldNames.length > 0 ? fieldNames : ["value"];

  return (
    <div className="sync-field-comparison">
      <table>
        <thead>
          <tr>
            <th scope="col">Field</th>
            {sides.map((side) => <th key={side.key} scope="col">{side.label}</th>)}
            {editable ? <th scope="col">Use</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.map((fieldName) => (
            <tr key={fieldName}>
              <th scope="row">{fieldName === "value" ? "Value" : humanizeFieldName(fieldName)}</th>
              {sides.map((side) => (
                <td key={side.key}>
                  {formatComparisonValue(comparisonFieldValue(side.value, fieldName, fieldNames.length > 0))}
                </td>
              ))}
              {editable ? (
                <td>
                  <select
                    aria-label={`Field resolution for ${humanizeFieldName(fieldName)}`}
                    onChange={(event) => onFieldDecision?.(
                      fieldName,
                      event.target.value as "" | "accept_incoming" | "keep_local"
                    )}
                    value={fieldDecisions[fieldName] ?? ""}
                  >
                    <option value="">Follow record</option>
                    <option value="accept_incoming">Incoming</option>
                    <option value="keep_local">Local</option>
                  </select>
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReportFinding({
  title,
  empty,
  children
}: {
  title: string;
  empty: string;
  children: React.ReactNode;
}) {
  const items = Array.isArray(children) ? children : children ? [children] : [];
  return (
    <section>
      <h4>{title}</h4>
      {items.length > 0 ? <ul>{children}</ul> : <p>{empty}</p>}
    </section>
  );
}

function isSyncRunReport(value: unknown): value is SyncRunReport {
  if (!isRecord(value) || !isRecord(value.counts) || !isRecord(value.sourceMetadata)) return false;
  return Array.isArray(value.warnings) && value.warnings.every((warning) => typeof warning === "string");
}

function metadataRecords(metadata: Record<string, unknown>, key: string): Array<Record<string, unknown>> {
  const value = metadata[key];
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function metadataUnsupportedTags(metadata: Record<string, unknown>): {
  total: number;
  tags: Array<{ tag: string; count: number }>;
  truncated: boolean;
} {
  const value = metadata.unsupportedTags;
  if (!isRecord(value) || !Array.isArray(value.tags)) return { total: 0, tags: [], truncated: false };
  const tags = value.tags.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.tag !== "string" || typeof entry.count !== "number") return [];
    return [{ tag: entry.tag, count: entry.count }];
  });
  return {
    total: typeof value.total === "number" ? value.total : tags.reduce((sum, entry) => sum + entry.count, 0),
    tags,
    truncated: value.truncated === true
  };
}

function metadataText(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function metadataPath(record: Record<string, unknown>): string {
  return metadataText(record.gedcomPath, metadataText(record.normalizedPath, "Unspecified media path"));
}

type ComparisonSide = {
  key: "base" | "local" | "incoming";
  label: "Base" | "Local" | "Incoming";
  present: boolean;
  value: unknown;
};

function comparisonSides(payload: Record<string, unknown>): ComparisonSide[] {
  const nestedValues = isRecord(payload.values) ? payload.values : null;
  return ([
    ["base", "Base", "baseFields"],
    ["local", "Local", "localFields"],
    ["incoming", "Incoming", "incomingFields"]
  ] as const).map(([key, label, fallbackKey]) => {
    if (nestedValues && hasOwn(nestedValues, key)) {
      return { key, label, present: true, value: nestedValues[key] };
    }
    if (hasOwn(payload, key)) {
      return { key, label, present: true, value: payload[key] };
    }
    if (hasOwn(payload, fallbackKey)) {
      return { key, label, present: true, value: payload[fallbackKey] };
    }
    return { key, label, present: false, value: undefined };
  });
}

function comparisonFieldValue(value: unknown, fieldName: string, usesFields: boolean): unknown {
  if (!usesFields) return value;
  if (!isRecord(value)) return undefined;
  return value[fieldName];
}

function formatComparisonValue(value: unknown): string {
  if (value === undefined) return "Not supplied";
  if (value === null) return "Not present";
  if (typeof value === "string") return value || "Empty";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    const serialized = JSON.stringify(value);
    return serialized.length > 1_000 ? `${serialized.slice(0, 997)}…` : serialized;
  } catch {
    return "Unavailable";
  }
}

function humanizeFieldName(value: string): string {
  const words = value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim();
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : "Field";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

const reviewGroups: Array<{ classification: ReviewChange["classification"]; label: string }> = [
  { classification: "conflict", label: "Conflicts" },
  { classification: "remote_only", label: "Incoming changes" },
  { classification: "local_only", label: "Local changes" },
  { classification: "deletion", label: "Missing from export" },
  { classification: "same", label: "Already identical" }
];

function SourceCard({
  card,
  connections,
  connectionStates,
  desktopMediaRetentionEnabled,
  enabled,
  newImportState,
  onCancel,
  onDisconnect,
  onImport,
  onReopen
}: {
  card: (typeof sourceCards)[number];
  connections: DataSourceConnection[];
  connectionStates: Record<string, ImportState>;
  desktopMediaRetentionEnabled: boolean;
  enabled: boolean;
  newImportState?: ImportState;
  onCancel: (connectionId: string, runId: string) => void;
  onDisconnect: (connectionId: string) => void;
  onImport: (
    file: File,
    connectionId?: string,
    mediaRightsAcknowledged?: boolean,
    displayName?: string
  ) => void;
  onReopen: (connectionId: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingConnectionId = useRef<string | undefined>(undefined);
  const [newSourceName, setNewSourceName] = useState("");
  const [mediaRightsAcknowledged, setMediaRightsAcknowledged] = useState(false);
  const [mediaRightsError, setMediaRightsError] = useState("");
  const creating = isDataSourceWorkActive(newImportState?.phase);
  const sourceKind = card.provider === "ancestry_export" ? "tree" : "source";

  return (
    <article className="app-card data-source-card">
      <div className="data-source-card-heading">
        <div>
          <span className="eyebrow">{card.eyebrow}</span>
          <h2>{card.title}</h2>
        </div>
        <span className="data-source-capability">
          {card.media && desktopMediaRetentionEnabled ? "Private media package" : card.media ? "GEDCOM import" : "Snapshot import"}
        </span>
      </div>
      <p className="muted">{card.description}</p>

      {card.steps ? (
        <div className="data-source-instructions">
          <strong>{card.provider === "ancestry_export" ? "Export steps" : "Package steps"}</strong>
          <ol>
            {card.steps.map((step) => <li key={step}>{step}</li>)}
          </ol>
          {card.helpUrl && card.helpLabel ? (
            <a href={card.helpUrl} rel="noreferrer" target="_blank">{card.helpLabel}</a>
          ) : null}
        </div>
      ) : null}

      {card.provider === "ancestry_export" ? (
        <div className="data-source-notice">
          <strong>Refresh from an Ancestry export</strong>
          <span>Kin Resolve does not ask for or store your Ancestry password or cookies and does not automate Ancestry pages.</span>
        </div>
      ) : null}

      {card.media ? (
        <div className="data-source-notice restricted">
          <strong>Restricted and private by default</strong>
          <span>
            {desktopMediaRetentionEnabled
              ? "Matched package files are malware-scanned and retained privately as third-party restricted. They cannot be published or used by AI. Files you later attest that you own still remain private until a separate publishing decision exists."
              : "This deployment accepts a standalone GEDCOM, but attachment-bearing ZIP packages remain disabled until the private-media feature and legal-review gate are both open. Media references cannot be published, and package binaries are never sent to or used by AI."}
          </span>
        </div>
      ) : null}

      {card.media && desktopMediaRetentionEnabled ? (
        <label className="data-source-rights-acknowledgement">
          <input
            checked={mediaRightsAcknowledged}
            onChange={(event) => {
              setMediaRightsAcknowledged(event.currentTarget.checked);
              setMediaRightsError("");
            }}
            type="checkbox"
          />
          <span>
            Required for a ZIP with media: I have the right to store every file in this package in my private archive, and I understand third-party record images remain restricted.
          </span>
        </label>
      ) : null}

      {connections.length > 0 ? (
        <div className="remembered-sources">
          {connections.map((connection) => {
            const importState = connectionStates[connection.id];
            const busy = isDataSourceWorkActive(importState?.phase);
            const hasOpenRun = importState?.phase === "review_ready";
            const activeRun = busy || hasOpenRun;
            const canReopen = Boolean(
              importState?.runId
              && importState.reviewOpen === false
              && ["review_ready", "applied", "rolled_back"].includes(importState.phase)
            );
            const canCancel = Boolean(
              importState?.runId
              && ["queued", "parsing", "processing_delayed", "review_ready"].includes(importState.phase)
            );
            return (
              <div className="remembered-source" key={connection.id}>
                <div>
                  <strong>{connection.displayName}</strong>
                  <span>{lastRefreshedLabel(card.provider, connection.lastRefreshedAt)}</span>
                  <span>Authoritative edits: {authorityLabel(connection.authority)}</span>
                  {importState?.message ? (
                    <span
                      aria-live="polite"
                      className={importState.phase === "failed" ? "form-error" : undefined}
                      role="status"
                    >
                      {importState.message}
                    </span>
                  ) : null}
                </div>
                <div className="remembered-source-actions">
                  {canReopen ? (
                    <button className="button-secondary" onClick={() => onReopen(connection.id)} type="button">
                      Reopen review
                    </button>
                  ) : null}
                  {canCancel && importState?.runId ? (
                    <button
                      className="button-secondary"
                      onClick={() => onCancel(connection.id, importState.runId as string)}
                      type="button"
                    >
                      Cancel refresh
                    </button>
                  ) : null}
                  <button
                    className="button-secondary"
                    disabled={!enabled || activeRun}
                    onClick={() => {
                      pendingConnectionId.current = connection.id;
                      inputRef.current?.click();
                    }}
                    type="button"
                  >
                    Refresh
                  </button>
                  <button
                    className="button-secondary"
                    disabled={activeRun}
                    onClick={() => onDisconnect(connection.id)}
                    type="button"
                  >
                    Disconnect data source
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      <div className="data-source-new-source">
        <label className="field">
          <span>Name this {card.title} {sourceKind}</span>
          <input
            disabled={!enabled || creating}
            maxLength={240}
            onChange={(event) => setNewSourceName(event.currentTarget.value)}
            placeholder={card.provider === "ancestry_export" ? "Hartwell family tree" : "Hartwell research source"}
            type="text"
            value={newSourceName}
          />
        </label>
        <button
          className="button-secondary"
          disabled={!enabled || creating || !newSourceName.trim()}
          onClick={() => {
            pendingConnectionId.current = undefined;
            inputRef.current?.click();
          }}
          type="button"
        >
          {connections.length > 0
            ? `Add another ${card.title} ${sourceKind}`
            : card.provider === "ancestry_export"
              ? "Choose Ancestry export"
              : "Choose import package"}
        </button>
      </div>

      <input
        accept={card.accept}
        className="visually-hidden"
        data-provider={card.provider}
        disabled={!enabled}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (
            file
            && card.media
            && desktopMediaRetentionEnabled
            && /\.zip$/i.test(file.name)
            && !mediaRightsAcknowledged
          ) {
            setMediaRightsError("A media ZIP requires the rights acknowledgement above. A standalone GEDCOM does not.");
          } else if (file) {
            setMediaRightsError("");
            onImport(
              file,
              pendingConnectionId.current,
              mediaRightsAcknowledged,
              pendingConnectionId.current ? undefined : newSourceName.trim()
            );
          }
          pendingConnectionId.current = undefined;
          event.currentTarget.value = "";
        }}
        ref={inputRef}
        type="file"
      />

      {mediaRightsError ? <p className="form-error" role="status">{mediaRightsError}</p> : null}

      {newImportState?.message ? (
        <p aria-live="polite" className={newImportState.phase === "failed" ? "form-error" : "muted"} role="status">
          {newImportState.message}
        </p>
      ) : null}
    </article>
  );
}

function PrivateMediaPanel({ enabled, refreshToken }: { enabled: boolean; refreshToken: string }) {
  const [items, setItems] = useState<IntegrationMediaItem[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const [ownershipDecisions, setOwnershipDecisions] = useState<Record<string, boolean>>({});
  const [savingId, setSavingId] = useState<string>();

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void fetchWithSignal("/api/integration-media?pageSize=100", controller.signal)
      .then(responsePayload)
      .then((payload) => {
        if (!controller.signal.aborted) {
          setItems(Array.isArray(payload.items) ? payload.items as IntegrationMediaItem[] : []);
          setNextCursor(typeof payload.nextCursor === "string" ? payload.nextCursor : null);
        }
      })
      .catch((loadError) => {
        if (!controller.signal.aborted) setError(errorMessage(loadError));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [enabled, refreshToken]);

  if (!enabled) return null;

  async function loadMoreMedia() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    setError(undefined);
    try {
      const searchParams = new URLSearchParams({ pageSize: "100", cursor: nextCursor });
      const payload = await responsePayload(await fetch(`/api/integration-media?${searchParams}`, {
        cache: "no-store"
      }));
      const incoming = Array.isArray(payload.items) ? payload.items as IntegrationMediaItem[] : [];
      setItems((current) => {
        const byId = new Map(current.map((item) => [item.id, item]));
        for (const item of incoming) byId.set(item.id, item);
        return [...byId.values()];
      });
      setNextCursor(typeof payload.nextCursor === "string" ? payload.nextCursor : null);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoadingMore(false);
    }
  }

  async function attestOwnership(mediaId: string) {
    if (!ownershipDecisions[mediaId]) return;
    setSavingId(mediaId);
    setError(undefined);
    try {
      const payload = await responsePayload(await fetch(`/api/integration-media/${encodeURIComponent(mediaId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          licenseClass: "user_owned",
          ownershipAttestation: {
            accepted: true,
            version: MEDIA_OWNERSHIP_ATTESTATION_VERSION
          }
        })
      }));
      if (!isRecord(payload.media)) throw new Error("The media classification was not returned.");
      setItems((current) => current.map((item) => (
        item.id === mediaId ? payload.media as IntegrationMediaItem : item
      )));
      setOwnershipDecisions((current) => ({ ...current, [mediaId]: false }));
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSavingId(undefined);
    }
  }

  return (
    <section className="app-card integration-media-panel" aria-labelledby="integration-media-heading">
      <div>
        <span className="eyebrow">Private evidence</span>
        <h2 id="integration-media-heading">Imported package media</h2>
        <p className="muted">
          Every file begins private and third-party restricted. Download requires your authenticated archive session; public publishing and AI use remain blocked.
        </p>
      </div>
      {loading ? <p className="muted" role="status">Loading private media…</p> : null}
      {error ? <p className="form-error" role="status">{error}</p> : null}
      {!loading && items.length === 0 ? (
        <p className="muted">No matched desktop-package media has been retained yet.</p>
      ) : null}
      {items.length > 0 ? (
        <div className="integration-media-list">
          {items.map((item) => (
            <article className="integration-media-item" key={item.id}>
              <div>
                <strong>{item.fileName}</strong>
                <span className="muted">
                  {item.provider === "family_tree_maker" ? "Family Tree Maker" : "RootsMagic"}
                  {" · "}{formatByteCount(item.size)}{" · "}
                  {item.licenseClass === "user_owned" ? "Ownership attested" : "Third-party restricted"}
                </span>
              </div>
              <div className="integration-media-actions">
                <a
                  className="button-secondary"
                  href={`/api/integration-media/${encodeURIComponent(item.id)}/download`}
                >
                  Download privately
                </a>
                {item.licenseClass === "third_party_restricted" ? (
                  <div className="integration-media-attestation">
                    <label>
                      <input
                        checked={ownershipDecisions[item.id] === true}
                        onChange={(event) => setOwnershipDecisions((current) => ({
                          ...current,
                          [item.id]: event.currentTarget.checked
                        }))}
                        type="checkbox"
                      />
                      <span>I created this file or own the rights to it.</span>
                    </label>
                    <button
                      className="button-secondary"
                      disabled={!ownershipDecisions[item.id] || savingId === item.id}
                      onClick={() => void attestOwnership(item.id)}
                      type="button"
                    >
                      {savingId === item.id ? "Saving…" : "Mark as user-owned"}
                    </button>
                  </div>
                ) : (
                  <span className="muted">Still private; not publishable or AI eligible.</span>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : null}
      {nextCursor ? (
        <button
          className="button-secondary"
          disabled={loadingMore}
          onClick={() => void loadMoreMedia()}
          type="button"
        >
          {loadingMore ? "Loading more…" : "Load more private media"}
        </button>
      ) : null}
    </section>
  );
}

async function fetchWithSignal(url: string, signal: AbortSignal): Promise<Response> {
  return fetch(url, { cache: "no-store", signal });
}

function formatByteCount(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "Unknown size";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function authorityLabel(authority: string): string {
  return ({
    ancestry: "Ancestry",
    family_tree_maker: "Family Tree Maker",
    rootsmagic: "RootsMagic",
    another_genealogy_app: "another genealogy app"
  } as Record<string, string>)[authority] ?? authority;
}

async function responsePayload(response: Response): Promise<Record<string, unknown>> {
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof payload.error === "string" ? payload.error : "The data-source request failed.");
  }
  return payload;
}

async function uploadPrivateArtifact(
  connectionId: string,
  file: File,
  mediaRightsAcknowledged: boolean,
  onProgress: (message: string) => void
): Promise<{ id: string }> {
  const contentType = integrationUploadContentType(file);
  const stagePayload = await responsePayload(await fetch(
    `/api/integrations/${encodeURIComponent(connectionId)}/artifacts/stage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileName: file.name,
        contentType,
        size: file.size,
        ...(mediaRightsAcknowledged ? {
          mediaRightsAcknowledgement: {
            accepted: true,
            version: DESKTOP_MEDIA_RIGHTS_ACKNOWLEDGEMENT_VERSION
          }
        } : {})
      })
    }
  ));
  const intent = stagePayload.intent;
  const upload = stagePayload.upload;
  if (!isRecord(intent) || typeof intent.id !== "string" || !isDirectUploadInstruction(upload)) {
    throw new Error("The private upload ticket could not be verified.");
  }

  onProgress("Uploading directly to private archive storage…");
  if (upload.strategy === "presigned_post") {
    const form = new FormData();
    for (const [field, value] of Object.entries(upload.fields)) {
      form.append(field, value);
    }
    form.append("file", file);
    const uploaded = await fetch(upload.url, {
      method: upload.method,
      body: form
    });
    if (!uploaded.ok) {
      throw new Error("Private storage rejected the upload. Check the deployment storage and CORS settings.");
    }
  } else {
    const { put } = await import("@vercel/blob/client");
    await put(upload.pathname, file, {
      access: upload.access,
      token: upload.clientToken,
      contentType: upload.contentType,
      multipart: upload.multipart,
      onUploadProgress(progress) {
        onProgress(`Uploading directly to private archive storage… ${Math.round(progress.percentage)}%`);
      }
    });
  }

  onProgress("Verifying upload integrity…");
  const completed = await responsePayload(await fetch(
    `/api/integrations/${encodeURIComponent(connectionId)}/artifacts/complete`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intentId: intent.id })
    }
  ));
  if (!isRecord(completed.artifact) || typeof completed.artifact.id !== "string") {
    throw new Error("The verified private artifact was not returned.");
  }
  return { id: completed.artifact.id };
}

function isDirectUploadInstruction(value: unknown): value is DirectUploadInstruction {
  if (!isRecord(value) || typeof value.strategy !== "string" || typeof value.expiresAt !== "string") {
    return false;
  }
  if (value.strategy === "presigned_post") {
    return value.method === "POST"
      && typeof value.url === "string"
      && isStringRecord(value.fields);
  }
  return value.strategy === "vercel_blob_client"
    && typeof value.pathname === "string"
    && typeof value.clientToken === "string"
    && value.access === "private"
    && typeof value.contentType === "string"
    && value.multipart === true;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((item) => typeof item === "string");
}

function integrationUploadContentType(file: File): string {
  // Browser-reported types vary by OS. The completion endpoint verifies the
  // actual GEDCOM/ZIP signature before creating an artifact.
  return /\.zip$/i.test(file.name) ? "application/zip" : "text/plain";
}

async function fetchChangePage(runId: string, options: {
  cursor?: string;
  query?: string;
  classification?: ReviewChange["classification"];
} = {}): Promise<{
  items: ReviewChange[];
  nextCursor: string | null;
  summary: ChangeSummary;
}> {
  const url = new URL(`/api/integration-runs/${encodeURIComponent(runId)}/changes`, window.location.origin);
  url.searchParams.set("limit", "50");
  if (options.cursor) url.searchParams.set("cursor", options.cursor);
  if (options.query?.trim()) url.searchParams.set("query", options.query.trim());
  if (options.classification) url.searchParams.set("classification", options.classification);
  const payload = await responsePayload(await fetch(url, { cache: "no-store" }));
  if (!isChangeSummary(payload.summary)) {
    throw new Error("The change summary could not be loaded safely.");
  }
  return {
    items: Array.isArray(payload.items) ? payload.items as ReviewChange[] : [],
    nextCursor: typeof payload.nextCursor === "string" ? payload.nextCursor : null,
    summary: payload.summary
  };
}

function isChangeSummary(value: unknown): value is ChangeSummary {
  if (!isRecord(value) || !isRecord(value.byClassification)) return false;
  const byClassification = value.byClassification;
  if (![value.total, value.filtered, value.unresolved].every((count) => Number.isInteger(count) && Number(count) >= 0)) {
    return false;
  }
  return reviewGroups.every((group) => {
    const count = byClassification[group.classification];
    return Number.isInteger(count) && Number(count) >= 0;
  });
}

function ambiguousLocalEntityIds(change: ReviewChange): string[] {
  const candidates = change.resolutionPayload?.ambiguousLocalEntityIds;
  if (!Array.isArray(candidates)) return [];
  return candidates.filter((candidate): candidate is string => typeof candidate === "string" && Boolean(candidate.trim()));
}

function resolutionAcceptsIncoming(
  action: "accept_incoming" | "keep_local" | "no_op",
  fields?: Record<string, "accept_incoming" | "keep_local">
): boolean {
  return action === "accept_incoming" || Object.values(fields ?? {}).includes("accept_incoming");
}

function transientStateKey(provider: Provider): string {
  return `new:${provider}`;
}

function isBrowserRun(value: unknown): value is BrowserRun {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.connectionId === "string"
    && typeof value.status === "string"
    && typeof value.backupAvailable === "boolean";
}

function browserPhase(status: string): ImportState["phase"] {
  if (status === "ready") return "review_ready";
  if ([
    "idle",
    "staging",
    "queued",
    "parsing",
    "cancelled",
    "review_ready",
    "applied",
    "rolled_back",
    "failed"
  ].includes(status)) {
    return status as ImportState["phase"];
  }
  if (status === "cancel_requested") return "cancelling";
  return "failed";
}

function browserRunMessage(run: BrowserRun): string {
  if (["review_ready", "ready"].includes(run.status)) return "Changes are ready to review.";
  if (run.status === "applied") {
    return run.backupAvailable
      ? "The reviewed refresh was applied. A restorable backup was created."
      : "The reviewed refresh was applied. Its restore point expired under the backup-retention policy.";
  }
  if (run.status === "rolled_back") return "This refresh was undone from its pre-apply backup.";
  if (run.status === "cancelled") return "Refresh cancelled.";
  if (run.status === "failed") return run.errorMessage || "The refresh could not be prepared.";
  return "The latest refresh is not currently reviewable.";
}

function lastRefreshedLabel(provider: Provider, value?: string | null): string {
  const prefix = provider === "ancestry_export" ? "Last refreshed from Ancestry" : "Last refreshed";
  if (!value) return `${prefix}: not yet applied`;
  const date = new Date(value);
  const formatted = Number.isNaN(date.getTime())
    ? "unknown"
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  return `${prefix}: ${formatted}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The import could not be started.";
}

function cryptoId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
