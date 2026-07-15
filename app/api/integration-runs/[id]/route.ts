import { NextResponse } from "next/server";

import { withPermission } from "@/lib/api-authorization";
import { integrationErrorResponse } from "@/lib/integrations/api-response";
import { toPublicSyncRun } from "@/lib/integrations/public-projections";
import {
  cancelSyncRun,
  getIntegrationSnapshot,
  getSyncRun
} from "@/lib/integrations/store";

type RouteContext = { params: Promise<{ id: string }> };
const maximumReportItems = 200;
const maximumReportStringLength = 1_000;
const maximumAmbiguousPaths = 20;

export const GET = withPermission("imports:manage", async (_request, authorization, context: RouteContext) => {
  const { id } = await context.params;
  try {
    const run = await getSyncRun(id, { archiveId: authorization.archiveId });
    const snapshot = run.incomingSnapshotId
      ? await getIntegrationSnapshot(run.incomingSnapshotId, {
          archiveId: authorization.archiveId
        })
      : null;
    const report = snapshot
      ? {
          counts: snapshot.counts,
          warnings: snapshot.warnings
            .slice(0, maximumReportItems)
            .map((warning) => warning.slice(0, maximumReportStringLength)),
          sourceMetadata: reportSourceMetadata(snapshot.sourceMetadata),
          limits: reportLimits(snapshot)
        }
      : null;
    return NextResponse.json({ run: toPublicSyncRun(run), report });
  } catch (error) {
    return integrationErrorResponse(error, "Unable to read the refresh", "Refresh not found");
  }
});

function reportSourceMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const unsupportedRecords = reportRecords(metadata.unsupportedRecords, (record) => ({
    type: boundedMetadataString(record.type, 64) ?? "Unknown record",
    externalId: boundedMetadataString(record.externalId, 128) ?? null
  }));
  const missingMedia = reportRecords(metadata.missingMedia, reportMissingMedia);
  const ambiguousMedia = reportRecords(metadata.ambiguousMedia, (record) => {
    const archivePaths = Array.isArray(record.archivePaths)
      ? record.archivePaths.flatMap((path) => {
          const value = boundedMetadataString(path);
          return value ? [value] : [];
        })
      : [];
    return {
      ...reportMissingMedia(record),
      archivePaths: archivePaths.slice(0, maximumAmbiguousPaths),
      archivePathCount: archivePaths.length
    };
  });
  const arrays = {
    ...(unsupportedRecords ? { unsupportedRecords } : {}),
    ...(missingMedia ? { missingMedia } : {}),
    ...(ambiguousMedia ? { ambiguousMedia } : {})
  };
  const unsupportedTags = reportUnsupportedTags(metadata.unsupportedTags);
  return unsupportedTags ? { ...arrays, unsupportedTags } : arrays;
}

function reportRecords(
  value: unknown,
  project: (record: Record<string, unknown>) => Record<string, unknown>
): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.slice(0, maximumReportItems).flatMap((entry) => isRecord(entry) ? [project(entry)] : []);
}

function reportMissingMedia(record: Record<string, unknown>): Record<string, unknown> {
  return {
    gedcomPath: boundedMetadataString(record.gedcomPath) ?? "Unspecified media path",
    ...(boundedMetadataString(record.normalizedPath) ? {
      normalizedPath: boundedMetadataString(record.normalizedPath)
    } : {})
  };
}

function boundedMetadataString(value: unknown, limit = maximumReportStringLength): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, limit) : undefined;
}

function reportUnsupportedTags(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value) || !Array.isArray(value.tags)) return undefined;
  const tags = value.tags.slice(0, maximumReportItems).flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.tag !== "string" || !Number.isSafeInteger(entry.count)) return [];
    const tag = entry.tag.trim().slice(0, 64);
    const count = Number(entry.count);
    return tag && /^[A-Za-z0-9_]+$/.test(tag) && count > 0 ? [{ tag, count }] : [];
  });
  const reportedTotal = Number(value.total);
  const total = Number.isSafeInteger(reportedTotal) && reportedTotal >= 0
    ? reportedTotal
    : tags.reduce((sum, entry) => sum + entry.count, 0);
  return {
    total,
    tags,
    truncated: value.truncated === true || value.tags.length > tags.length
  };
}

function reportLimits(snapshot: {
  warnings: string[];
  sourceMetadata: Record<string, unknown>;
}): Record<string, { total: number; returned: number; truncated: boolean }> {
  return Object.fromEntries(
    [
      ["warnings", snapshot.warnings],
      ...["unsupportedRecords", "missingMedia", "ambiguousMedia"].map((key) => [
        key,
        Array.isArray(snapshot.sourceMetadata[key]) ? snapshot.sourceMetadata[key] : []
      ])
    ].map(([key, value]) => {
      const total = (value as unknown[]).length;
      const returned = Math.min(total, maximumReportItems);
      return [key as string, { total, returned, truncated: total > returned }];
    })
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const DELETE = withPermission("imports:manage", async (_request, authorization, context: RouteContext) => {
  const { id } = await context.params;
  try {
    const run = await cancelSyncRun(id, { archiveId: authorization.archiveId });
    return NextResponse.json({ run: toPublicSyncRun(run) }, { status: 202 });
  } catch (error) {
    return integrationErrorResponse(error, "Unable to cancel the refresh", "Refresh not found");
  }
});
