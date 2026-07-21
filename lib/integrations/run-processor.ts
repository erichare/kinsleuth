import { createHash } from "node:crypto";

import { query } from "../db";
import { prepareGedcomImport, type PreparedGedcomImport } from "../gedcom/apply";
import { validateHostedGedcomFile, validateHostedGedcomPeople } from "../hosted-capabilities";
import type { PersonFact, PersonSummary, SourceDocument } from "../models";
import {
  createConfiguredArchiveObjectStorage,
  type ArchiveObjectStorage
} from "../storage/object-storage";
import { readWorkspace } from "../workspace-store";
import { classifyRefreshChange } from "./refresh";
import { getIntegrationFeatureFlags, isIntegrationProviderEnabled } from "./feature-flags";
import { integrationImportId } from "./import-id";
import {
  hashRetainedGedcomExtensions,
  normalizeGedcomSnapshotEntities,
  summarizeUnsupportedGedcomTags,
  type NormalizedGedcomEntity,
  type NormalizedGedcomEntityType
} from "./gedcom-normalization";
import { commitIntegrationPreparation, type PreparationExternalRef } from "./preparation-store";
import { scanImportPackageFiles, type MalwareScanner } from "./malware-scanner";
import {
  detectSafeImportedMediaMime,
  isDesktopMediaLegalReviewApproved,
  shouldRetainDesktopMedia,
  type PreparedIntegrationMediaObject
} from "./media-store";
import {
  expireIntegrationMediaWriteClaims,
  registerIntegrationMediaWriteClaim
} from "./media-claims";
import {
  inspectSourcePackage,
  type InspectedPackageMedia,
  type SourcePackageProvider
} from "./source-package";
import {
  applySyncRun,
  getIntegrationArtifact,
  getIntegrationConnection,
  getIntegrationSnapshot,
  getSyncRun,
  listSyncChanges,
  markSyncRunParsing,
  readIntegrationArtifact,
  rollbackSyncRun,
  setIntegrationArtifactState,
  type AddSyncChangeInput,
  type ApplySyncRunInput,
  type IntegrationSnapshot,
  type IntegrationStoreOptions,
  type RollbackSyncRunInput,
  type SyncChange,
  type SyncResolutionInput,
  type SyncResolution
} from "./store";

export const integrationParserVersion = "gedcom-provider-neutral-v4";

type RunProcessorOptions = IntegrationStoreOptions & {
  objectStorage?: ArchiveObjectStorage;
  assertLease?: () => Promise<void>;
  leaseFence?: { jobId: string; leaseToken: string };
  malwareScanner?: MalwareScanner;
};

type EntityType = "person" | "source" | NormalizedGedcomEntityType;

type SnapshotEntity = {
  entityType: EntityType;
  externalId: string;
  localEntityId: string;
  incomingHash: string;
  identityKey?: string;
  relativeIdentityKeys?: string[];
  providerIds?: string[];
};

type IdentityDescriptor = Omit<SnapshotEntity, "localEntityId" | "incomingHash">;

type ResolvedEntityIdentities = {
  localIds: Map<string, string>;
  ambiguous: Map<string, string[]>;
};

type SnapshotSourceMetadata = Record<string, unknown> & {
  entityManifest?: SnapshotEntity[];
  entityValues?: Record<string, Record<string, unknown>>;
};

export type IntegrationIdentityTestEntity = {
  entityType: "person" | "source";
  externalId: string;
  localEntityId?: string;
  incomingHash?: string;
  identityKey?: string;
  relativeIdentityKeys?: string[];
  providerIds?: string[];
};

type NormalizedIntegrationData = {
  prepared: PreparedGedcomImport;
  manifest: SnapshotEntity[];
  values: Map<string, Record<string, unknown>>;
};

const personOwnedNormalizedSubtrees = [
  "BIRT", "DEAT", "BURI", "CHR", "CENS", "MARR", "DIV", "RESI", "EVEN", "OCCU",
  "SOUR", "OBJE"
] as const;

export async function processIntegrationSyncRun(
  runId: string,
  options: RunProcessorOptions
): Promise<{
  run: Awaited<ReturnType<typeof getSyncRun>>;
  snapshot: Awaited<ReturnType<typeof commitIntegrationPreparation>>["snapshot"];
  counts: Record<string, number>;
  warnings: string[];
}> {
  const run = await getSyncRun(runId, options);
  if (!run.artifactId) throw integrationProcessingError("ARTIFACT_REQUIRED", "Refresh has no staged artifact");
  const connection = await getIntegrationConnection(run.connectionId, options);
  const flags = getIntegrationFeatureFlags();
  if (!isIntegrationProviderEnabled(connection.provider, flags)) {
    throw integrationProcessingError("FEATURE_DISABLED", "This data-source provider is disabled");
  }
  const pendingArtifact = await getIntegrationArtifact(connection.id, run.artifactId, options);
  if (flags.plainGedcomOnly) {
    validateHostedGedcomFile({
      fileName: pendingArtifact.fileName,
      contentType: pendingArtifact.contentType,
      size: pendingArtifact.size
    });
  }
  await markSyncRunParsing(runId, options);
  await setIntegrationArtifactState(connection.id, run.artifactId, "quarantined", options);

  const { artifact, bytes } = await readIntegrationArtifact(
      connection.id,
      run.artifactId,
      options
    );
    const inspected = await inspectSourcePackage({
      fileName: artifact.fileName,
      bytes,
      provider: packageProvider(connection.provider)
    });
    const warnings = [...inspected.warnings];
    const scannedPackageFiles = await scanImportPackageFiles(
      inspected.quarantineFiles,
      options.malwareScanner
    );
    const mediaRetentionAuthorized = shouldRetainDesktopMedia({
      provider: packageProvider(connection.provider),
      desktopMediaEnabled: flags.desktopMedia,
      legalReviewApproved: isDesktopMediaLegalReviewApproved(),
      rightsAcknowledgement: run.mediaRightsAcknowledgement
    });
    if (scannedPackageFiles > 0 && !mediaRetentionAuthorized) {
      throw integrationProcessingError(
        "MEDIA_RETENTION_NOT_AUTHORIZED",
        "Attachment-bearing source packages require the authorized desktop-media workflow"
      );
    }
    if (scannedPackageFiles > 0) {
      warnings.push(
        `${scannedPackageFiles} package file(s) passed malware quarantine.`
      );
    }
    try {
    const mediaObjects = mediaRetentionAuthorized
      ? await persistMatchedDesktopMedia(runId, inspected.media, warnings, options)
      : [];
    if (mediaObjects.length > 0) {
      warnings.push(
        `${mediaObjects.length} matched media file(s) were retained as private third-party-restricted evidence.`
      );
    }

    const baseSnapshot = run.baseSnapshotId
      ? await getIntegrationSnapshot(run.baseSnapshotId, options)
      : undefined;
    const baseManifest = snapshotManifest(baseSnapshot);
    const baseValues = snapshotEntityValues(baseSnapshot);
    const unnamespaced = prepareGedcomImport(inspected.gedcom.fileName, inspected.gedcom.content);
    if (flags.plainGedcomOnly) validateHostedGedcomPeople(unnamespaced.people.length);
    const identities = buildIdentityDescriptors(unnamespaced);
    const rememberedIdentityRefs = await loadRememberedIdentityRefs(connection.id, options);
    const resolvedIdentities = resolveEntityIdentities(
      identities,
      baseManifest,
      connection.id,
      rememberedIdentityRefs
    );
    let prepared = namespacePreparedImport(
      unnamespaced,
      connection.id,
      inspected.sha256,
      identities,
      resolvedIdentities.localIds
    );
    const normalizedEntities = normalizeGedcomSnapshotEntities(inspected.gedcom.content);
    const normalized = buildNormalizedIntegrationData(
      normalizedEntities,
      connection.id,
      prepared,
      identities,
      reconcileFactLocalIds(
        normalizedEntities,
        connection.id,
        prepared,
        identities,
        baseManifest,
        baseValues
      )
    );
    prepared = normalized.prepared;
    const primaryExtensionHashes = buildPrimaryExtensionHashes(prepared, identities);
    const manifest = [
      ...buildEntityManifest(prepared, identities, primaryExtensionHashes),
      ...normalized.manifest
    ];
    const incomingValues = buildEntityValues(
      prepared,
      manifest,
      normalized.values,
      primaryExtensionHashes
    );
    const unsupportedRecords = prepared.rawRecords
      .filter((record) => !new Set(["HEAD", "INDI", "FAM", "SOUR", "OBJE", "NOTE", "REPO", "TRLR"]).has(record.type))
      .map((record) => ({ type: record.type, externalId: record.xref ?? null }));
    const unsupportedTags = summarizeUnsupportedGedcomTags(inspected.gedcom.content);
    if (unsupportedRecords.length > 0 || unsupportedTags.total > 0) {
      warnings.push(
        `${unsupportedRecords.length} unsupported top-level record(s) and ${unsupportedTags.total} unknown nested tag(s) were retained verbatim.`
      );
    }
    warnings.push(
      "Families and media are retained as snapshot-only review entities; only the primary fact citation source link has a canonical workspace field."
    );
    const privacyPreview = summarizeIncomingPrivacy(prepared.people);
    const counts = {
      people: prepared.people.length,
      families: prepared.snapshot.summary.families,
      sources: prepared.sources.length,
      facts: normalized.manifest.filter((entity) => entity.entityType === "fact").length,
      relationships: normalized.manifest.filter((entity) => entity.entityType === "relationship").length,
      citations: normalized.manifest.filter((entity) => entity.entityType === "citation").length,
      notes: prepared.snapshot.summary.notes,
      media: inspected.media.length,
      retainedMedia: mediaObjects.length,
      scannedPackageFiles,
      mediaReferences: normalized.manifest.filter((entity) => entity.entityType === "media").length,
      missingMedia: inspected.missingMedia.length,
      ambiguousMedia: inspected.ambiguousMedia.length,
      unsupported: unsupportedRecords.length + unsupportedTags.total,
      livingPeople: privacyPreview.living,
      privatePeople: privacyPreview.private,
      sensitivePeople: privacyPreview.sensitive
    };
    const snapshotInput = {
      connectionId: connection.id,
      artifactKey: artifact.artifactKey,
      sha256: inspected.sha256,
      parserVersion: integrationParserVersion,
      counts,
      warnings,
      sourceMetadata: {
        provider: connection.provider,
        fileName: artifact.fileName,
        gedcomFileName: inspected.gedcom.fileName,
        charset: inspected.gedcom.charset,
        authority: connection.authority,
        entityManifest: manifest,
        entityValues: Object.fromEntries(incomingValues),
        canonicalApplySupport: {
          fact: "person_facts",
          relationship: "person_relatives",
          citation: "primary_fact_source_link",
          family: "snapshot_only",
          media: "snapshot_only"
        },
        privacyPreview,
        missingMedia: inspected.missingMedia,
        ambiguousMedia: inspected.ambiguousMedia,
        retainedMediaCount: mediaObjects.length,
        unsupportedRecords,
        unsupportedTags
      }
    };

    const workspace = await readWorkspace(options);
    const baseByKey = new Map(baseManifest.map((entity) => [entityKey(entity), entity]));
    const baseByLocalId = new Map(baseManifest.map((entity) => [localEntityKey(entity), entity]));
    const matchedBaseKeys = new Set<string>();
    const changes: AddSyncChangeInput[] = [];

    for (const incoming of manifest) {
      const key = entityKey(incoming);
      const ambiguousCandidates = resolvedIdentities.ambiguous.get(key);
      const base = baseByLocalId.get(localEntityKey(incoming)) ?? baseByKey.get(key);
      if (base) matchedBaseKeys.add(entityKey(base));
      const localEntityId = incoming.localEntityId;
      const incomingValue = incomingValues.get(key) ?? null;
      const baseValue = base ? baseValues.get(entityKey(base)) ?? null : null;
      const localValue = localEntityValue(
        incoming.entityType,
        localEntityId,
        workspace,
        incomingValue ?? baseValue,
        baseValue
      );
      const localHash = localValue ? entityValueHash(incoming.entityType, localValue) : null;
      const classified = ambiguousCandidates
        ? { classification: "conflict" as const, proposedAction: "review" as const }
        : classifyRefreshChange({
            baseHash: base?.incomingHash ?? null,
            localHash,
            incomingHash: incoming.incomingHash
          });
      changes.push({
        entityType: incoming.entityType,
        externalId: incoming.externalId,
        localEntityId,
        baseHash: base?.incomingHash ?? null,
        localHash,
        incomingHash: incoming.incomingHash,
        ...classified,
        resolutionPayload: {
          incomingAvailable: true,
          values: {
            base: baseValue,
            local: localValue,
            incoming: incomingValue
          },
          ...(ambiguousCandidates ? { ambiguousLocalEntityIds: ambiguousCandidates } : {})
        }
      });
    }

    for (const base of baseManifest) {
      if (matchedBaseKeys.has(entityKey(base))) continue;
      const baseValue = baseValues.get(entityKey(base)) ?? null;
      const localValue = localEntityValue(
        base.entityType,
        base.localEntityId,
        workspace,
        baseValue,
        baseValue
      );
      const localHash = localValue ? entityValueHash(base.entityType, localValue) : null;
      const classified = classifyRefreshChange({
        baseHash: base.incomingHash,
        localHash,
        incomingHash: null
      });
      changes.push({
        entityType: base.entityType,
        externalId: base.externalId,
        localEntityId: base.localEntityId,
        baseHash: base.incomingHash,
        localHash,
        incomingHash: null,
        ...classified,
        resolutionPayload: {
          incomingAvailable: false,
          values: {
            base: baseValue,
            local: localValue,
            incoming: null
          }
        }
      });
    }

    await options.assertLease?.();
    const committed = await commitIntegrationPreparation(
      {
        runId,
        connectionId: connection.id,
        artifactId: run.artifactId,
        snapshot: snapshotInput,
        changes,
        externalRefs: rememberableExternalRefs(manifest, resolvedIdentities, rememberedIdentityRefs),
        mediaObjects,
        leaseFence: options.leaseFence
      },
      options
    );
    return { run: committed.run, snapshot: committed.snapshot, counts, warnings };
    } catch (error) {
      // Claims survive process crashes and are expired on observed failures.
      // The delayed collector rechecks concurrent claims and committed media
      // before deleting any content-addressed object.
      await expireIntegrationMediaWriteClaims(runId, options).catch(() => undefined);
      throw error;
    }
}

