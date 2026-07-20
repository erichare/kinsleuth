#!/usr/bin/env node
import { pathToFileURL } from "node:url";

const maximumResponseBytes = 512 * 1024;
const requestTimeoutMs = 30_000;

const shallowProbes = Object.freeze([
  {
    path: "/",
    expectedContentType: "text/html",
    bodyContract: (body) => body.includes("Start guided demo")
  },
  {
    path: "/api/health",
    expectedContentType: "application/json",
    bodyContract: (body) => {
      const document = parseObject(body);
      return document.status === "ok";
    }
  },
  {
    path: "/family",
    expectedContentType: "text/html",
    bodyContract: (body) => body.includes("Hartwell–Mercer Family Archive")
  }
]);

export async function runPublicDemoMonitor(
  mode,
  environment = process.env,
  fetchImplementation = globalThis.fetch
) {
  if (mode !== "shallow" && mode !== "full") {
    throw new Error("The public demo monitor mode must be shallow or full.");
  }
  if (typeof fetchImplementation !== "function") {
    throw new Error("The public demo monitor requires fetch.");
  }

  const configuration = resolveConfiguration(mode, environment);
  for (const probe of shallowProbes) {
    await runShallowProbe(configuration, probe, fetchImplementation);
  }
  if (mode === "full") {
    await runDisposableJourney(configuration, fetchImplementation);
  }

  return Object.freeze({ mode, shallowProbeCount: shallowProbes.length });
}

async function runShallowProbe(configuration, probe, fetchImplementation) {
  const response = await fetchImplementation(new URL(probe.path, configuration.origin), {
    cache: "no-store",
    headers: requestHeaders(configuration, { accept: probe.expectedContentType }),
    redirect: "manual",
    signal: AbortSignal.timeout(requestTimeoutMs)
  });
  requireExactResponse(response, 200, probe.expectedContentType);
  const body = await boundedText(response);
  if (!probe.bodyContract(body)) throw new Error("A public demo response body contract failed.");
}

async function runDisposableJourney(configuration, fetchImplementation) {
  let firstCookie = null;
  let secondCookie = null;
  let resetCookie = null;
  let journeyError = null;
  try {
    const starts = await Promise.all([
      startDisposableSession(configuration, fetchImplementation),
      startDisposableSession(configuration, fetchImplementation)
    ]);
    firstCookie = starts[0].cookie;
    secondCookie = starts[1].cookie;
    if (firstCookie === secondCookie) {
      throw new Error("The disposable demo sessions did not receive isolated credentials.");
    }

    const outcomes = ["found", "inconclusive"];
    const guided = await Promise.all([
      postJson(
        configuration,
        fetchImplementation,
        "/api/demo/cases/case-mercer-march-identity/guide",
        { command: "record_outcome", outcome: outcomes[0] },
        firstCookie
      ),
      postJson(
        configuration,
        fetchImplementation,
        "/api/demo/cases/case-mercer-march-identity/guide",
        { command: "record_outcome", outcome: outcomes[1] },
        secondCookie
      )
    ]);
    for (const result of guided) {
      requireExactResponse(result.response, 200, "application/json");
      parseObject(result.body);
    }

    const beforeReset = await Promise.all([
      getJson(configuration, fetchImplementation, "/api/demo/session", firstCookie),
      getJson(configuration, fetchImplementation, "/api/demo/session", secondCookie)
    ]);
    requireGuidedOutcome(beforeReset[0], outcomes[0]);
    requireGuidedOutcome(beforeReset[1], outcomes[1]);

    const reset = await postJson(
      configuration,
      fetchImplementation,
      "/api/demo/session/reset",
      {},
      firstCookie
    );
    requireExactResponse(reset.response, 200, "application/json");
    resetCookie = extractDemoCookie(reset.response);
    if (resetCookie === firstCookie || resetCookie === secondCookie) {
      throw new Error("The disposable demo reset did not rotate its credential.");
    }

    const stale = await postJson(
      configuration,
      fetchImplementation,
      "/api/demo/cases/case-mercer-march-identity/guide",
      { command: "record_outcome", outcome: "not_found" },
      firstCookie
    );
    if (stale.response.status !== 401 && stale.response.status !== 403) {
      throw new Error("A stale pre-reset demo credential remained authorized.");
    }

    const secondAfterReset = await getJson(
      configuration,
      fetchImplementation,
      "/api/demo/session",
      secondCookie
    );
    requireGuidedOutcome(secondAfterReset, outcomes[1]);
  } catch (error) {
    journeyError = error;
  } finally {
    for (const cookie of [resetCookie ?? firstCookie, secondCookie]) {
      if (!cookie) continue;
      try {
        const ended = await postJson(
          configuration,
          fetchImplementation,
          "/api/demo/session/end",
          {},
          cookie
        );
        if (ended.response.status !== 200 && ended.response.status !== 204) {
          throw new Error("The disposable demo session could not be ended.");
        }
      } catch (error) {
        journeyError ??= error;
      }
    }
  }
  if (journeyError) throw journeyError;
}

async function startDisposableSession(configuration, fetchImplementation) {
  const started = await postJson(
    configuration,
    fetchImplementation,
    "/api/demo/sessions",
    { noticeVersion: "public-demo-2026-07-20" }
  );
  if (started.response.status !== 200 && started.response.status !== 201) {
    throw new Error("The disposable demo session could not be started.");
  }
  requireContentType(started.response, "application/json");
  const cookie = extractDemoCookie(started.response);
  const document = parseObject(started.body);
  if (
    typeof document.workspaceUrl !== "string"
    || !/^\/app\/cases\/case-mercer-march-identity\?(?:guide|demoGuide)=1$/.test(
      document.workspaceUrl
    )
  ) {
    throw new Error("The disposable demo session returned an unexpected workspace URL.");
  }
  return { cookie };
}

