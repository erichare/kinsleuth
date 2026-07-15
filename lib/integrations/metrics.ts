import { query, type DatabaseOptions } from "../db";

export type IntegrationOperationalMetrics = {
  runCount: number;
  previewReadyCount: number;
  averageSecondsToPreview: number | null;
  parsingFailureCount: number;
  noOpRunCount: number;
  conflictChangeRate: number;
  appliedRunCount: number;
  rollbackCount: number;
  repeatRefreshConnectionCount: number;
};

type MetricsRow = {
  run_count: number | string;
  preview_ready_count: number | string;
  average_seconds_to_preview: number | string | null;
  parsing_failure_count: number | string;
  no_op_run_count: number | string;
  conflict_change_rate: number | string | null;
  applied_run_count: number | string;
  rollback_count: number | string;
  repeat_refresh_connection_count: number | string;
};

/**
 * Returns archive-scoped operational aggregates only. The query never selects
 * names, facts, filenames, external IDs, or snapshot metadata.
 */
export async function getIntegrationOperationalMetrics(
  options: DatabaseOptions & { archiveId: string }
): Promise<IntegrationOperationalMetrics> {
  const archiveId = options.archiveId?.trim();
  if (!archiveId) throw new Error("archiveId is required");
  const result = await query<MetricsRow>(
    `WITH run_rollup AS (
       SELECT run.id, run.connection_id, run.status, run.incoming_snapshot_id,
              run.created_at, snapshot.created_at AS preview_created_at,
              count(change.id)::integer AS change_count,
              count(change.id) FILTER (WHERE change.classification = 'conflict')::integer AS conflict_count,
              count(change.id) FILTER (WHERE change.classification <> 'same')::integer AS non_noop_count
       FROM sync_runs run
       LEFT JOIN integration_snapshots snapshot
         ON snapshot.archive_id = run.archive_id
        AND snapshot.connection_id = run.connection_id
        AND snapshot.id = run.incoming_snapshot_id
       LEFT JOIN sync_changes change
         ON change.archive_id = run.archive_id AND change.run_id = run.id
       WHERE run.archive_id = $1
       GROUP BY run.id, run.connection_id, run.status, run.incoming_snapshot_id,
                run.created_at, snapshot.created_at
     ), connection_rollup AS (
       SELECT connection_id, count(*)::integer AS run_count
       FROM run_rollup
       GROUP BY connection_id
     )
     SELECT
       count(*)::integer AS run_count,
       count(*) FILTER (WHERE incoming_snapshot_id IS NOT NULL)::integer AS preview_ready_count,
       avg(extract(epoch FROM (preview_created_at - created_at)))
         FILTER (WHERE preview_created_at IS NOT NULL) AS average_seconds_to_preview,
       count(*) FILTER (WHERE status = 'failed')::integer AS parsing_failure_count,
       count(*) FILTER (WHERE change_count > 0 AND non_noop_count = 0)::integer AS no_op_run_count,
       COALESCE(sum(conflict_count)::numeric / NULLIF(sum(change_count), 0), 0) AS conflict_change_rate,
       count(*) FILTER (WHERE status IN ('applied', 'rolled_back'))::integer AS applied_run_count,
       count(*) FILTER (WHERE status = 'rolled_back')::integer AS rollback_count,
       (SELECT count(*)::integer FROM connection_rollup WHERE run_count > 1) AS repeat_refresh_connection_count
     FROM run_rollup`,
    [archiveId],
    options
  );
  const row = result.rows[0];
  return {
    runCount: number(row?.run_count),
    previewReadyCount: number(row?.preview_ready_count),
    averageSecondsToPreview: nullableNumber(row?.average_seconds_to_preview),
    parsingFailureCount: number(row?.parsing_failure_count),
    noOpRunCount: number(row?.no_op_run_count),
    conflictChangeRate: number(row?.conflict_change_rate),
    appliedRunCount: number(row?.applied_run_count),
    rollbackCount: number(row?.rollback_count),
    repeatRefreshConnectionCount: number(row?.repeat_refresh_connection_count)
  };
}

function number(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nullableNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return number(value);
}