async function persistMatchedDesktopMedia(
  runId: string,
  mediaFiles: InspectedPackageMedia[],
  warnings: string[],
  options: RunProcessorOptions
): Promise<PreparedIntegrationMediaObject[]> {
  if (mediaFiles.length === 0) return [];
  const storage = options.objectStorage ?? createConfiguredArchiveObjectStorage();
  const retained: PreparedIntegrationMediaObject[] = [];
  for (const media of mediaFiles) {
    const mimeType = detectSafeImportedMediaMime(media.content);
    if (!mimeType) {
      warnings.push("One matched media file had an unsupported content signature and was not retained.");
      continue;
    }
    await options.assertLease?.();
    const bytes = Buffer.from(media.content);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const objectKey = `archives/${options.archiveId}/integration-media/${sha256}`;
    await registerIntegrationMediaWriteClaim({
      runId,
      objectKey,
      sha256,
      mimeType,
      size: bytes.length
    }, options);
    try {
      const stored = await storage.put({
        archiveId: options.archiveId,
        purpose: "integration-media",
        fileName: media.archivePath.split("/").at(-1) || "private-media",
        bytes: media.content,
        contentType: mimeType
      });
      if (
        stored.key !== objectKey
        || stored.sha256 !== sha256
        || stored.size !== bytes.length
      ) {
        throw integrationProcessingError("ARTIFACT_INTEGRITY", "Private media storage returned an invalid identity");
      }
      retained.push({
        objectKey: stored.key,
        sha256: stored.sha256,
        mimeType,
        size: stored.size,
        storageDuplicate: stored.duplicate,
        sourceGedcomPath: media.gedcomPath,
        sourceNormalizedPath: media.normalizedPath,
        sourceArchivePath: media.archivePath
      });
    } catch (error) {
      if (getIntegrationProcessingErrorCode(error) === "ARTIFACT_INTEGRITY") throw error;
      throw integrationProcessingError("STORAGE_UNAVAILABLE", "Private media storage is temporarily unavailable");
    }
  }
  return retained;
}

async function loadRememberedIdentityRefs(
  connectionId: string,
  options: IntegrationStoreOptions
): Promise<Map<string, string>> {
  const result = await query<{ entity_type: string; external_id: string; local_entity_id: string }>(
    `SELECT entity_type, external_id, local_entity_id
     FROM external_entity_refs
     WHERE archive_id = $1 AND connection_id = $2`,
    [options.archiveId, connectionId],
    options
  );
  return new Map(result.rows.map((row) => [`${row.entity_type}:${row.external_id}`, row.local_entity_id]));
}

/**
 * Builds the identity mappings a committed preparation is allowed to remember.
 * Remembered refs are a deterministic `(entityType, externalId) -> local id`
 * index, so an external identity may only be remembered when exactly one local
 * entity claims it in this snapshot:
 * - identical claims collapse to one remembered row;
 * - an external identity claimed by several local entities (a provider tag
 *   value shared across records) identifies none of them and is not
 *   remembered — the immutable snapshot still retains it as provenance;
 * - a remembered mapping never silently moves to a different entity when an
 *   exporter reuses a raw GEDCOM xref.
 */
