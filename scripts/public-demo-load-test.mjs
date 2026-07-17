#!/usr/bin/env node
import { performance } from "node:perf_hooks";

const canonicalOrigin = "https://demo.kinresolve.com";
const guidedPath = "/app/cases/case-mercer-march-identity?guide=1";
const noticeVersion = "public-demo-2026-07-16";
const sessionCount = 25;
const p95LimitMs = 5_000;
const requestTimeoutMs = 30_000;
const maximumResponseBytes = 256 * 1024;
const safePublicDemoLoadStages = Object.freeze([
  "configuration",
  "start-request",
  "start-response",
  "start-cookie",
  "start-body",
  "start-uniqueness",
  "start-p95",
  "capacity-response",
  "capacity-contract",
  "session-read-response",
  "session-read-contract",
  "guided-read-response",
  "guided-read-contract",
  "cleanup",
  "unknown"
]);

export async function runPublicDemoLoadTest(
  environment = process.env,
  fetchImplementation = globalThis.fetch
) {
  if (typeof fetchImplementation !== "function") throw loadGateFailure("configuration");
  let configuration;
  try {
    configuration = resolveConfiguration(environment);
  } catch {
    throw loadGateFailure("configuration");
  }
  const cookies = [];
  let primaryFailure;
  let result;
  try {
    const starts = await Promise.allSettled(Array.from({ length: sessionCount }, async () => {
      const startedAt = performance.now();
      const response = await runLoadStage("start-request", () => (
        request(configuration, fetchImplementation, "/api/demo/sessions", {
          body: JSON.stringify({ noticeVersion }),
          method: "POST"
        })
      ));
      const elapsedMs = performance.now() - startedAt;
      if (response.status !== 201) {
        await response.body?.cancel().catch(() => undefined);
        throw loadGateFailure("start-response", { status: response.status });
      }
      const cookie = await runLoadStage("start-cookie", () => extractCookie(response));
      let bodyValid = false;
      try {
        const document = await boundedJson(response);
        bodyValid = document.workspaceUrl === guidedPath;
      } catch {
        // Preserve the cookie so the finally block can still end this session.
      }
      return { bodyValid, cookie, elapsedMs };
    }));
    const created = starts
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);
    cookies.push(...created.map(({ cookie }) => cookie));
    const rejectedStarts = starts.filter(({ status }) => status === "rejected");
    if (rejectedStarts.length > 0) {
      throw extendLoadGateFailure(rejectedStarts[0].reason, "start-request", {
        attempted: sessionCount,
        succeeded: created.length,
        failed: rejectedStarts.length
      });
    }
    const invalidBodies = created.filter(({ bodyValid }) => !bodyValid).length;
    if (invalidBodies > 0) {
      throw loadGateFailure("start-body", {
        attempted: sessionCount,
        succeeded: created.length,
        invalid: invalidBodies
      });
    }
    const uniqueCookies = new Set(cookies).size;
    if (uniqueCookies !== sessionCount) {
      throw loadGateFailure("start-uniqueness", {
        attempted: sessionCount,
        succeeded: created.length,
        unique: uniqueCookies
      });
    }

    const elapsed = created.map(({ elapsedMs }) => elapsedMs).sort((left, right) => left - right);
    const p95 = elapsed[Math.ceil(elapsed.length * 0.95) - 1];
    if (!Number.isFinite(p95) || p95 > p95LimitMs) {
      throw loadGateFailure("start-p95", { p95Milliseconds: Math.ceil(p95) });
    }

    await assertCapacityBoundary(configuration, fetchImplementation);

    const reads = await Promise.allSettled(cookies.flatMap((cookie) => [
      readSession(configuration, fetchImplementation, cookie),
      readGuidedPage(configuration, fetchImplementation, cookie)
    ]));
    const rejectedReads = reads.filter(({ status }) => status === "rejected");
    if (rejectedReads.length > 0) {
      throw extendLoadGateFailure(rejectedReads[0].reason, "unknown", {
        attempted: reads.length,
        succeeded: reads.length - rejectedReads.length,
        failed: rejectedReads.length
      });
    }
    result = Object.freeze({ sessionCount, p95Milliseconds: Math.ceil(p95) });
  } catch (error) {
    primaryFailure = isLoadGateFailure(error) ? error : loadGateFailure("unknown");
  }

  const cleanup = await Promise.allSettled(cookies.map((cookie) => (
    runLoadStage("cleanup", async () => {
      const response = await request(configuration, fetchImplementation, "/api/demo/session/end", {
        body: "{}",
        cookie,
        method: "POST"
      });
      if (response.status !== 200 && response.status !== 204) {
        throw loadGateFailure("cleanup", { status: response.status });
      }
    })
  )));
  const cleanupFailed = cleanup.filter(({ status }) => status === "rejected").length;
  if (primaryFailure) {
    throw extendLoadGateFailure(primaryFailure, "unknown", { cleanupFailed });
  }
  if (cleanupFailed > 0) {
    throw loadGateFailure("cleanup", {
      attempted: cleanup.length,
      succeeded: cleanup.length - cleanupFailed,
      failed: cleanupFailed,
      cleanupFailed
    });
  }
  return result;
}

