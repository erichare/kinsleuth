#!/usr/bin/env node
// Keep a plain-JavaScript launcher for operators and packaging tools while the
// worker implementation remains typechecked TypeScript.
import { spawn } from "node:child_process";

const child = spawn(process.execPath, ["--import", "tsx", "scripts/worker.ts"], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit"
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("error", () => {
  console.error("Unable to start the Kin Resolve integration worker.");
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