function rememberableExternalRefs(
  manifest: SnapshotEntity[],
  resolvedIdentities: Pick<ResolvedEntityIdentities, "ambiguous">,
  rememberedIdentityRefs: Map<string, string>
): PreparationExternalRef[] {
  const candidates = manifest
    .filter((entity) => !resolvedIdentities.ambiguous.has(entityKey(entity)))
    .flatMap((entity) => uniqueStrings([entity.externalId, ...(entity.providerIds ?? [])])
      .map((externalId) => ({
        entityType: entity.entityType,
        externalId,
        localEntityId: entity.localEntityId
      })));
  const localIdsByExternalKey = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    const key = `${candidate.entityType}:${candidate.externalId}`;
    const localIds = localIdsByExternalKey.get(key) ?? new Set<string>();
    localIds.add(candidate.localEntityId);
    localIdsByExternalKey.set(key, localIds);
  }

  const seen = new Set<string>();
  const refs: PreparationExternalRef[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.entityType}:${candidate.externalId}`;
    if (seen.has(key) || localIdsByExternalKey.get(key)!.size > 1) continue;
    const rememberedLocalId = rememberedIdentityRefs.get(key);
    if (rememberedLocalId && rememberedLocalId !== candidate.localEntityId) continue;
    seen.add(key);
    refs.push(candidate);
  }
  return refs;
}

export async function applyPreparedIntegrationSyncRun(
  runId: string,
  input: Pick<ApplySyncRunInput, "idempotencyKey" | "resolutions" | "acceptAllSafeIncoming">,
  options: RunProcessorOptions
) {
  const run = await getSyncRun(runId, options);
  if (run.status === "rolled_back") {
    return applySyncRun(runId, input, options);
  }
  if (run.status !== "review_ready" && run.status !== "applied") {
    throw integrationProcessingError("RUN_STATE", "Sync run is not ready to apply");
  }
  if (!run.incomingSnapshotId || !run.artifactId) {
    throw integrationProcessingError(
      "INVALID_STATE",
      "Review-ready sync run is missing its prepared snapshot or artifact"
    );
  }

  const connection = await getIntegrationConnection(run.connectionId, options);
  const flags = getIntegrationFeatureFlags();
  if (!isIntegrationProviderEnabled(connection.provider, flags)) {
    throw integrationProcessingError("FEATURE_DISABLED", "This data-source provider is disabled");
  }
  const pendingArtifact = await getIntegrationArtifact(connection.id, run.artifactId, options);
  if (flags.plainGedcomOnly) {
    validateHostedGedcomFile({
      fileName: pendingArtifact.fileName,
      contentType: pendingArtifact.contentType,
      size: pendingArtifact.size
    });
  }
  if (run.status === "applied") {
    return applySyncRun(runId, input, options);
  }

  const snapshot = await getIntegrationSnapshot(run.incomingSnapshotId, options);
  const { artifact, bytes } = await readIntegrationArtifact(connection.id, run.artifactId, options);
  if (artifact.sha256 !== snapshot.sha256) {
    throw integrationProcessingError("STALE_BASELINE", "The staged artifact no longer matches the prepared snapshot");
  }
  const inspected = await inspectSourcePackage({
    fileName: artifact.fileName,
    bytes,
    provider: packageProvider(connection.provider)
  });
  const unnamespaced = prepareGedcomImport(inspected.gedcom.fileName, inspected.gedcom.content);
  if (flags.plainGedcomOnly) validateHostedGedcomPeople(unnamespaced.people.length);
  const identities = buildIdentityDescriptors(unnamespaced);
  const preparedManifest = snapshotManifest(snapshot);
  const changes = await allSyncChanges(runId, options);
  const requested = new Map((input.resolutions ?? []).map((resolution) => [resolution.changeId, resolution]));
  const selectedIdentityIds = selectedIdentityRemap(changes, requested);
  const preparedLocalIds = new Map(preparedManifest.map((entity) => [entityKey(entity), entity.localEntityId]));
  for (const change of changes) {
    const selectedLocalId = change.localEntityId ? selectedIdentityIds.get(change.localEntityId) : undefined;
    if (selectedLocalId && change.externalId && (change.entityType === "person" || change.entityType === "source")) {
      preparedLocalIds.set(`${change.entityType}:${change.externalId}`, selectedLocalId);
    }
  }
  let prepared = namespacePreparedImport(
    unnamespaced,
    connection.id,
    inspected.sha256,
    identities,
    preparedLocalIds
  );
  const normalized = buildNormalizedIntegrationData(
    normalizeGedcomSnapshotEntities(inspected.gedcom.content),
    connection.id,
    prepared,
    identities,
    new Map(preparedManifest
      .filter((entity) => entity.entityType === "fact")
      .map((entity) => [normalizedEntityKey("fact", entity.externalId), entity.localEntityId]))
  );
  prepared = normalized.prepared;
  const currentManifest = [...buildEntityManifest(prepared, identities), ...normalized.manifest];
  const currentValues = buildEntityValues(prepared, currentManifest, normalized.values);
  const workspace = await readWorkspace(options);
  assertUnchangedLocalBaseline(changes, workspace);
  const selected = resolvedPreparedImport(
    prepared,
    changes,
    requested,
    workspace,
    currentValues,
    selectedIdentityIds
  );
  const hasCanonicalChanges = selected.people.length > 0 || selected.sources.length > 0;

  return applySyncRun(
    runId,
    {
      ...input,
      preparedImport: hasCanonicalChanges ? selected : undefined,
      expectedArchiveUpdatedAt: workspace.updatedAt
    },
    options
  );
}

export async function rollbackAppliedIntegrationSyncRun(
  runId: string,
  input: Pick<RollbackSyncRunInput, "idempotencyKey" | "actorId">,
  options: RunProcessorOptions
) {
  const run = await getSyncRun(runId, options);
  return rollbackSyncRun(
    runId,
    run.backupId ? { ...input, restoreBackup: true } : input,
    options
  );
}

function namespacePreparedImport(
  prepared: PreparedGedcomImport,
  connectionId: string,
  artifactSha256: string,
  identities: IdentityDescriptor[],
  localIds: Map<string, string>
): PreparedGedcomImport {
  const importId = integrationImportId(connectionId, artifactSha256);
  const personIdentities = identities.filter((identity) => identity.entityType === "person");
  const sourceIdentities = identities.filter((identity) => identity.entityType === "source");
  const personIdMap = new Map(
    prepared.people.map((person, index) => {
      const identity = personIdentities[index];
      const localId = identity ? localIds.get(entityKey(identity)) : undefined;
      return [person.id, localId ?? stableLocalId(connectionId, "person", person.id)];
    })
  );
  const rawIdMap = new Map<string, string>();
  const rawRecords = prepared.rawRecords.map((record, index) => {
    const id = `raw-${importId}-${index}-${sha256(record.raw).slice(0, 10)}`;
    rawIdMap.set(record.id, id);
    return { ...record, id, importId };
  });
  const sourceIdMap = new Map(
    prepared.sources.map((source, index) => [
      source.id,
      sourceIdentities[index]
        ? localIds.get(entityKey(sourceIdentities[index]))
          ?? stableLocalId(
            connectionId,
            "source",
            sourceIdentities[index].providerIds?.[0] ?? sourceIdentities[index].externalId
          )
        : stableLocalId(connectionId, "source", source.ancestryApid ?? source.title)
    ])
  );
  const people = prepared.people.map((person) => {
    const id = personIdMap.get(person.id)!;
    return {
      ...person,
      id,
      slug: `${person.slug}-${id.slice(-8)}`,
      // Provider exports are evidence, not publication instructions. Ignore
      // portable _KS_* curation tags on first import; the transactional merge
      // below still preserves privacy, publication, and living-status choices
      // already curated for the same stable local person.
      privacy: "private" as const,
      published: false,
      livingStatus: person.deathDate ? "deceased" as const : "unknown" as const,
      facts: person.facts.map((fact, index) => ({ ...fact, id: `${id}-fact-${index}` })),
      relatives: person.relatives.map((relative) => personIdMap.get(relative)).filter((value): value is string => Boolean(value))
    };
  });
  const sources = prepared.sources.map((source) => ({
    ...source,
    id: sourceIdMap.get(source.id)!,
    importId,
    rawRecordId: source.rawRecordId ? rawIdMap.get(source.rawRecordId) : undefined
  }));

  return {
    snapshot: { ...prepared.snapshot, id: importId },
    appliedImport: {
      ...prepared.appliedImport,
      id: importId,
      checksum: artifactSha256,
      peopleImported: people.length,
      sourcesImported: sources.length,
      rawRecordCount: rawRecords.length
    },
    people,
    sources,
    rawRecords
  };
}

function buildIdentityDescriptors(prepared: PreparedGedcomImport): IdentityDescriptor[] {
  const personRecords = prepared.rawRecords.filter((record) => record.type === "INDI");
  const sourceRecords = prepared.rawRecords.filter((record) => record.type === "SOUR");
  const personIdentities = prepared.people.map((person, index) => ({
    entityType: "person" as const,
    externalId: personRecords[index]?.xref ?? `person-${index + 1}`,
    identityKey: personIdentityKey(person),
    providerIds: providerIdsFromRecord(personRecords[index]?.raw)
  }));
  const identityByParsedId = new Map(
    prepared.people.map((person, index) => [person.id, personIdentities[index].identityKey])
  );
  const people = prepared.people.map((person, index) => ({
    ...personIdentities[index],
    relativeIdentityKeys: person.relatives
      .map((relative) => identityByParsedId.get(relative))
      .filter((value): value is string => Boolean(value))
      .sort()
  }));
  const sources = prepared.sources.map((source, index) => ({
    entityType: "source" as const,
    externalId: sourceRecords[index]?.xref ?? source.ancestryApid ?? `source-${index + 1}`,
    identityKey: sourceIdentityKey(source),
    providerIds: uniqueStrings([
      ...(source.ancestryApid ? [`_APID:${normalizeIdentityValue(source.ancestryApid)}`] : []),
      ...providerIdsFromRecord(sourceRecords[index]?.raw)
    ])
  }));
  return [...people, ...sources];
}

function resolveEntityIdentities(
  incoming: IdentityDescriptor[],
  base: SnapshotEntity[],
  connectionId: string,
  rememberedRefs: Map<string, string> = new Map()
): ResolvedEntityIdentities {
  const localIds = new Map<string, string>();
  const ambiguous = new Map<string, string[]>();
  const claimedLocalIds = new Set<string>();
  const sharedIncomingProviderIds = duplicatedProviderIds(incoming);
  const fallbackIdentitySeed = (entity: IdentityDescriptor) =>
    (entity.providerIds ?? []).find(
      (providerId) => !sharedIncomingProviderIds.has(`${entity.entityType}:${providerId}`)
    ) ?? entity.externalId;
  const baseByExternal = new Map(base.map((entity) => [entityKey(entity), entity]));
  const baseByLocalId = new Map(base.map((entity) => [entity.localEntityId, entity]));
  const providerIndex = new Map<string, SnapshotEntity[]>();
  const identityIndex = new Map<string, SnapshotEntity[]>();
  const relationshipIndex = new Map<string, SnapshotEntity[]>();
  for (const candidate of base) {
    for (const providerId of candidate.providerIds ?? []) {
      addToEntityIndex(providerIndex, `${candidate.entityType}:${providerId}`, candidate);
    }
    if (candidate.identityKey) {
      addToEntityIndex(identityIndex, `${candidate.entityType}:${candidate.identityKey}`, candidate);
    }
    const relationshipKey = relationshipIdentityIndexKey(candidate);
    if (relationshipKey) addToEntityIndex(relationshipIndex, relationshipKey, candidate);
  }
  const availableCandidates = (entity: IdentityDescriptor, candidates: SnapshotEntity[]) =>
    uniqueSnapshotEntities(candidates).filter((candidate) =>
      candidate.entityType === entity.entityType
      && !claimedLocalIds.has(candidate.localEntityId)
      && !hasConflictingProviderIds(entity, candidate)
    );
  const assign = (entity: IdentityDescriptor, localEntityId: string) => {
    const key = entityKey(entity);
    localIds.set(key, localEntityId);
    ambiguous.delete(key);
    claimedLocalIds.add(localEntityId);
  };

  for (const entity of incoming) {
    const providerRememberedIds = uniqueStrings(
      (entity.providerIds ?? [])
        .map((providerId) => rememberedRefs.get(`${entity.entityType}:${providerId}`))
        .filter((value): value is string => Boolean(value))
    );
    if (providerRememberedIds.length === 1 && !claimedLocalIds.has(providerRememberedIds[0])) {
      assign(entity, providerRememberedIds[0]);
      continue;
    }
    if (providerRememberedIds.length > 1) {
      ambiguous.set(entityKey(entity), providerRememberedIds);
      continue;
    }
  }

  // Provider identifiers are more stable than GEDCOM xrefs, which exporters
  // may renumber or reuse. Resolve every unique provider match before xrefs can
  // claim a local entity belonging to a different incoming record.
  for (const entity of incoming) {
    if (localIds.has(entityKey(entity)) || !entity.providerIds?.length) continue;
    const matches = availableCandidates(
      entity,
      entity.providerIds.flatMap((providerId) => providerIndex.get(`${entity.entityType}:${providerId}`) ?? [])
    );
    if (matches.length === 1) assign(entity, matches[0].localEntityId);
  }

  for (const entity of incoming) {
    if (localIds.has(entityKey(entity))) continue;
    const xrefRememberedId = rememberedRefs.get(entityKey(entity));
    if (xrefRememberedId && !claimedLocalIds.has(xrefRememberedId)) {
      const rememberedCandidate = baseByLocalId.get(xrefRememberedId);
      if (rememberedCandidate && hasConflictingProviderIds(entity, rememberedCandidate)) {
        // Exporters may reuse raw xrefs for a different provider-stable
        // identity. Preserve the historical mapping and require an explicit
        // review instead of silently inheriting the prior local person.
        ambiguous.set(entityKey(entity), [xrefRememberedId]);
        continue;
      }
      assign(entity, xrefRememberedId);
    }
  }

  for (const entity of incoming) {
    if (localIds.has(entityKey(entity))) continue;
    const exact = baseByExternal.get(entityKey(entity));
    if (
      !exact
      || claimedLocalIds.has(exact.localEntityId)
      || hasConflictingProviderIds(entity, exact)
    ) continue;
    assign(entity, exact.localEntityId);
  }

  for (const entity of incoming) {
    const key = entityKey(entity);
    if (localIds.has(key)) continue;
    if (ambiguous.has(key)) {
      localIds.set(
        key,
        stableLocalId(connectionId, entity.entityType, fallbackIdentitySeed(entity))
      );
      continue;
    }
    const providerMatches = entity.providerIds?.length
      ? availableCandidates(
          entity,
          entity.providerIds.flatMap((providerId) => providerIndex.get(`${entity.entityType}:${providerId}`) ?? [])
        )
      : [];
    let matches = providerMatches;
    if (matches.length > 1) matches = narrowIdentityMatches(entity, matches);
    if (matches.length === 0 && entity.identityKey) {
      matches = availableCandidates(
        entity,
        identityIndex.get(`${entity.entityType}:${entity.identityKey}`) ?? []
      );
      if (matches.length > 1 && entity.entityType === "person") {
        const relationshipMatches = matchingRelationshipIdentities(entity, matches);
        if (relationshipMatches.length > 0) matches = relationshipMatches;
      }
    }
    if (matches.length === 0) {
      const relationshipKey = relationshipIdentityIndexKey(entity);
      matches = relationshipKey
        ? availableCandidates(entity, relationshipIndex.get(relationshipKey) ?? [])
        : [];
    }

    if (matches.length === 1) {
      assign(entity, matches[0].localEntityId);
      continue;
    }
    if (matches.length > 1) {
      ambiguous.set(key, uniqueStrings(matches.map((candidate) => candidate.localEntityId)));
    }
    localIds.set(
      key,
      stableLocalId(connectionId, entity.entityType, fallbackIdentitySeed(entity))
    );
  }
  return { localIds, ambiguous };
}

/**
 * Provider identifiers repeated across several incoming records (a shared
 * REFN batch number, a duplicated source `_APID`, a copied `_UID`) identify a
 * catalog entry, not one record. Seeding distinct incoming records from such a
 * value would collapse them onto a single local entity.
 */
function duplicatedProviderIds(incoming: IdentityDescriptor[]): Set<string> {
  const seenOnce = new Set<string>();
  const duplicated = new Set<string>();
  for (const entity of incoming) {
    for (const providerId of entity.providerIds ?? []) {
      const key = `${entity.entityType}:${providerId}`;
      if (seenOnce.has(key)) duplicated.add(key);
      else seenOnce.add(key);
    }
  }
  return duplicated;
}

/** @internal Pure scale/regression seam for the connection-scoped matcher. */
export function resolveIntegrationIdentitiesForTest(input: {
  incoming: IntegrationIdentityTestEntity[];
  base: Array<IntegrationIdentityTestEntity & { localEntityId: string; incomingHash: string }>;
  rememberedRefs?: Record<string, string>;
  connectionId: string;
}): { localIds: Record<string, string>; ambiguous: Record<string, string[]> } {
  const result = resolveEntityIdentities(
    input.incoming as IdentityDescriptor[],
    input.base as SnapshotEntity[],
    input.connectionId,
    new Map(Object.entries(input.rememberedRefs ?? {}))
  );
  return {
    localIds: Object.fromEntries(result.localIds),
    ambiguous: Object.fromEntries(result.ambiguous)
  };
}

function addToEntityIndex(
  index: Map<string, SnapshotEntity[]>,
  key: string,
  entity: SnapshotEntity
): void {
  index.set(key, [...(index.get(key) ?? []), entity]);
}

function uniqueSnapshotEntities(entities: SnapshotEntity[]): SnapshotEntity[] {
  const byLocalId = new Map<string, SnapshotEntity>();
  for (const entity of entities) byLocalId.set(entity.localEntityId, entity);
  return [...byLocalId.values()];
}

function relationshipIdentityIndexKey(
  entity: Pick<SnapshotEntity, "entityType" | "relativeIdentityKeys">
): string | undefined {
  const relatives = entity.relativeIdentityKeys ?? [];
  return entity.entityType === "person" && relatives.length > 0
    ? `${entity.entityType}:${relatives.join("\u001f")}`
    : undefined;
}

function hasConflictingProviderIds(
  incoming: Pick<IdentityDescriptor, "providerIds">,
  candidate: Pick<SnapshotEntity, "providerIds">
): boolean {
  const incomingIds = incoming.providerIds ?? [];
  const candidateIds = candidate.providerIds ?? [];
  return incomingIds.length > 0
    && candidateIds.length > 0
    && !hasSharedValue(incomingIds, candidateIds);
}

function narrowIdentityMatches(entity: IdentityDescriptor, candidates: SnapshotEntity[]): SnapshotEntity[] {
  if (!entity.identityKey) return candidates;
  const identityMatches = candidates.filter((candidate) => candidate.identityKey === entity.identityKey);
  if (identityMatches.length === 0) return candidates;
  if (identityMatches.length === 1) return identityMatches;
  const relationshipMatches = matchingRelationshipIdentities(entity, identityMatches);
  return relationshipMatches.length > 0 ? relationshipMatches : identityMatches;
}

function matchingRelationshipIdentities(
  entity: IdentityDescriptor,
  candidates: SnapshotEntity[]
): SnapshotEntity[] {
  const relativeIdentityKeys = entity.relativeIdentityKeys ?? [];
  if (entity.entityType !== "person" || relativeIdentityKeys.length === 0) return [];
  return candidates.filter((candidate) =>
    equalStringArrays(relativeIdentityKeys, candidate.relativeIdentityKeys ?? [])
  );
}

function buildEntityManifest(
  prepared: PreparedGedcomImport,
  identities: IdentityDescriptor[],
  extensionHashes: Map<string, string> = new Map()
): SnapshotEntity[] {
  const personIdentities = identities.filter((identity) => identity.entityType === "person");
  const sourceIdentities = identities.filter((identity) => identity.entityType === "source");
  return [
    ...prepared.people.map((person, index) => ({
      ...personIdentities[index],
      entityType: "person" as const,
      externalId: personIdentities[index]?.externalId ?? `person-${index + 1}`,
      localEntityId: person.id,
      incomingHash: personHash(
        person,
        extensionHashes.get(entityKey({
          entityType: "person",
          externalId: personIdentities[index]?.externalId ?? `person-${index + 1}`
        }))
      )
    })),
    ...prepared.sources.map((source, index) => ({
      ...sourceIdentities[index],
      entityType: "source" as const,
      externalId: sourceIdentities[index]?.externalId ?? source.ancestryApid ?? `source-${index + 1}`,
      localEntityId: source.id,
      incomingHash: sourceHash(
        source,
        extensionHashes.get(entityKey({
          entityType: "source",
          externalId: sourceIdentities[index]?.externalId ?? source.ancestryApid ?? `source-${index + 1}`
        }))
      )
    }))
  ];
}

function buildNormalizedIntegrationData(
  entities: NormalizedGedcomEntity[],
  connectionId: string,
  prepared: PreparedGedcomImport,
  identities: IdentityDescriptor[],
  localIdOverrides: Map<string, string> = new Map()
): NormalizedIntegrationData {
  const personIdentities = identities.filter((identity) => identity.entityType === "person");
  const sourceIdentities = identities.filter((identity) => identity.entityType === "source");
  const peopleByExternalId = new Map(
    prepared.people.map((person, index) => [personIdentities[index]?.externalId, person] as const)
      .filter((entry): entry is [string, PersonSummary] => Boolean(entry[0]))
  );
  const sourceIdsByExternalId = new Map(
    prepared.sources.map((source, index) => [sourceIdentities[index]?.externalId, source.id] as const)
      .filter((entry): entry is [string, string] => Boolean(entry[0]))
  );
  const localIds = buildNormalizedLocalIds(
    entities,
    connectionId,
    peopleByExternalId,
    localIdOverrides
  );
  const factEntitiesByOwner = groupNormalizedByOwner(entities.filter((entity) => entity.entityType === "fact"));
  const factIdsByExternalId = new Map(
    entities
      .filter((entity) => entity.entityType === "fact")
      .map((entity) => [
        entity.externalId,
        localIds.get(normalizedEntityKey("fact", entity.externalId))!
      ])
  );

  const people: PersonSummary[] = prepared.people.map((person, personIndex) => {
    const externalId = personIdentities[personIndex]?.externalId;
    const normalizedFacts = externalId ? factEntitiesByOwner.get(externalId) ?? [] : [];
    const facts = person.facts.map((fact, factIndex) => {
      const entity = normalizedFacts[factIndex];
      const id = entity
        ? localIds.get(normalizedEntityKey("fact", entity.externalId))!
        : stableLocalId(connectionId, "fact", `${externalId ?? person.id}:fact:${factIndex + 1}`);
      return {
        ...fact,
        id,
        source: fact.source ? sourceIdsByExternalId.get(fact.source) ?? fact.source : undefined
      };
    });
    return { ...person, facts };
  });
  const preparedPeopleByExternalId = new Map(
    people.map((person, index) => [personIdentities[index]?.externalId, person] as const)
      .filter((entry): entry is [string, PersonSummary] => Boolean(entry[0]))
  );
  const primaryCitationIds = new Set<string>();
  const citationsByFact = groupNormalizedByFact(entities.filter((entity) => entity.entityType === "citation"));
  for (const citations of citationsByFact.values()) {
    if (citations[0]) primaryCitationIds.add(citations[0].externalId);
  }

  const values = new Map<string, Record<string, unknown>>();
  const manifest = entities.map((entity) => {
    const localEntityId = localIds.get(normalizedEntityKey(entity.entityType, entity.externalId))!;
    const value = normalizedSnapshotValue({
      entity,
      peopleByExternalId: preparedPeopleByExternalId,
      sourceIdsByExternalId,
      localIds,
      factIdsByExternalId,
      primaryCitationIds
    });
    const retainedExtensionHash = hashRetainedGedcomExtensions(entity.raw, {
      excludeRootChildTags: entity.entityType === "fact" ? ["SOUR"] : []
    });
    const semanticValue = retainedExtensionHash
      ? { ...value, retainedExtensionHash }
      : value;
    const key = normalizedEntityKey(entity.entityType, entity.externalId);
    values.set(
      key,
      entity.entityType === "relationship" ? semanticValue : { ...semanticValue, raw: entity.raw }
    );
    return {
      entityType: entity.entityType,
      externalId: entity.externalId,
      localEntityId,
      incomingHash: entityValueHash(entity.entityType, semanticValue)
    };
  });

  return {
    prepared: { ...prepared, people },
    manifest,
    values
  };
}

function buildNormalizedLocalIds(
  entities: NormalizedGedcomEntity[],
  connectionId: string,
  peopleByExternalId: Map<string, PersonSummary>,
  overrides: Map<string, string> = new Map()
): Map<string, string> {
  const localIds = new Map(overrides);
  const stablePersonId = (externalId: string) => peopleByExternalId.get(externalId)?.id ?? externalId;

  for (const entity of entities.filter((candidate) => candidate.entityType === "fact")) {
    const key = normalizedEntityKey(entity.entityType, entity.externalId);
    if (localIds.has(key)) continue;
    const ownerExternalId = entity.ownerExternalId ?? stringValue(entity.value.personExternalId);
    const ownerId = stablePersonId(ownerExternalId);
    const slot = externalIdRelativeToOwner(entity.externalId, ownerExternalId);
    localIds.set(
      key,
      stableLocalId(connectionId, entity.entityType, canonicalJson({ ownerId, slot }))
    );
  }

  const familyOccurrences = new Map<string, number>();
  for (const entity of entities.filter((candidate) => candidate.entityType === "family")) {
    const parents = stringArray(entity.value.parents).map(stablePersonId).sort();
    const children = stringArray(entity.value.children).map(stablePersonId).sort();
    // A child arriving or disappearing is a change to an existing family, not
    // a new family identity. Parent members are therefore the primary owner
    // structure; child members are the fallback for parentless family records.
    const structure = canonicalJson(parents.length > 0 ? { parents } : { children });
    const occurrence = (familyOccurrences.get(structure) ?? 0) + 1;
    familyOccurrences.set(structure, occurrence);
    localIds.set(
      normalizedEntityKey(entity.entityType, entity.externalId),
      stableLocalId(connectionId, entity.entityType, canonicalJson({ structure, occurrence }))
    );
  }

  for (const entity of entities.filter((candidate) => candidate.entityType === "relationship")) {
    const type = stringValue(entity.value.type);
    const fromPersonId = stablePersonId(stringValue(entity.value.fromPersonExternalId));
    const toPersonId = stablePersonId(stringValue(entity.value.toPersonExternalId));
    const endpoints = type === "spouse"
      ? [fromPersonId, toPersonId].sort()
      : [fromPersonId, toPersonId];
    const familyExternalId = stringValue(entity.value.familyExternalId);
    const familyId = localIds.get(normalizedEntityKey("family", familyExternalId)) ?? familyExternalId;
    localIds.set(
      normalizedEntityKey(entity.entityType, entity.externalId),
      stableLocalId(connectionId, entity.entityType, canonicalJson({ familyId, type, endpoints }))
    );
  }

  for (const entity of entities.filter((candidate) => candidate.entityType === "citation")) {
    const ownerExternalId = entity.ownerExternalId ?? "";
    const ownerId = localIds.get(normalizedEntityKey("fact", ownerExternalId))
      ?? peopleByExternalId.get(ownerExternalId)?.id
      ?? ownerExternalId;
    const slot = externalIdRelativeToOwner(entity.externalId, ownerExternalId);
    localIds.set(
      normalizedEntityKey(entity.entityType, entity.externalId),
      stableLocalId(connectionId, entity.entityType, canonicalJson({ ownerId, slot }))
    );
  }

  const mediaOccurrences = new Map<string, number>();
  for (const entity of entities.filter((candidate) => candidate.entityType === "media")) {
    const structure = canonicalJson({
      linkedPersonIds: stringArray(entity.value.linkedPersonExternalIds).map(stablePersonId).sort(),
      file: entity.value.file ?? null,
      format: entity.value.format ?? null,
      title: entity.value.title ?? null
    });
    const occurrence = (mediaOccurrences.get(structure) ?? 0) + 1;
    mediaOccurrences.set(structure, occurrence);
    localIds.set(
      normalizedEntityKey(entity.entityType, entity.externalId),
      stableLocalId(connectionId, entity.entityType, canonicalJson({ structure, occurrence }))
    );
  }

  return localIds;
}

function reconcileFactLocalIds(
  entities: NormalizedGedcomEntity[],
  connectionId: string,
  prepared: PreparedGedcomImport,
  identities: IdentityDescriptor[],
  baseManifest: SnapshotEntity[],
  baseValues: Map<string, Record<string, unknown>>
): Map<string, string> {
  const personIdentities = identities.filter((identity) => identity.entityType === "person");
  const peopleByExternalId = new Map(
    prepared.people.map((person, index) => [personIdentities[index]?.externalId, person] as const)
      .filter((entry): entry is [string, PersonSummary] => Boolean(entry[0]))
  );
  const defaultLocalIds = buildNormalizedLocalIds(entities, connectionId, peopleByExternalId);
  const baseFacts = baseManifest.filter((entity) => entity.entityType === "fact");
  const baseByLocalId = new Map(baseFacts.map((entity) => [entity.localEntityId, entity]));
  const matchedBaseLocalIds = new Set<string>();
  const incomingByOwnerAndType = new Map<string, NormalizedGedcomEntity[]>();

  for (const entity of entities.filter((candidate) => candidate.entityType === "fact")) {
    const key = normalizedEntityKey(entity.entityType, entity.externalId);
    const defaultLocalId = defaultLocalIds.get(key)!;
    if (baseByLocalId.has(defaultLocalId)) {
      matchedBaseLocalIds.add(defaultLocalId);
      continue;
    }
    const ownerExternalId = entity.ownerExternalId ?? stringValue(entity.value.personExternalId);
    const ownerId = peopleByExternalId.get(ownerExternalId)?.id ?? ownerExternalId;
    const groupKey = canonicalJson({ ownerId, type: entity.value.type ?? null });
    incomingByOwnerAndType.set(groupKey, [
      ...(incomingByOwnerAndType.get(groupKey) ?? []),
      entity
    ]);
  }

  const baseByOwnerAndType = new Map<string, SnapshotEntity[]>();
  for (const base of baseFacts) {
    if (matchedBaseLocalIds.has(base.localEntityId)) continue;
    const value = baseValues.get(entityKey(base));
    const ownerId = optionalStringValue(value?.personId);
    if (!ownerId) continue;
    const groupKey = canonicalJson({ ownerId, type: value?.type ?? null });
    baseByOwnerAndType.set(groupKey, [...(baseByOwnerAndType.get(groupKey) ?? []), base]);
  }

  const overrides = new Map<string, string>();
  for (const [groupKey, incoming] of incomingByOwnerAndType) {
    const bases = baseByOwnerAndType.get(groupKey) ?? [];
    if (incoming.length !== 1 || bases.length !== 1) continue;
    overrides.set(
      normalizedEntityKey("fact", incoming[0].externalId),
      bases[0].localEntityId
    );
  }
  return overrides;
}

function externalIdRelativeToOwner(externalId: string, ownerExternalId: string): string {
  const prefix = ownerExternalId ? `${ownerExternalId}:` : "";
  return prefix && externalId.startsWith(prefix) ? externalId.slice(prefix.length) : externalId;
}

function normalizedSnapshotValue(input: {
  entity: NormalizedGedcomEntity;
  peopleByExternalId: Map<string, PersonSummary>;
  sourceIdsByExternalId: Map<string, string>;
  localIds: Map<string, string>;
  factIdsByExternalId: Map<string, string>;
  primaryCitationIds: Set<string>;
}): Record<string, unknown> {
  const { entity } = input;
  const value = entity.value;
  if (entity.entityType === "fact") {
    const person = input.peopleByExternalId.get(stringValue(value.personExternalId));
    const fact = person?.facts.find((candidate) => candidate.id === input.factIdsByExternalId.get(entity.externalId));
    return fact && person
      ? factSnapshotValue(person.id, fact)
      : {
          personId: person?.id ?? null,
          type: value.type ?? null,
          date: value.date ?? null,
          place: value.place ?? null,
          value: value.value ?? null,
          privacy: value.privacy ?? "private",
          confidence: null
        };
  }
  if (entity.entityType === "family") {
    return {
      parents: stringArray(value.parents).map((id) => input.peopleByExternalId.get(id)?.id ?? id),
      children: stringArray(value.children).map((id) => input.peopleByExternalId.get(id)?.id ?? id)
    };
  }
  if (entity.entityType === "relationship") {
    const familyExternalId = stringValue(value.familyExternalId);
    return {
      type: value.type ?? null,
      fromPersonId: input.peopleByExternalId.get(stringValue(value.fromPersonExternalId))?.id ?? null,
      toPersonId: input.peopleByExternalId.get(stringValue(value.toPersonExternalId))?.id ?? null,
      familyId: familyExternalId
        ? input.localIds.get(normalizedEntityKey("family", familyExternalId)) ?? null
        : null
    };
  }
  if (entity.entityType === "citation") {
    const factExternalId = optionalStringValue(value.factExternalId);
    const sourceExternalId = optionalStringValue(value.sourceExternalId);
    return {
      personId: input.peopleByExternalId.get(stringValue(value.personExternalId))?.id ?? null,
      factId: factExternalId ? input.factIdsByExternalId.get(factExternalId) ?? null : null,
      sourceId: sourceExternalId ? input.sourceIdsByExternalId.get(sourceExternalId) ?? sourceExternalId : null,
      sourceText: value.sourceText ?? null,
      page: value.page ?? null,
      dataDate: value.dataDate ?? null,
      text: value.text ?? null,
      note: value.note ?? null,
      privacy: value.privacy ?? "private",
      canonicalLinkSupported: Boolean(factExternalId && input.primaryCitationIds.has(entity.externalId))
    };
  }
  if (entity.entityType === "media") {
    const { linkedPersonExternalIds: _linkedPersonExternalIds, ...mediaValue } = value;
    void _linkedPersonExternalIds;
    return {
      ...mediaValue,
      linkedPersonIds: stringArray(value.linkedPersonExternalIds)
        .map((id) => input.peopleByExternalId.get(id)?.id ?? id)
    };
  }
  return { ...value };
}

function groupNormalizedByOwner(entities: NormalizedGedcomEntity[]): Map<string, NormalizedGedcomEntity[]> {
  const grouped = new Map<string, NormalizedGedcomEntity[]>();
  for (const entity of entities) {
    if (!entity.ownerExternalId) continue;
    grouped.set(entity.ownerExternalId, [...(grouped.get(entity.ownerExternalId) ?? []), entity]);
  }
  return grouped;
}

function groupNormalizedByFact(entities: NormalizedGedcomEntity[]): Map<string, NormalizedGedcomEntity[]> {
  const grouped = new Map<string, NormalizedGedcomEntity[]>();
  for (const entity of entities) {
    const factExternalId = optionalStringValue(entity.value.factExternalId);
    if (!factExternalId) continue;
    grouped.set(factExternalId, [...(grouped.get(factExternalId) ?? []), entity]);
  }
  return grouped;
}

function buildEntityValues(
  prepared: PreparedGedcomImport,
  manifest: SnapshotEntity[],
  normalizedValues: Map<string, Record<string, unknown>> = new Map(),
  extensionHashes: Map<string, string> = new Map()
): Map<string, Record<string, unknown>> {
  const values = new Map(normalizedValues);
  const people = manifest.filter((entity) => entity.entityType === "person");
  const sources = manifest.filter((entity) => entity.entityType === "source");
  prepared.people.forEach((person, index) => {
    if (people[index]) {
      const key = entityKey(people[index]);
      values.set(key, personReviewValue(person, extensionHashes.get(key)));
    }
  });
  prepared.sources.forEach((source, index) => {
    if (sources[index]) {
      const key = entityKey(sources[index]);
      values.set(key, sourceReviewValue(source, extensionHashes.get(key)));
    }
  });
  return values;
}

function buildPrimaryExtensionHashes(
  prepared: PreparedGedcomImport,
  identities: IdentityDescriptor[]
): Map<string, string> {
  const hashes = new Map<string, string>();
  const personIdentities = identities.filter((identity) => identity.entityType === "person");
  const sourceIdentities = identities.filter((identity) => identity.entityType === "source");
  const personRecords = prepared.rawRecords.filter((record) => record.type === "INDI");
  const sourceRecords = prepared.rawRecords.filter((record) => record.type === "SOUR");
  personRecords.forEach((record, index) => {
    const identity = personIdentities[index];
    if (!identity) return;
    const digest = hashRetainedGedcomExtensions(record.raw, {
      excludeRootChildTags: personOwnedNormalizedSubtrees
    });
    if (digest) hashes.set(entityKey(identity), digest);
  });
  sourceRecords.forEach((record, index) => {
    const identity = sourceIdentities[index];
    if (!identity) return;
    const digest = hashRetainedGedcomExtensions(record.raw);
    if (digest) hashes.set(entityKey(identity), digest);
  });
  return hashes;
}

function snapshotEntityValues(snapshot: IntegrationSnapshot | undefined): Map<string, Record<string, unknown>> {
  const metadata = snapshot?.sourceMetadata as SnapshotSourceMetadata | undefined;
  if (!isRecord(metadata?.entityValues)) return new Map();
  return new Map(
    Object.entries(metadata.entityValues)
      .filter((entry): entry is [string, Record<string, unknown>] => isRecord(entry[1]))
  );
}

function localEntityValue(
  entityType: EntityType,
  localEntityId: string,
  workspace: Awaited<ReturnType<typeof readWorkspace>>,
  template: Record<string, unknown> | null = null,
  baseTemplate: Record<string, unknown> | null = null
): Record<string, unknown> | null {
  if (entityType === "person") {
    const person = workspace.people.find((candidate) => candidate.id === localEntityId);
    return person
      ? personReviewValue(person, inheritedRetainedExtensionHash(baseTemplate, template))
      : null;
  }
  if (entityType === "source") {
    const source = workspace.sources.find((candidate) => candidate.id === localEntityId);
    return source
      ? sourceReviewValue(source, inheritedRetainedExtensionHash(baseTemplate, template))
      : null;
  }
  if (entityType === "fact") {
    const located = findWorkspaceFact(workspace.people, localEntityId);
    return located
      ? {
          ...factSnapshotValue(located.person.id, located.fact),
          ...(inheritedRetainedExtensionHash(baseTemplate, template)
            ? { retainedExtensionHash: inheritedRetainedExtensionHash(baseTemplate, template) }
            : {}),
          raw: baseTemplate?.raw ?? template?.raw
        }
      : null;
  }
  if (entityType === "relationship") {
    if (!template) return null;
    const fromPersonId = optionalStringValue(template.fromPersonId);
    const toPersonId = optionalStringValue(template.toPersonId);
    if (!fromPersonId || !toPersonId || !workspaceRelationshipExists(workspace.people, fromPersonId, toPersonId)) {
      return null;
    }
    return { ...template, raw: baseTemplate?.raw ?? template.raw };
  }
  if (entityType === "citation") {
    const canonicalTemplate = baseTemplate ?? template;
    if (!canonicalTemplate) return null;
    if (canonicalTemplate.canonicalLinkSupported !== true) return baseTemplate;
    const factId = optionalStringValue(canonicalTemplate.factId);
    const located = factId ? findWorkspaceFact(workspace.people, factId) : undefined;
    if (!located) return null;
    return {
      ...canonicalTemplate,
      sourceId: located.fact.source ?? null,
      sourceText: null,
      raw: baseTemplate?.raw ?? template?.raw
    };
  }
  // Family and media records are immutable review/audit entities in this
  // release. Once applied, the last snapshot is their local comparison state.
  return baseTemplate;
}

function personReviewValue(
  person: PersonSummary,
  retainedExtensionHash?: string
): Record<string, unknown> {
  return {
    displayName: person.displayName,
    givenName: person.givenName ?? null,
    surname: person.surname ?? null,
    birthDate: person.birthDate ?? null,
    birthPlace: person.birthPlace ?? null,
    deathDate: person.deathDate ?? null,
    deathPlace: person.deathPlace ?? null,
    sex: person.sex ?? null,
    notes: person.notes ?? null,
    ...(retainedExtensionHash ? { retainedExtensionHash } : {})
  };
}

function sourceReviewValue(
  source: SourceDocument,
  retainedExtensionHash?: string
): Record<string, unknown> {
  return {
    title: source.title,
    sourceType: source.sourceType,
    repository: source.repository ?? null,
    url: source.url ?? null,
    ancestryApid: source.ancestryApid ?? null,
    citationDate: source.citationDate ?? null,
    linkedPersonId: source.linkedPersonId ?? null,
    transcript: source.transcript ?? null,
    notes: source.notes ?? null,
    ...(retainedExtensionHash ? { retainedExtensionHash } : {})
  };
}

function inheritedRetainedExtensionHash(
  baseTemplate: Record<string, unknown> | null,
  incomingTemplate: Record<string, unknown> | null
): string | undefined {
  return optionalStringValue(baseTemplate?.retainedExtensionHash)
    ?? optionalStringValue(incomingTemplate?.retainedExtensionHash);
}

function snapshotManifest(snapshot: IntegrationSnapshot | undefined): SnapshotEntity[] {
  const metadata = snapshot?.sourceMetadata as SnapshotSourceMetadata | undefined;
  if (!Array.isArray(metadata?.entityManifest)) return [];
  return metadata.entityManifest.filter(isSnapshotEntity);
}

function isSnapshotEntity(value: unknown): value is SnapshotEntity {
  if (!isRecord(value)) return false;
  return isEntityType(value.entityType)
    && typeof value.externalId === "string"
    && typeof value.localEntityId === "string"
    && typeof value.incomingHash === "string"
    && optionalStringArray(value.providerIds)
    && optionalStringArray(value.relativeIdentityKeys)
    && (value.identityKey === undefined || typeof value.identityKey === "string");
}

function isEntityType(value: unknown): value is EntityType {
  return value === "person"
    || value === "source"
    || value === "family"
    || value === "fact"
    || value === "relationship"
    || value === "citation"
    || value === "media";
}

function personIdentityKey(person: PersonSummary): string {
  return hashJson({
    displayName: normalizeIdentityValue(person.displayName),
    givenName: normalizeIdentityValue(person.givenName),
    surname: normalizeIdentityValue(person.surname),
    birthDate: normalizeIdentityValue(person.birthDate),
    birthPlace: normalizeIdentityValue(person.birthPlace),
    deathDate: normalizeIdentityValue(person.deathDate),
    deathPlace: normalizeIdentityValue(person.deathPlace),
    sex: person.sex ?? null
  });
}

function sourceIdentityKey(source: SourceDocument): string {
  return hashJson({
    title: normalizeIdentityValue(source.title),
    repository: normalizeIdentityValue(source.repository),
    url: normalizeIdentityValue(source.url)
  });
}

function providerIdsFromRecord(raw: string | undefined): string[] {
  if (!raw) return [];
  const stableTags = new Set(["_APID", "_FSFTID", "_UID", "RIN", "REFN"]);
  const values: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^1\s+([^\s]+)\s+(.+)$/);
    if (!match || !stableTags.has(match[1].toUpperCase())) continue;
    const value = normalizeIdentityValue(match[2]);
    if (value) values.push(`${match[1].toUpperCase()}:${value}`);
  }
  return uniqueStrings(values);
}

function normalizeIdentityValue(value: string | undefined): string | null {
  const normalized = value?.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
  return normalized || null;
}

function hasSharedValue(left: string[], right: string[]): boolean {
  const rightValues = new Set(right);
  return left.some((value) => rightValues.has(value));
}

function equalStringArrays(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function uniqueStringsPreservingOrder(values: Iterable<string>): string[] {
  return [...new Set(values)];
}

function normalizedEntityKey(entityType: NormalizedGedcomEntityType, externalId: string): string {
  return `${entityType}:${externalId}`;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function optionalStringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function summarizeIncomingPrivacy(people: PersonSummary[]): Record<string, number> {
  return {
    living: people.filter((person) => person.livingStatus === "living").length,
    deceased: people.filter((person) => person.livingStatus === "deceased").length,
    unknownLivingStatus: people.filter((person) => person.livingStatus === "unknown").length,
    public: people.filter((person) => person.privacy === "public").length,
    private: people.filter((person) => person.privacy === "private").length,
    sensitive: people.filter((person) => person.privacy === "sensitive").length
  };
}

function optionalStringArray(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.every((item) => typeof item === "string"));
}

function entityValueHash(entityType: EntityType, value: Record<string, unknown>): string {
  if (entityType === "person" || entityType === "source") return hashJson(value);
  const { raw: _raw, ...semantic } = value;
  void _raw;
  return sha256(canonicalJson(semantic));
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    ).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function factSnapshotValue(personId: string, fact: PersonFact): Record<string, unknown> {
  return {
    personId,
    type: fact.type,
    date: fact.date ?? null,
    place: fact.place ?? null,
    value: fact.value ?? null,
    privacy: fact.privacy ?? "private",
    confidence: fact.confidence
  };
}

function findWorkspaceFact(
  people: PersonSummary[],
  factId: string
): { person: PersonSummary; fact: PersonFact } | undefined {
  for (const person of people) {
    const fact = person.facts.find((candidate) => candidate.id === factId);
    if (fact) return { person, fact };
  }
  return undefined;
}

function workspaceRelationshipExists(people: PersonSummary[], leftId: string, rightId: string): boolean {
  const left = people.find((person) => person.id === leftId);
  const right = people.find((person) => person.id === rightId);
  return Boolean(left?.relatives.includes(rightId) && right?.relatives.includes(leftId));
}

function personHash(person: PersonSummary, retainedExtensionHash?: string): string {
  return hashJson(personReviewValue(person, retainedExtensionHash));
}

function sourceHash(source: SourceDocument, retainedExtensionHash?: string): string {
  return hashJson(sourceReviewValue(source, retainedExtensionHash));
}

function resolvedPreparedImport(
  prepared: PreparedGedcomImport,
  changes: SyncChange[],
  requested: Map<string, SyncResolutionInput>,
  workspace: Awaited<ReturnType<typeof readWorkspace>>,
  currentValues: Map<string, Record<string, unknown>>,
  selectedIdentityIds: Map<string, string>
): PreparedGedcomImport {
  const incomingPeople = new Map(prepared.people.map((person) => [person.id, person]));
  const incomingSources = new Map(prepared.sources.map((source) => [source.id, source]));
  const localPeople = new Map(workspace.people.map((person) => [person.id, person]));
  const localSources = new Map(workspace.sources.map((source) => [source.id, source]));
  const selectedPeople = new Map<string, PersonSummary>();
  const selectedSources = new Map<string, SourceDocument>();
  const resolvedParentPeople = new Map<string, PersonSummary>();

  for (const change of changes) {
    if (!change.localEntityId || (change.entityType !== "person" && change.entityType !== "source")) continue;
    const request = requested.get(change.id);
    const resolution = requestedResolution(request) ?? defaultResolution(change);
    if (!resolution) {
      throw integrationProcessingError("RESOLUTION_REQUIRED", `Sync change ${change.id} requires review`);
    }
    const fields = requestedFields(request, change.entityType);
    const localEntityId = selectedIdentityIds.get(change.localEntityId) ?? change.localEntityId;

    if (change.entityType === "person") {
      const incoming = incomingPeople.get(localEntityId);
      const local = localPeople.get(localEntityId);
      if (change.classification === "deletion") {
        if (local) resolvedParentPeople.set(localEntityId, local);
        continue;
      }
      if (!incoming) continue;
      const resolved = resolveEntityFields(
        incoming,
        local,
        resolution,
        fields
      );
      const parent = resolved
        ? mergeLocalNestedCuration(resolved, localPeople.get(resolved.id))
        : resolution === "keep_local" || resolution === "no_op"
          ? local
          : undefined;
      if (parent) resolvedParentPeople.set(parent.id, parent);
      if (resolved && parent) selectedPeople.set(parent.id, parent);
      continue;
    }
    if (change.classification === "deletion") continue;
    const incoming = incomingSources.get(localEntityId);
    if (!incoming) continue;
    const resolved = resolveEntityFields(
      incoming,
      localSources.get(localEntityId),
      resolution,
      fields
    );
    if (resolved) selectedSources.set(resolved.id, resolved);
  }

  const ensurePerson = (personId: string): PersonSummary | undefined => {
    const existing = selectedPeople.get(personId);
    if (existing) return existing;
    const resolvedParent = resolvedParentPeople.get(personId);
    if (resolvedParent) {
      selectedPeople.set(personId, resolvedParent);
      return resolvedParent;
    }
    const incoming = incomingPeople.get(personId);
    const local = localPeople.get(personId);
    const selected = incoming ? mergeLocalNestedCuration(incoming, local) : local;
    if (selected) selectedPeople.set(personId, selected);
    return selected;
  };

  for (const change of changes.filter((candidate) => candidate.entityType === "fact")) {
    const request = requested.get(change.id);
    rejectNestedFieldResolutions(request, change);
    const resolution = requiredNestedResolution(change, request);
    const incomingValue = currentValues.get(changeExternalKey(change));
    const fallbackValue = changeResolutionValue(change, "base") ?? changeResolutionValue(change, "local");
    const value = incomingValue ?? fallbackValue;
    const factId = change.localEntityId;
    if (!factId || !value) continue;
    const incomingLocated = findWorkspaceFact(prepared.people, factId);
    const localLocated = findWorkspaceFact(workspace.people, factId);
    const ownerId = optionalStringValue(value.personId)
      ?? incomingLocated?.person.id
      ?? localLocated?.person.id;
    if (!ownerId) continue;
    const ownerAlreadySelected = selectedPeople.has(ownerId);
    if (!ownerAlreadySelected && resolution !== "accept_incoming" && change.classification !== "deletion") continue;
    const person = ensurePerson(ownerId);
    if (!person) continue;
    const facts = new Map(person.facts.map((fact) => [fact.id, fact]));
    if (resolution === "accept_incoming" && incomingLocated) {
      facts.set(factId, preserveFactCuration(incomingLocated.fact, localLocated?.fact));
    } else if (localLocated) {
      // Deletions always keep the local fact. A nested keep-local decision is
      // applied after any parent accept so the parent cannot overwrite it.
      facts.set(factId, localLocated.fact);
    } else {
      facts.delete(factId);
    }
    selectedPeople.set(ownerId, { ...person, facts: orderedFacts(facts, incomingLocated?.person, localLocated?.person) });
  }

  for (const change of changes.filter((candidate) => candidate.entityType === "relationship")) {
    const request = requested.get(change.id);
    rejectNestedFieldResolutions(request, change);
    const resolution = requiredNestedResolution(change, request);
    const incomingValue = currentValues.get(changeExternalKey(change));
    const value = incomingValue
      ?? changeResolutionValue(change, "base")
      ?? changeResolutionValue(change, "local");
    if (!value) continue;
    const fromPersonId = remappedId(optionalStringValue(value.fromPersonId), selectedIdentityIds);
    const toPersonId = remappedId(optionalStringValue(value.toPersonId), selectedIdentityIds);
    if (!fromPersonId || !toPersonId) continue;
    const parentSelected = selectedPeople.has(fromPersonId) || selectedPeople.has(toPersonId);
    if (!parentSelected && resolution !== "accept_incoming" && change.classification !== "deletion") continue;
    const localExists = workspaceRelationshipExists(workspace.people, fromPersonId, toPersonId);
    const shouldExist = change.classification === "deletion"
      ? localExists
      : resolution === "accept_incoming" || localExists;
    const from = ensurePerson(fromPersonId);
    const to = ensurePerson(toPersonId);
    if (!from || !to) continue;
    selectedPeople.set(fromPersonId, withRelative(from, toPersonId, shouldExist));
    selectedPeople.set(toPersonId, withRelative(to, fromPersonId, shouldExist));
  }

  for (const change of changes.filter((candidate) => candidate.entityType === "citation")) {
    const request = requested.get(change.id);
    rejectNestedFieldResolutions(request, change);
    const resolution = requiredNestedResolution(change, request);
    const incomingValue = currentValues.get(changeExternalKey(change));
    const localValue = changeResolutionValue(change, "local");
    const baseValue = changeResolutionValue(change, "base");
    const value = incomingValue ?? baseValue ?? localValue;
    if (!value || value.canonicalLinkSupported !== true) continue;
    const factId = optionalStringValue(value.factId);
    if (!factId) continue;
    const selectedLocated = findWorkspaceFact([...selectedPeople.values()], factId);
    const incomingLocated = findWorkspaceFact(prepared.people, factId);
    const localLocated = findWorkspaceFact(workspace.people, factId);
    const ownerId = selectedLocated?.person.id ?? incomingLocated?.person.id ?? localLocated?.person.id;
    if (!ownerId) continue;
    const ownerAlreadySelected = selectedPeople.has(ownerId);
    if (!ownerAlreadySelected && resolution !== "accept_incoming" && change.classification !== "deletion") continue;
    const person = ensurePerson(ownerId);
    if (!person) continue;
    const facts = new Map(person.facts.map((fact) => [fact.id, fact]));
    const fact = facts.get(factId) ?? incomingLocated?.fact ?? localLocated?.fact;
    if (!fact) continue;
    const source = resolution === "accept_incoming" && change.classification !== "deletion"
      ? citationSource(incomingValue)
      : localLocated?.fact.source;
    facts.set(factId, { ...fact, source });
    selectedPeople.set(ownerId, { ...person, facts: orderedFacts(facts, incomingLocated?.person, localLocated?.person) });
  }

  const people = [...selectedPeople.values()];
  const sources = [...selectedSources.values()];

  return {
    ...prepared,
    people,
    sources,
    appliedImport: {
      ...prepared.appliedImport,
      peopleImported: people.length,
      sourcesImported: sources.length
    }
  };
}

function selectedIdentityRemap(
  changes: SyncChange[],
  requested: Map<string, SyncResolutionInput>
): Map<string, string> {
  const remap = new Map<string, string>();
  for (const change of changes) {
    if (!change.localEntityId || (change.entityType !== "person" && change.entityType !== "source")) continue;
    const candidates = change.resolutionPayload.ambiguousLocalEntityIds;
    if (!Array.isArray(candidates) || !candidates.every((candidate) => typeof candidate === "string")) continue;
    const request = requested.get(change.id) as (SyncResolutionInput & { localEntityId?: string }) | undefined;
    const resolution = requestedResolution(request);
    if (resolution !== "accept_incoming") continue;
    const selected = request?.localEntityId?.trim();
    if (!selected || !candidates.includes(selected)) {
      throw integrationProcessingError("INVALID_INPUT", "Ambiguous incoming identity requires a reviewed local entity");
    }
    remap.set(change.localEntityId, selected);
  }
  return remap;
}

function mergeLocalNestedCuration(incoming: PersonSummary, local: PersonSummary | undefined): PersonSummary {
  if (!local) return incoming;
  const incomingFactIds = new Set(incoming.facts.map((fact) => fact.id));
  return {
    ...incoming,
    facts: [
      ...incoming.facts.map((fact) => preserveFactCuration(fact, local.facts.find((candidate) => candidate.id === fact.id))),
      ...local.facts.filter((fact) => !incomingFactIds.has(fact.id))
    ],
    // A refresh never hard-deletes a relationship. Explicit nested review can
    // add links, while absent/deleted remote links retain the local relation.
    relatives: uniqueStrings([...incoming.relatives, ...local.relatives])
  };
}

function preserveFactCuration(incoming: PersonFact, local: PersonFact | undefined): PersonFact {
  return local
    ? { ...incoming, privacy: local.privacy, confidence: local.confidence }
    : incoming;
}

function orderedFacts(
  facts: Map<string, PersonFact>,
  incoming: PersonSummary | undefined,
  local: PersonSummary | undefined
): PersonFact[] {
  const order = uniqueStringsPreservingOrder([
    ...(incoming?.facts.map((fact) => fact.id) ?? []),
    ...(local?.facts.map((fact) => fact.id) ?? []),
    ...facts.keys()
  ]);
  return order.map((id) => facts.get(id)).filter((fact): fact is PersonFact => Boolean(fact));
}

function requiredNestedResolution(
  change: SyncChange,
  request: SyncResolutionInput | undefined
): SyncResolution {
  const resolution = requestedResolution(request) ?? defaultResolution(change);
  if (!resolution) {
    throw integrationProcessingError("RESOLUTION_REQUIRED", `Sync change ${change.id} requires review`);
  }
  return resolution;
}

function rejectNestedFieldResolutions(request: SyncResolutionInput | undefined, change: SyncChange): void {
  if (request?.fields && Object.keys(request.fields).length > 0) {
    throw integrationProcessingError(
      "INVALID_INPUT",
      `Field-level resolutions are not supported for ${change.entityType} changes`
    );
  }
}

function changeExternalKey(change: SyncChange): string {
  return `${change.entityType}:${change.externalId ?? ""}`;
}

function changeResolutionValue(
  change: SyncChange,
  side: "base" | "local" | "incoming"
): Record<string, unknown> | null {
  const values = isRecord(change.resolutionPayload.values) ? change.resolutionPayload.values : undefined;
  const value = values?.[side];
  return isRecord(value) ? value : null;
}

function remappedId(value: string | undefined, remap: Map<string, string>): string | undefined {
  return value ? remap.get(value) ?? value : undefined;
}

function withRelative(person: PersonSummary, relativeId: string, present: boolean): PersonSummary {
  const relatives = new Set(person.relatives);
  if (present) relatives.add(relativeId);
  else relatives.delete(relativeId);
  return { ...person, relatives: [...relatives].sort() };
}

function citationSource(value: Record<string, unknown> | undefined): string | undefined {
  if (!value) return undefined;
  return optionalStringValue(value.sourceId) ?? optionalStringValue(value.sourceText);
}

const reviewFields: Record<"person" | "source", Set<string>> = {
  person: new Set([
    "displayName", "givenName", "surname", "birthDate", "birthPlace",
    "deathDate", "deathPlace", "sex", "notes"
  ]),
  source: new Set([
    "title", "sourceType", "repository", "url", "ancestryApid",
    "citationDate", "linkedPersonId", "transcript", "notes"
  ])
};

function requestedResolution(input: SyncResolutionInput | undefined): SyncResolution | undefined {
  if (!input) return undefined;
  const resolution = input.resolution ?? input.action;
  if (resolution === "accept_incoming" || resolution === "keep_local" || resolution === "no_op") {
    return resolution;
  }
  throw integrationProcessingError("INVALID_INPUT", "Sync resolution is invalid");
}

function requestedFields(
  input: SyncResolutionInput | undefined,
  entityType: "person" | "source"
): Record<string, "accept_incoming" | "keep_local"> {
  if (input?.fields === undefined) return {};
  if (!isRecord(input.fields)) throw integrationProcessingError("INVALID_INPUT", "Field resolutions are invalid");
  const fields: Record<string, "accept_incoming" | "keep_local"> = {};
  for (const [fieldName, resolution] of Object.entries(input.fields)) {
    if (!reviewFields[entityType].has(fieldName)
      || (resolution !== "accept_incoming" && resolution !== "keep_local")) {
      throw integrationProcessingError("INVALID_INPUT", `Field resolution ${fieldName} is invalid`);
    }
    fields[fieldName] = resolution;
  }
  return fields;
}

function resolveEntityFields<T extends { id: string }>(
  incoming: T,
  local: T | undefined,
  resolution: SyncResolution,
  fields: Record<string, "accept_incoming" | "keep_local">
): T | undefined {
  const includesIncomingField = Object.values(fields).includes("accept_incoming");
  if (resolution !== "accept_incoming" && !includesIncomingField) return undefined;
  if (resolution !== "accept_incoming" && !local) {
    throw integrationProcessingError("INVALID_INPUT", "Local field resolution requires an existing local entity");
  }
  const resolved = { ...(resolution === "accept_incoming" ? incoming : local!) } as Record<string, unknown>;
  for (const [fieldName, fieldResolution] of Object.entries(fields)) {
    if (fieldResolution === "keep_local" && !local) {
      throw integrationProcessingError("INVALID_INPUT", "Cannot keep a missing local field");
    }
    resolved[fieldName] = (fieldResolution === "accept_incoming" ? incoming : local!)
      [fieldName as keyof T];
  }
  return resolved as T;
}

async function allSyncChanges(runId: string, options: IntegrationStoreOptions): Promise<SyncChange[]> {
  const changes: SyncChange[] = [];
  let cursor: string | undefined;
  do {
    const page = await listSyncChanges(runId, { cursor, pageSize: 100 }, options);
    changes.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return changes;
}

function assertUnchangedLocalBaseline(
  changes: SyncChange[],
  workspace: Awaited<ReturnType<typeof readWorkspace>>
): void {
  for (const change of changes) {
    if (!change.localEntityId || !isEntityType(change.entityType)) continue;
    const baseValue = changeResolutionValue(change, "base");
    const template = changeResolutionValue(change, "incoming") ?? baseValue;
    const currentValue = localEntityValue(
      change.entityType,
      change.localEntityId,
      workspace,
      template,
      baseValue
    );
    const current = currentValue ? entityValueHash(change.entityType, currentValue) : null;
    if (current !== (change.localHash ?? null)) {
      throw integrationProcessingError(
        "STALE_BASELINE",
        `The archive's ${change.entityType} data changed after the refresh was prepared`
      );
    }
  }
}

function defaultResolution(change: SyncChange): SyncResolution | undefined {
  return change.proposedAction === "review" ? undefined : change.proposedAction;
}

function entityKey(entity: Pick<SnapshotEntity, "entityType" | "externalId">): string {
  return `${entity.entityType}:${entity.externalId}`;
}

function localEntityKey(entity: Pick<SnapshotEntity, "entityType" | "localEntityId">): string {
  return `${entity.entityType}:${entity.localEntityId}`;
}

function stableLocalId(connectionId: string, entityType: EntityType, externalId: string): string {
  return `integration-${entityType}-${sha256(`${connectionId}:${entityType}:${externalId}`).slice(0, 24)}`;
}

function packageProvider(provider: string): SourcePackageProvider {
  if (provider === "gedcom") return "generic_gedcom";
  if (provider === "ancestry_export" || provider === "family_tree_maker" || provider === "rootsmagic") {
    return provider;
  }
  throw integrationProcessingError("PROVIDER_UNAVAILABLE", "This provider does not support snapshot packages");
}

function hashJson(value: unknown): string {
  return sha256(JSON.stringify(value));
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function integrationProcessingError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function getIntegrationProcessingErrorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