async function assertCapacityBoundary(configuration, fetchImplementation) {
  const response = await runLoadStage("capacity-response", () => (
    request(configuration, fetchImplementation, "/api/demo/sessions", {
      body: JSON.stringify({ noticeVersion }),
      method: "POST"
    })
  ));
  const retryAfter = response.headers.get("retry-after");
  const setCookie = response.headers.get("set-cookie");
  if (
    response.status !== 429
    || response.redirected
    || response.headers.has("location")
    || !retryAfter
    || !/^\d+$/.test(retryAfter)
    || Number(retryAfter) < 1
    || setCookie !== null
  ) {
    await response.body?.cancel().catch(() => undefined);
    throw loadGateFailure("capacity-response", { status: response.status });
  }
  const document = await runLoadStage("capacity-contract", () => boundedJson(response));
  if (
    document.maximumActiveSessions !== 25
    || document.familyUrl !== "/family"
    || document.challengeUrl !== "/challenge"
    || typeof document.error !== "string"
    || !document.error.includes("at capacity")
  ) {
    throw loadGateFailure("capacity-contract", { status: response.status });
  }
}

async function readSession(configuration, fetchImplementation, cookie) {
  const response = await runLoadStage("session-read-response", () => (
    request(configuration, fetchImplementation, "/api/demo/session", {
      cookie,
      method: "GET"
    })
  ));
  if (response.status !== 200) {
    throw loadGateFailure("session-read-response", { status: response.status });
  }
  const document = await runLoadStage("session-read-contract", () => boundedJson(response));
  if (document?.session?.status !== "active") {
    throw loadGateFailure("session-read-contract", { status: response.status });
  }
}

async function readGuidedPage(configuration, fetchImplementation, cookie) {
  const response = await runLoadStage("guided-read-response", () => (
    request(configuration, fetchImplementation, guidedPath, {
      accept: "text/html",
      cookie,
      method: "GET"
    })
  ));
  if (response.status !== 200) {
    throw loadGateFailure("guided-read-response", { status: response.status });
  }
  const body = await runLoadStage("guided-read-contract", () => boundedText(response));
  if (!body.includes("Do these signatures point to the same fictional person?")) {
    throw loadGateFailure("guided-read-contract", { status: response.status });
  }
}

async function runLoadStage(stage, operation) {
  try {
    return await operation();
  } catch (error) {
    throw isLoadGateFailure(error) ? error : loadGateFailure(stage);
  }
}

function loadGateFailure(stage, detail = {}) {
  const failure = new Error("The 25-session demo capacity gate failed.");
  failure.stage = safePublicDemoLoadStages.includes(stage) ? stage : "unknown";
  failure.status = safeHttpStatus(detail.status);
  failure.attempted = safeLoadCount(detail.attempted);
  failure.succeeded = safeLoadCount(detail.succeeded);
  failure.failed = safeLoadCount(detail.failed);
  failure.invalid = safeLoadCount(detail.invalid);
  failure.unique = safeLoadCount(detail.unique);
  failure.p95Milliseconds = safeP95Milliseconds(detail.p95Milliseconds);
  failure.cleanupFailed = safeLoadCount(detail.cleanupFailed);
  return failure;
}

function isLoadGateFailure(error) {
  return error instanceof Error && safePublicDemoLoadStages.includes(error.stage);
}

function extendLoadGateFailure(error, fallbackStage, detail) {
  const failure = isLoadGateFailure(error) ? error : loadGateFailure(fallbackStage);
  return loadGateFailure(failure.stage, {
    status: failure.status,
    attempted: failure.attempted,
    succeeded: failure.succeeded,
    failed: failure.failed,
    invalid: failure.invalid,
    unique: failure.unique,
    p95Milliseconds: failure.p95Milliseconds,
    cleanupFailed: failure.cleanupFailed,
    ...detail
  });
}

function safeHttpStatus(value) {
  return Number.isSafeInteger(value) && value >= 100 && value <= 599 ? value : null;
}

function safeLoadCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? Math.min(value, 50) : null;
}

