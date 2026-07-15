import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import { closeDatabasePools, query } from "@/lib/db";
import { getIntegrationOperationalMetrics } from "@/lib/integrations/metrics";
import { createIntegrationConnection, startSyncRun } from "@/lib/integrations/store";
import { readWorkspace } from "@/lib/workspace-store";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeIfDatabase = databaseUrl ? describe : describe.skip;

describeIfDatabase("privacy-safe integration operational metrics", () => {
  const archiveId = `test-integration-metrics-${randomUUID()}`;
  const options = { archiveId, databaseUrl: databaseUrl! };

  beforeEach(async () => { await readWorkspace(options); });
  afterEach(async () => { await query("DELETE FROM archives WHERE id = $1", [archiveId], options); });
  afterAll(async () => { await closeDatabasePools(); });

  it("aggregates run behavior without selecting genealogical content", async () => {
    const connection = await createIntegrationConnection(
      { provider: "gedcom", authority: "another_genealogy_app", displayName: "Synthetic metrics tree" },
      options
    );
    const first = await startSyncRun(connection.id, {}, options);
    await query(
      `UPDATE sync_runs SET status = 'failed', error_code = 'synthetic_failure' WHERE archive_id = $1 AND id = $2`,
      [archiveId, first.id],
      options
    );
    const second = await startSyncRun(connection.id, {}, options);
    await query(
      `UPDATE sync_runs SET status = 'applied', applied_at = now() WHERE archive_id = $1 AND id = $2`,
      [archiveId, second.id],
      options
    );
    await query(
      `INSERT INTO sync_changes (
         archive_id, id, run_id, entity_type, classification, proposed_action, resolution_payload, sort_order
       ) VALUES
         ($1, $3, $2, 'person', 'same', 'no_op', '{}'::jsonb, 0),
         ($1, $4, $2, 'fact', 'conflict', 'review', '{}'::jsonb, 1)`,
      [archiveId, second.id, `change-${randomUUID()}`, `change-${randomUUID()}`],
      options
    );

    await expect(getIntegrationOperationalMetrics(options)).resolves.toMatchObject({
      runCount: 2,
      parsingFailureCount: 1,
      conflictChangeRate: 0.5,
      appliedRunCount: 1,
      rollbackCount: 0,
      repeatRefreshConnectionCount: 1
    });
  });
});
