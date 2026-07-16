#!/usr/bin/env node
import { runPublicDemoMonitor } from "./public-demo-monitor.mjs";

try {
  await runPublicDemoMonitor("full");
  console.log("Disposable public demo browser canary passed.");
} catch {
  console.error("Disposable public demo browser canary failed.");
  process.exitCode = 1;
}