function safeP95Milliseconds(value) {
  return Number.isFinite(value) && value >= 0 ? Math.min(Math.ceil(value), 30_000) : null;
}

export function safePublicDemoLoadFailure(error) {
  const candidateStage = safeLoadDiagnosticProperty(error, "stage");
  const stage = typeof candidateStage === "string" && safePublicDemoLoadStages.includes(candidateStage)
    ? candidateStage
    : "unknown";
  const details = [
    ["status", safeHttpStatus(safeLoadDiagnosticProperty(error, "status"))],
    ["attempted", safeLoadCount(safeLoadDiagnosticProperty(error, "attempted"))],
    ["succeeded", safeLoadCount(safeLoadDiagnosticProperty(error, "succeeded"))],
    ["failed", safeLoadCount(safeLoadDiagnosticProperty(error, "failed"))],
    ["invalid", safeLoadCount(safeLoadDiagnosticProperty(error, "invalid"))],
    ["unique", safeLoadCount(safeLoadDiagnosticProperty(error, "unique"))],
    ["p95Milliseconds", safeP95Milliseconds(
      safeLoadDiagnosticProperty(error, "p95Milliseconds")
    )],
    ["cleanupFailed", safeLoadCount(safeLoadDiagnosticProperty(error, "cleanupFailed"))]
  ].flatMap(([name, value]) => value === null ? [] : [`${name}=${value}`]);
  return `Public demo 25-session load gate failed. stage=${stage}${
    details.length > 0 ? ` ${details.join(" ")}` : ""
  }`;
}

function safeLoadDiagnosticProperty(value, property) {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return undefined;
  }
  try {
    return Reflect.get(value, property);
  } catch {
    return undefined;
  }
}

async function request(configuration, fetchImplementation, pathname, options) {
  const mutation = options.method !== "GET" && options.method !== "HEAD";
  return fetchImplementation(new URL(pathname, configuration.origin), {
    body: options.body,
    cache: "no-store",
    headers: {
      accept: options.accept ?? "application/json",
      ...(mutation ? { "content-type": "application/json" } : {}),
      ...(options.cookie ? { cookie: options.cookie } : {}),
      "x-kinresolve-demo-canary": configuration.canarySecret,
      "x-vercel-protection-bypass": configuration.bypassSecret,
      ...(mutation ? {
        origin: canonicalOrigin,
        "sec-fetch-site": "same-origin"
      } : {})
    },
    method: options.method,
    redirect: "manual",
    signal: AbortSignal.timeout(requestTimeoutMs)
  });
}

function extractCookie(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  const cookies = values
    .map((value) => value.split(";", 1)[0]?.trim())
    .filter((value) => value?.startsWith("__Host-kinresolve-demo="));
  if (cookies.length !== 1 || !/^__Host-kinresolve-demo=[A-Za-z0-9_-]{43,256}$/.test(cookies[0])) {
    throw new Error("A load-test session cookie was invalid.");
  }
  return cookies[0];
}

async function boundedJson(response) {
  const contents = await boundedText(response);
  const value = JSON.parse(contents);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("A load-test response was not a JSON object.");
  }
  return value;
}

async function boundedText(response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maximumResponseBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("A load-test response exceeded its size bound.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function resolveConfiguration(environment) {
  const origin = exactCandidateOrigin(environment.PUBLIC_DEMO_ORIGIN);
  return Object.freeze({
    origin,
    canarySecret: requiredSecret(environment.KINRESOLVE_DEMO_CANARY_SECRET),
    bypassSecret: requiredSecret(environment.VERCEL_AUTOMATION_BYPASS_SECRET)
  });
}

function exactCandidateOrigin(value) {
  if (typeof value !== "string" || value.trim() !== value) {
    throw new Error("The load-test origin is invalid.");
  }
  const url = new URL(value);
  if (
    url.protocol !== "https:"
    || url.origin !== value
    || !url.hostname.endsWith(".vercel.app")
    || url.hostname === "vercel.app"
    || url.username
    || url.password
    || url.port
  ) {
    throw new Error("The load test requires a protected generated candidate origin.");
  }
  return url.origin;
}

function requiredSecret(value) {
  if (typeof value !== "string" || value.trim() !== value || !/^[A-Za-z0-9_-]{20,256}$/.test(value)) {
    throw new Error("A load-test credential is invalid.");
  }
  return value;
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  runPublicDemoLoadTest().then(() => {
    console.log("Public demo 25-session load gate passed.");
  }).catch((error) => {
    console.error(safePublicDemoLoadFailure(error));
    process.exitCode = 1;
  });
}
