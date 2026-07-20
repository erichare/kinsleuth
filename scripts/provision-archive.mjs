#!/usr/bin/env node
// Plain-JavaScript launcher for operators and packaging tools; tsx executes the
// typechecked command implementation.
import { spawn } from "node:child_process";

const child = spawn(process.execPath, ["--import", "tsx", "scripts/provision-archive-command.ts", ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit"
});

let forwardedSignal = null;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    forwardedSignal = signal;
    child.kill(signal);
  });
}

child.on("error", (error) => {
  console.error(`Unable to start the Kin Resolve archive provisioning command: ${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  // An operator-initiated Ctrl-C explains itself; any other fatal signal
  // (external kill, OOM) would otherwise exit 1 with nothing on stderr.
  if (signal && signal !== forwardedSignal) {
    console.error(`Archive provisioning command terminated by ${signal}.`);
  }
  process.exitCode = code ?? (signal ? 1 : 0);
});
