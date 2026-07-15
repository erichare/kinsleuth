#!/usr/bin/env node
import { setTimeout as wait } from "node:timers/promises";

import {
  createIntegrationWorkerMaintenanceScheduler,
  integrationWorkerConfiguration,
  runIntegrationWorkerBatch
} from "../lib/integrations/worker";

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
  });
}

try {
  const configuration = integrationWorkerConfiguration();
  const runMaintenanceIfDue = createIntegrationWorkerMaintenanceScheduler(configuration);
  console.log(`Kin Resolve integration worker ${configuration.workerId} started.`);

  while (!stopping) {
    try {
      const maintenance = await runMaintenanceIfDue();
      if (maintenance && (maintenance.deleted > 0 || maintenance.failed > 0)) {
        console.log(
          `Integration worker maintenance: ${maintenance.deleted} staging objects removed, ${maintenance.failed} removals deferred.`
        );
      }
    } catch {
      // Do not serialize storage paths, credentials, filenames, or imported
      // genealogy. The interval gate has already advanced, so an operational
      // failure cannot turn into a tight retry loop.
      console.error("Kin Resolve integration worker maintenance encountered an operational failure.");
    }

    const result = await runIntegrationWorkerBatch({
      databaseUrl: configuration.databaseUrl,
      workerId: configuration.workerId,
      maximumJobs: configuration.maximumJobs,
      leaseDurationMs: configuration.leaseDurationMs,
      ...(configuration.malwareScanner ? { malwareScanner: configuration.malwareScanner } : {})
    });
    if (result.leased > 0) {
      console.log(
        `Integration worker checkpoint: ${result.completed} completed, ${result.failed} failed, ${result.archivesScanned} archive queues scanned.`
      );
    }
    if (!stopping) {
      await wait(configuration.pollIntervalMs);
    }
  }

  console.log("Kin Resolve integration worker stopped.");
} catch (error) {
  // The worker log may be private operational output, but avoid serializing
  // job payloads or imported genealogy data here regardless.
  console.error("Kin Resolve integration worker stopped after an operational failure.");
  if (process.env.NODE_ENV !== "production") {
    console.error(error instanceof Error ? error.name : "UnknownError");
  }
  process.exitCode = 1;
}