async function getJson(configuration, fetchImplementation, pathname, cookie) {
  const response = await fetchImplementation(new URL(pathname, configuration.origin), {
    cache: "no-store",
    headers: requestHeaders(configuration, {
      accept: "application/json",
      cookie
    }),
    redirect: "manual",
    signal: AbortSignal.timeout(requestTimeoutMs)
  });
  requireExactResponse(response, 200, "application/json");
  return parseObject(await boundedText(response));
}

function requireGuidedOutcome(document, expectedOutcome) {
  const progress = document.progress;
  if (
    typeof progress !== "object"
    || progress === null
    || Array.isArray(progress)
    || progress.guidedOutcome !== expectedOutcome
  ) {
    throw new Error("The disposable demo sessions failed the archive isolation contract.");
  }
}

async function postJson(configuration, fetchImplementation, pathname, body, cookie = null) {
  const response = await fetchImplementation(new URL(pathname, configuration.origin), {
    body: JSON.stringify(body),
    cache: "no-store",
    headers: requestHeaders(configuration, {
      accept: "application/json",
      "content-type": "application/json",
      ...(cookie ? { cookie } : {})
    }),
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(requestTimeoutMs)
  });
  if (response.redirected || response.headers.has("location")) {
    throw new Error("The public demo monitor refuses redirects.");
  }
  return { response, body: response.status === 204 ? "" : await boundedText(response) };
}

function resolveConfiguration(mode, environment) {
  const rawOrigin = environment.PUBLIC_DEMO_ORIGIN?.trim();
  if (!rawOrigin) throw new Error("PUBLIC_DEMO_ORIGIN is required.");
  let origin;
  try {
    origin = new URL(rawOrigin);
  } catch (error) {
    throw new Error("PUBLIC_DEMO_ORIGIN must be an HTTPS origin.", { cause: error });
  }
  if (
    origin.protocol !== "https:"
    || origin.origin !== rawOrigin
    || origin.username !== ""
    || origin.password !== ""
    || origin.port !== ""
  ) {
    throw new Error("PUBLIC_DEMO_ORIGIN must be an HTTPS origin.");
  }

  const bypassSecret = optionalSecret(environment.VERCEL_AUTOMATION_BYPASS_SECRET);
  const canonical = origin.hostname === "demo.kinresolve.com";
  const generatedCandidate = origin.hostname.endsWith(".vercel.app")
    && origin.hostname !== "vercel.app";
  if (!canonical && !(generatedCandidate && bypassSecret)) {
    throw new Error("The public demo monitor origin is not an approved demo origin.");
  }

  const canarySecret = optionalSecret(environment.KINRESOLVE_DEMO_CANARY_SECRET);
  if (mode === "full" && !canarySecret) {
    throw new Error("KINRESOLVE_DEMO_CANARY_SECRET is required for a full monitor.");
  }
  return Object.freeze({
    origin: origin.origin,
    requestOrigin: canonical ? origin.origin : "https://demo.kinresolve.com",
    bypassSecret,
    canarySecret
  });
}

function requestHeaders(configuration, additions = {}) {
  return {
    "origin": configuration.requestOrigin,
    "sec-fetch-site": "same-origin",
    "user-agent": "kinresolve-public-demo-monitor/1.0",
    ...(configuration.bypassSecret
      ? { "x-vercel-protection-bypass": configuration.bypassSecret }
      : {}),
    ...(configuration.canarySecret
      ? { "x-kinresolve-demo-canary": configuration.canarySecret }
      : {}),
    ...additions
  };
}

function requireExactResponse(response, expectedStatus, expectedContentType) {
  if (
    response.status !== expectedStatus
    || response.redirected
    || response.headers.has("location")
  ) {
    throw new Error("A public demo response status contract failed.");
  }
  requireContentType(response, expectedContentType);
}

function requireContentType(response, expectedContentType) {
  const actual = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!actual.startsWith(expectedContentType)) {
    throw new Error("A public demo response content-type contract failed.");
  }
}

async function boundedText(response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumResponseBytes) {
        throw new Error("A public demo response exceeded the monitor size limit.");
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function extractDemoCookie(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  const cookies = values
    .map((value) => value.split(";", 1)[0]?.trim())
    .filter((value) => value?.startsWith("__Host-kinresolve-demo="));
  if (cookies.length !== 1 || !/^__Host-kinresolve-demo=[A-Za-z0-9_-]{43,256}$/.test(cookies[0])) {
    throw new Error("The demo session cookie contract failed.");
  }
  return cookies[0];
}

function parseObject(contents) {
  let value;
  try {
    value = JSON.parse(contents);
  } catch (error) {
    throw new Error("A public demo response was not valid JSON.", { cause: error });
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("A public demo response was not a JSON object.");
  }
  return value;
}

function optionalSecret(value) {
  if (value === undefined || value === "") return null;
  if (value !== value.trim() || !/^[A-Za-z0-9_-]{20,256}$/.test(value)) {
    throw new Error("A public demo monitor credential is malformed.");
  }
  return value;
}

async function main() {
  const [mode, ...unexpected] = process.argv.slice(2);
  if (unexpected.length > 0) throw new Error("Unexpected public demo monitor arguments.");
  await runPublicDemoMonitor(mode);
  console.log(`${mode === "full" ? "Full" : "Shallow"} public demo monitor passed.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error("Public demo monitor failed.");
    process.exitCode = 1;
  });
}
