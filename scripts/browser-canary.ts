#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import axeCore from "axe-core";
import { chromium, type APIResponse, type BrowserContext, type Page } from "playwright";

import { demoFixtureVersion } from "../lib/archive-provisioning.ts";
import { processIntegrationSyncRun } from "../lib/integrations/run-processor.ts";
import { createConfiguredArchiveObjectStorage } from "../lib/storage/object-storage.ts";
import { validateApiLaunchState } from "../lib/release-smoke.ts";
import {
  browserCanaryCaseTitle,
  browserCanarySourceName,
  parseBrowserCanaryMode,
  resolveBrowserCanaryConfiguration,
  syntheticGedcomFixtureSha256,
  type BrowserCanaryConfiguration
} from "./browser-canary-contract.ts";

const mode = parseBrowserCanaryMode(process.argv[2]);
let configuration: BrowserCanaryConfiguration;

try {
  configuration = resolveBrowserCanaryConfiguration(mode);
} catch {
  console.error("Browser canary configuration is invalid.");
  process.exit(1);
}

let currentStage = "browser startup";
let page: Page | undefined;
let authenticatedSyntheticPage = false;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let safeDiagnostic: string | undefined;
let activeSessionId: string | undefined;

async function runBrowserCanary(): Promise<void> {
  try {
    browser = await chromium.launch({ headless: configuration.headless });
    const context = await browser.newContext({
      acceptDownloads: true,
      baseURL: configuration.origin
    });
    context.setDefaultTimeout(configuration.timeoutMs);
    context.setDefaultNavigationTimeout(configuration.timeoutMs);
    page = await context.newPage();
    await installCandidateBypassRoute(page, configuration);

    await stage("exact release and cell binding", async () => validateReleaseBinding(context, configuration));
    await stage("anonymous denial", async () => validateAnonymousBoundary(context, configuration));
    await stage("API launch state", async () => validateApiState(context, configuration));
    await stage("login accessibility", async () => validateLoginPage(page!, configuration));

    if (configuration.mode === "production") {
      console.log("Production browser smoke passed without credentials, writes, screenshots, or traces.");
    } else {
      if (configuration.bootstrapOwner) {
        await stage("disposable owner bootstrap", async () => bootstrapDisposableOwner(page!, configuration));
      }
      await stage("invited identity login", async () => signInCanaryIdentity(page!, configuration));
      authenticatedSyntheticPage = true;
      await stage("synthetic research journey", async () => runSyntheticResearchJourney(page!, configuration));
      await stage("logout denial", async () => validateLogoutDenial(page!, context, configuration));
      authenticatedSyntheticPage = false;
      console.log("Synthetic authenticated browser canary passed.");
    }

    await context.close();
  } catch {
    if (configuration.mutable && authenticatedSyntheticPage && page) {
      await captureSyntheticFailureScreenshot(page, configuration).catch(() => undefined);
    }
    console.error(`Browser canary failed during ${currentStage}${safeDiagnostic ? ` (${safeDiagnostic})` : ""}.`);
    process.exitCode = 1;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

void runBrowserCanary();

async function stage(label: string, action: () => Promise<void>): Promise<void> {
  currentStage = label;
  await action();
}

async function validateReleaseBinding(
  context: BrowserContext,
  config: BrowserCanaryConfiguration
): Promise<void> {
  const response = await context.request.get("/api/internal/health", {
    headers: canaryRequestHeaders(config, { authorization: `Bearer ${config.observabilityProbeSecret}` }),
    maxRedirects: 0,
    timeout: config.timeoutMs
  });
  if (config.mode === "disposable") {
    if (response.status() !== 200 && response.status() !== 503) throw new Error();
  } else if (response.status() !== 200) {
    throw new Error();
  }
  const body = await boundedJson(response, 256 * 1024);
  if (
    body.releaseCommitSha !== config.releaseSha
    || !isRecord(body.database)
    || body.database.connected !== true
    || body.database.provisioned !== true
    || body.database.datasetModeMatches !== true
    || body.database.datasetMode !== config.datasetMode
    || !isRecord(body.api)
    || body.api.configured !== true
    || body.api.enabled !== config.apiV1Enabled
    || !isRecord(body.capabilities)
    || body.capabilities.datasetMode !== config.datasetMode
    || body.capabilities.valid !== true
  ) {
    throw new Error();
  }
  if (config.mode !== "disposable" && body.capabilities.deploymentMode !== "hosted") {
    throw new Error();
  }
  if (config.mutable && (
    config.datasetMode !== "demo"
    || body.database.demoFixtureVersion !== demoFixtureVersion
    || body.capabilities.dna !== false
    || body.capabilities.externalAi !== false
    || body.capabilities.publicArchive !== false
    || body.capabilities.publicPublishing !== false
    || body.capabilities.evidenceBinaryUploads !== false
    || body.capabilities.packageMedia !== false
    || body.capabilities.plainGedcom !== true
  )) {
    throw new Error();
  }
}

async function validateAnonymousBoundary(
  context: BrowserContext,
  config: BrowserCanaryConfiguration
): Promise<void> {
  const app = await context.request.get("/app", {
    headers: canaryRequestHeaders(config),
    maxRedirects: 0,
    timeout: config.timeoutMs
  });
  if (![302, 303, 307, 308].includes(app.status())) throw new Error();
  const location = app.headers()["location"];
  if (!location) throw new Error();
  const redirect = new URL(location, config.origin);
  if (
    redirect.origin !== config.appBaseUrl
    || redirect.pathname !== "/login"
    || redirect.searchParams.size !== 1
    || redirect.searchParams.get("next") !== "/app"
  ) throw new Error();

  const api = await context.request.get("/api/people", {
    headers: canaryRequestHeaders(config),
    maxRedirects: 0,
    timeout: config.timeoutMs
  });
  if (api.status() !== 401) throw new Error();
  const body = await boundedJson(api, 16 * 1024);
  if (Object.keys(body).length !== 1 || body.error !== "Authentication required") throw new Error();
}

async function validateApiState(
  context: BrowserContext,
  config: BrowserCanaryConfiguration
): Promise<void> {
  const response = await context.request.get("/api/v1/meta", {
    headers: canaryRequestHeaders(config),
    maxRedirects: 0,
    timeout: config.timeoutMs
  });
  const body = await boundedText(response, 16 * 1024);
  validateApiLaunchState({
    status: response.status(),
    contentType: response.headers()["content-type"] ?? null,
    body,
    headers: new Headers(response.headers())
  }, config.apiV1Enabled);

  const invalidMethod = await context.request.post("/api/v1/meta", {
    headers: canaryRequestHeaders(config),
    maxRedirects: 0,
    timeout: config.timeoutMs
  });
  const invalidHeaders = invalidMethod.headers();
  const invalidBody = await boundedJson(invalidMethod, 16 * 1024);
  const invalidVary = (invalidHeaders.vary ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (
    invalidMethod.status() !== 405
    || invalidHeaders.allow !== "GET"
    || invalidHeaders["cache-control"] !== "private, no-store, max-age=0"
    || invalidVary.filter((value) => value === "authorization").length !== 1
    || invalidHeaders["access-control-allow-origin"] !== undefined
    || invalidBody.code !== "method_not_allowed"
    || invalidBody.message !== "Method not allowed"
    || typeof invalidBody.requestId !== "string"
    || !/^[0-9a-f-]{36}$/.test(invalidBody.requestId)
  ) throw new Error();
}

async function validateLoginPage(pageToUse: Page, config: BrowserCanaryConfiguration): Promise<void> {
  const response = await pageToUse.goto(new URL("/login", config.origin).href, { waitUntil: "domcontentloaded" });
  if (response?.status() !== 200 || new URL(pageToUse.url()).origin !== config.origin) throw new Error();
  await expectVisible(pageToUse.getByRole("heading", { level: 1, name: /Private (beta )?workspace/ }));
  await expectVisible(pageToUse.getByLabel("Email"));
  await expectVisible(pageToUse.getByLabel("Password"));
  await expectVisible(pageToUse.getByRole("button", { name: "Sign in" }));
  await validateAccessibility(pageToUse);
}

async function bootstrapDisposableOwner(
  pageToUse: Page,
  config: BrowserCanaryConfiguration
): Promise<void> {
  await pageToUse.goto(new URL("/setup", config.origin).href, { waitUntil: "domcontentloaded" });
  await pageToUse.waitForLoadState("networkidle");
  if (new URL(pageToUse.url()).origin !== config.origin) throw new Error();
  const createButton = pageToUse.getByRole("button", { name: "Create owner account" });
  if (await createButton.count() === 0) return;
  await pageToUse.getByLabel("Name").fill("Synthetic Browser Canary");
  await pageToUse.getByLabel("Email").fill(config.email!);
  await pageToUse.getByLabel("Password (at least 10 characters)").fill(config.password!);
  await createButton.click();
  await pageToUse.waitForURL((url) => url.origin === config.origin && url.pathname === "/app");
  await expectVisible(pageToUse.getByRole("heading", { level: 1, name: "Investigation Dashboard" }));
  await captureAuthenticatedSession(pageToUse.context(), config);
  await pageToUse.getByRole("button", { name: "Sign out" }).first().click();
  await pageToUse.waitForURL((url) => url.origin === config.origin && url.pathname === "/login");
}

async function captureAuthenticatedSession(
  context: BrowserContext,
  config: BrowserCanaryConfiguration
): Promise<void> {
  const session = await context.request.get("/api/auth/get-session", {
    headers: canaryRequestHeaders(config),
    maxRedirects: 0,
    timeout: config.timeoutMs
  });
  if (session.status() !== 200) throw new Error();
  const sessionBody = await boundedJson(session, 32 * 1024);
  if (
    !isRecord(sessionBody.user)
    || !isRecord(sessionBody.session)
    || typeof sessionBody.user.id !== "string"
    || typeof sessionBody.session.id !== "string"
    || !/^[A-Za-z0-9_-]{8,128}$/.test(sessionBody.session.id)
    || Object.hasOwn(sessionBody.session, "token")
    || (config.userId && sessionBody.user.id !== config.userId)
  ) throw new Error();
  activeSessionId = sessionBody.session.id;
}

async function signInCanaryIdentity(
  pageToUse: Page,
  config: BrowserCanaryConfiguration
): Promise<void> {
  await pageToUse.goto(new URL("/login?next=/app", config.origin).href, { waitUntil: "domcontentloaded" });
  await pageToUse.waitForLoadState("networkidle");
  await pageToUse.getByLabel("Email").fill(config.email!);
  await pageToUse.getByLabel("Password").fill(config.password!);
  await pageToUse.getByRole("button", { name: "Sign in" }).click();
  await pageToUse.waitForURL((url) => url.origin === config.origin && url.pathname === "/app");
  await expectVisible(pageToUse.getByRole("heading", { level: 1, name: "Investigation Dashboard" }));
  await captureAuthenticatedSession(pageToUse.context(), config);
}

async function runSyntheticResearchJourney(
  pageToUse: Page,
  config: BrowserCanaryConfiguration
): Promise<void> {
  currentStage = "synthetic dashboard accessibility";
  await validateAccessibility(pageToUse);
  currentStage = "synthetic dashboard content";
  await expectVisible(pageToUse.locator('[aria-label="Active archive"]').first());
  await expectVisible(pageToUse.getByRole("region", { name: "Active research cases" }));
  currentStage = "synthetic dataset disclosure";
  const topbarDatasetBadge = pageToUse.locator(".app-topbar .dataset-badge");
  if (
    await topbarDatasetBadge.count() !== 1
    || (await topbarDatasetBadge.textContent())?.trim() !== "Synthetic demo"
  ) throw new Error();
  await expectVisible(topbarDatasetBadge);

  currentStage = "synthetic people search";
  await exactGoto(pageToUse, config, "/app/people");
  await expectVisible(pageToUse.getByRole("heading", { level: 1, name: "People" }));
  const peopleSearch = pageToUse.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.origin === config.origin
      && url.pathname === "/api/people"
      && url.searchParams.get("query") === "Mercer"
      && response.status() === 200;
  });
  await pageToUse.getByRole("textbox", { name: "Search people" }).fill("Mercer");
  await peopleSearch;
  await expectVisible(pageToUse.getByRole("region", { name: "Imported and curated people" }));
  await validateAccessibility(pageToUse);

  currentStage = "synthetic case creation";
  await exactGoto(pageToUse, config, "/app/cases");
  await expectVisible(pageToUse.getByRole("heading", { level: 1, name: "Cases" }));
  await validateAccessibility(pageToUse);
  const newCase = pageToUse.getByRole("complementary").filter({
    has: pageToUse.getByRole("heading", { level: 2, name: "New case" })
  });
  const caseTitle = browserCanaryCaseTitle(config);
  currentStage = "synthetic case title";
  await newCase.getByLabel("Title", { exact: true }).fill(caseTitle);
  currentStage = "synthetic case question";
  await newCase.getByRole("textbox", { name: "Research question", exact: true }).fill("Does the synthetic canary persist one cited research question?");
  currentStage = "synthetic case focus";
  await newCase.getByLabel("Focus", { exact: true }).fill("Synthetic browser behavior only; no participant or family record.");
  currentStage = "synthetic case hypothesis";
  await newCase.getByRole("textbox", { name: "First hypothesis", exact: true }).fill("The isolated demo cell preserves this synthetic canary case after reload.");
  currentStage = "synthetic case evidence";
  await newCase.getByRole("textbox", { name: "First evidence note", exact: true }).fill("The checked release SHA and demo fixture are the only canary evidence inputs.");
  currentStage = "synthetic case submission";
  const createCaseResponse = pageToUse.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.origin === config.origin
      && url.pathname === "/api/cases"
      && response.request().method() === "POST";
  });
  await newCase.getByRole("button", { name: "Create case" }).click();
  const createdCase = await createCaseResponse;
  if (createdCase.status() !== 201) {
    safeDiagnostic = `case create status ${createdCase.status()}`;
    throw new Error();
  }
  await expectVisible(pageToUse.getByRole("status").filter({ hasText: "Case created" }));
  safeDiagnostic = undefined;
  currentStage = "synthetic case reload";
  await pageToUse.reload({ waitUntil: "domcontentloaded" });
  currentStage = "synthetic case search";
  const persistedCaseSearch = pageToUse.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.origin === config.origin
      && url.pathname === "/api/cases"
      && url.searchParams.get("query") === caseTitle
      && response.status() === 200;
  });
  await pageToUse.getByRole("textbox", { name: "Search cases" }).fill(caseTitle);
  await persistedCaseSearch;
  currentStage = "synthetic case link";
  const createdCaseLink = pageToUse
    .getByRole("region", { name: "Investigation case queue" })
    .getByRole("link", { name: caseTitle, exact: true });
  await expectVisible(createdCaseLink);
  currentStage = "synthetic case detail navigation";
  await createdCaseLink.click();
  await pageToUse.waitForURL((url) => url.origin === config.origin && url.pathname.startsWith("/app/cases/"));
  currentStage = "synthetic case detail content";
  const caseHeading = pageToUse.getByRole("heading", { level: 1, name: caseTitle, exact: true });
  const caseHeadingCount = await caseHeading.count();
  if (caseHeadingCount !== 1) {
    safeDiagnostic = `case heading count ${caseHeadingCount}`;
    throw new Error();
  }
  await expectVisible(caseHeading);
  safeDiagnostic = undefined;
  currentStage = "synthetic case evidence content";
  await expectVisible(pageToUse.getByRole("heading", { level: 2, name: "Evidence", exact: true }));
  currentStage = "synthetic case detail accessibility";
  await validateAccessibility(pageToUse);

  currentStage = "synthetic data portability";
  await exactGoto(pageToUse, config, "/app/imports");
  await expectVisible(pageToUse.getByRole("heading", { level: 1, name: "Data sources" }));
  await expectVisible(pageToUse.getByRole("heading", { level: 2, name: "GEDCOM" }));
  await expectVisible(pageToUse.getByRole("link", { name: "Export GEDCOM" }));
  await validateGedcomDownload(pageToUse, false);
  await validateAccessibility(pageToUse);
  await validateGedcomRoundTrip(pageToUse, config);

  currentStage = "synthetic capability boundary";
  await exactGoto(pageToUse, config, "/app/settings");
  await expectVisible(pageToUse.getByRole("heading", { level: 1, name: "Settings" }));
  await expectVisible(pageToUse.getByRole("heading", { level: 2, name: "Beta capabilities" }).or(
    pageToUse.getByRole("heading", { level: 2, name: "Capabilities" })
  ));
  await expectVisible(pageToUse.getByRole("row", { name: /DNA Disabled/ }));
  await expectVisible(pageToUse.getByRole("row", { name: /External AI Disabled/ }));
  await expectVisible(pageToUse.getByRole("row", { name: /Public archive Disabled/ }));
  await expectVisible(pageToUse.getByRole("row", { name: /Public publishing Disabled/ }));
  await expectVisible(pageToUse.getByRole("row", { name: /Binary evidence uploads Disabled/ }));
  await expectVisible(pageToUse.getByRole("row", { name: /Package media Disabled/ }));
  await expectVisible(pageToUse.getByRole("row", { name: /Plain GEDCOM Enabled/ }));
  if (config.apiV1Enabled) {
    await expectVisible(pageToUse.getByRole("heading", { level: 2, name: "Developer API" }));
  } else if (await pageToUse.getByRole("heading", { level: 2, name: "Developer API" }).count() !== 0) {
    throw new Error();
  }
  await validateAccessibility(pageToUse);

  currentStage = "synthetic transcript-only source boundary";
  await exactGoto(pageToUse, config, "/app/sources");
  await expectVisible(pageToUse.getByRole("heading", { level: 1, name: "Sources" }));
  await expectVisible(pageToUse.getByText(/Transcript-only in this private beta/));
  if (await pageToUse.locator('input[type="file"]').count() !== 0) throw new Error();
  await validateAccessibility(pageToUse);

  currentStage = "synthetic local-only AI boundary";
  await exactGoto(pageToUse, config, "/app/ai");
  await expectVisible(pageToUse.getByRole("heading", { level: 1, name: "AI Analyst" }));
  await expectVisible(pageToUse.getByText("Local only", { exact: true }));
  await validateAccessibility(pageToUse);
}

async function validateGedcomDownload(pageToUse: Page, syntheticMarkerExpected: boolean): Promise<void> {
  const pendingDownload = pageToUse.waitForEvent("download");
  await pageToUse.getByRole("link", { name: "Export GEDCOM" }).click();
  const download = await pendingDownload;
  const stream = await download.createReadStream();
  if (!stream) throw new Error();
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const bytes = Buffer.from(chunk);
    total += bytes.length;
    if (total > 5 * 1024 * 1024) throw new Error();
    chunks.push(bytes);
  }
  await download.delete().catch(() => undefined);
  const gedcom = Buffer.concat(chunks).toString("utf8");
  if (!gedcom.startsWith("0 HEAD\n") || !gedcom.includes("1 SOUR KINSLEUTH") || !gedcom.endsWith("0 TRLR\n")) {
    throw new Error();
  }
  const hasSyntheticMarker = gedcom.includes("1 NAME Rowan /Canary/")
    && gedcom.includes("2 PLAC Synthetic Test Harbor");
  if (hasSyntheticMarker !== syntheticMarkerExpected) throw new Error();
}

async function validateGedcomRoundTrip(
  pageToUse: Page,
  config: BrowserCanaryConfiguration
): Promise<void> {
  const fixture = config.gedcomFixturePath!;
  const metadata = await stat(fixture);
  if (!metadata.isFile() || metadata.size < 20 || metadata.size > 64 * 1024) throw new Error();
  const fixtureBytes = await readFile(fixture);
  const digest = createHash("sha256").update(fixtureBytes).digest("hex");
  if (digest !== syntheticGedcomFixtureSha256) throw new Error();

  const sourceName = browserCanarySourceName(config);
  const gedcomCard = pageToUse.locator("article.data-source-card").filter({
    has: pageToUse.getByRole("heading", { level: 2, name: "GEDCOM", exact: true })
  });
  currentStage = "synthetic GEDCOM preflight";
  await assertSyntheticPersonMarker(pageToUse.context(), config, false);
  await gedcomCard.getByLabel("Name this GEDCOM source", { exact: true }).fill(sourceName);
  const input = gedcomCard.getByLabel("Choose GEDCOM source file", { exact: true });
  if (await input.count() !== 1) throw new Error();

  currentStage = "synthetic GEDCOM private upload";
  const connectionResponse = pageToUse.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.origin === config.origin
      && url.pathname === "/api/integrations"
      && response.request().method() === "POST";
  });
  const runResponse = pageToUse.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.origin === config.origin
      && /^\/api\/integrations\/[^/]+\/sync-runs$/.test(url.pathname)
      && response.request().method() === "POST";
  });
  await input.setInputFiles(fixture);
  const connection = await connectionResponse;
  if (connection.status() !== 201) throw new Error();
  const connectionBody = await boundedJson(connection, 32 * 1024);
  if (
    !isRecord(connectionBody.connection)
    || typeof connectionBody.connection.id !== "string"
    || !/^integration-[0-9a-f-]{36}$/.test(connectionBody.connection.id)
    || connectionBody.connection.provider !== "gedcom"
    || connectionBody.connection.displayName !== sourceName
  ) throw new Error();
  const connectionId = connectionBody.connection.id;

  const queued = await runResponse;
  if (queued.status() !== 202) throw new Error();
  const queuedBody = await boundedJson(queued, 32 * 1024);
  if (
    !isRecord(queuedBody.run)
    || typeof queuedBody.run.id !== "string"
    || !/^sync-run-[0-9a-f-]{36}$/.test(queuedBody.run.id)
    || queuedBody.run.connectionId !== connectionId
    || queuedBody.run.status !== "queued"
  ) throw new Error();
  const runId = queuedBody.run.id;
  await expectVisible(gedcomCard.getByRole("status").filter({ hasText: "Refresh queued" }));

  currentStage = "synthetic GEDCOM queued reload";
  await pageToUse.reload({ waitUntil: "domcontentloaded" });
  const reloadedCard = pageToUse.locator("article.data-source-card").filter({
    has: pageToUse.getByRole("heading", { level: 2, name: "GEDCOM", exact: true })
  });
  await expectVisible(reloadedCard.getByText(sourceName, { exact: true }));
  await expectVisible(reloadedCard.getByRole("status").filter({ hasText: "Refresh queued" }));

  currentStage = "synthetic GEDCOM exact processor invocation";
  process.env.DATABASE_AUTO_MIGRATE = "false";
  const databaseUrl = requiredPrivateEnvironment("DATABASE_URL");
  const processed = await processIntegrationSyncRun(runId, {
    archiveId: config.archiveId!,
    databaseUrl,
    objectStorage: createConfiguredArchiveObjectStorage()
  });
  currentStage = "synthetic GEDCOM processed run binding";
  if (
    processed.run.id !== runId
    || processed.run.connectionId !== connectionId
    || processed.run.status !== "review_ready"
    || processed.counts.people !== 1
  ) throw new Error();

  currentStage = "synthetic GEDCOM review";
  await expectVisible(pageToUse.getByRole("heading", { level: 2, name: "Proposed refresh changes" }));
  await expectVisible(pageToUse.getByRole("region", { name: "Import report" }));
  const approveAll = pageToUse.getByRole("button", {
    name: "Approve all safe incoming changes (including unloaded pages)"
  });
  await approveAll.click();
  const apply = pageToUse.getByRole("button", { name: "Apply reviewed changes" });
  await expectEnabled(apply);

  currentStage = "synthetic GEDCOM apply";
  const applyResponse = pageToUse.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.origin === config.origin
      && url.pathname === `/api/integration-runs/${runId}/apply`
      && response.request().method() === "POST";
  });
  await apply.click();
  if ((await applyResponse).status() !== 200) throw new Error();
  await expectVisible(pageToUse.getByRole("button", { name: "Undo this refresh" }));
  await assertSyntheticPersonMarker(pageToUse.context(), config, true);
  await validateGedcomDownload(pageToUse, true);

  currentStage = "synthetic GEDCOM rollback";
  const rollbackResponse = pageToUse.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.origin === config.origin
      && url.pathname === `/api/integration-runs/${runId}/rollback`
      && response.request().method() === "POST";
  });
  await pageToUse.getByRole("button", { name: "Undo this refresh" }).click();
  if ((await rollbackResponse).status() !== 200) throw new Error();
  await expectVisible(pageToUse.getByRole("status").filter({ hasText: "This refresh has been undone" }));
  await assertSyntheticPersonMarker(pageToUse.context(), config, false);
  await validateGedcomDownload(pageToUse, false);
}

async function validateLogoutDenial(
  pageToUse: Page,
  context: BrowserContext,
  config: BrowserCanaryConfiguration
): Promise<void> {
  currentStage = "logout submission";
  const visibleLogoutButton = pageToUse
    .getByRole("button", { name: "Sign out", exact: true })
    .filter({ visible: true });
  if (await visibleLogoutButton.count() === 0) {
    const mobileMenu = pageToUse.locator("header.app-mobile-header details.private-mobile-menu:visible");
    if (await mobileMenu.count() !== 1) throw new Error();
    await mobileMenu.locator("summary").click();
    await expectVisible(visibleLogoutButton);
  }
  const logoutResponse = pageToUse.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.origin === config.origin
      && url.pathname === "/api/auth/logout"
      && response.request().method() === "POST";
  });
  await visibleLogoutButton.first().click();
  const response = await logoutResponse;
  if (response.status() !== 204) throw new Error();
  currentStage = "logout redirect";
  await pageToUse.waitForURL((url) => url.origin === config.origin && url.pathname === "/login");
  currentStage = "logout exact session absence";
  const session = await context.request.get("/api/auth/get-session", {
    headers: canaryRequestHeaders(config),
    maxRedirects: 0,
    timeout: config.timeoutMs
  });
  if (session.status() !== 200) throw new Error();
  const sessionText = await boundedText(session, 32 * 1024);
  let sessionBody: unknown;
  try {
    sessionBody = JSON.parse(sessionText);
  } catch {
    throw new Error();
  }
  if (sessionBody !== null || !activeSessionId) throw new Error();
  currentStage = "logout authorization denial";
  const app = await context.request.get("/app", {
    headers: canaryRequestHeaders(config),
    maxRedirects: 0,
    timeout: config.timeoutMs
  });
  if (![302, 303, 307, 308].includes(app.status())) throw new Error();
  const location = app.headers()["location"];
  if (!location) throw new Error();
  const redirect = new URL(location, config.origin);
  if (
    redirect.origin !== config.origin
    || redirect.pathname !== "/login"
    || redirect.searchParams.size !== 1
    || redirect.searchParams.get("next") !== "/app"
  ) throw new Error();
  const people = await context.request.get("/api/people", {
    headers: canaryRequestHeaders(config),
    maxRedirects: 0,
    timeout: config.timeoutMs
  });
  if (people.status() !== 401) throw new Error();
  const denial = await boundedJson(people, 16 * 1024);
  if (Object.keys(denial).length !== 1 || denial.error !== "Authentication required") throw new Error();
  activeSessionId = undefined;
}

async function installCandidateBypassRoute(
  pageToUse: Page,
  config: BrowserCanaryConfiguration
): Promise<void> {
  if (!config.vercelBypassSecret) return;
  await pageToUse.route("**/*", async (route) => {
    const request = route.request();
    const target = new URL(request.url());
    if (target.origin !== config.origin) {
      await route.continue();
      return;
    }
    await route.continue({
      headers: {
        ...request.headers(),
        "x-vercel-protection-bypass": config.vercelBypassSecret!
      }
    });
  });
}

async function assertSyntheticPersonMarker(
  context: BrowserContext,
  config: BrowserCanaryConfiguration,
  expected: boolean
): Promise<void> {
  const response = await context.request.get("/api/people?query=Rowan%20Canary&page=1&pageSize=50", {
    headers: canaryRequestHeaders(config),
    maxRedirects: 0,
    timeout: config.timeoutMs
  });
  if (response.status() !== 200) throw new Error();
  const body = await boundedJson(response, 128 * 1024);
  if (!Array.isArray(body.items)) throw new Error();
  const count = body.items.filter((item) => (
    isRecord(item) && item.displayName === "Rowan Canary"
  )).length;
  if (count !== (expected ? 1 : 0)) throw new Error();
}

function canaryRequestHeaders(
  config: BrowserCanaryConfiguration,
  headers: Record<string, string> = {}
): Record<string, string> {
  return config.vercelBypassSecret
    ? { ...headers, "x-vercel-protection-bypass": config.vercelBypassSecret }
    : headers;
}

async function validateAccessibility(pageToUse: Page): Promise<void> {
  if (await pageToUse.locator("html").getAttribute("lang") !== "en") {
    safeDiagnostic = "accessibility html-lang";
    throw new Error();
  }
  if (await pageToUse.getByRole("main").count() !== 1) {
    safeDiagnostic = "accessibility main-landmark";
    throw new Error();
  }
  if (await pageToUse.getByRole("heading", { level: 1 }).count() !== 1) {
    safeDiagnostic = "accessibility h1-count";
    throw new Error();
  }
  safeDiagnostic = "accessibility axe-execution";
  await pageToUse.evaluate(axeCore.source);
  const violations = await pageToUse.evaluate(async () => {
    const axe = (window as typeof window & {
      axe?: {
        run(root: Document, options: Record<string, unknown>): Promise<{
          violations: Array<{ id: string; impact: string | null; nodes: unknown[] }>;
        }>;
      };
    }).axe;
    if (!axe) return [{ id: "axe-unavailable", impact: "critical", count: 1 }];
    const result = await axe.run(document, {
      resultTypes: ["violations"],
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }
    });
    return result.violations
      .filter((violation) => violation.impact === "critical" || violation.impact === "serious")
      .map((violation) => ({ id: violation.id, impact: violation.impact, count: violation.nodes.length }));
  });
  if (violations.length > 0) {
    const safeSummary = violations.map((violation) => `${violation.id}:${violation.count}`).join(",");
    safeDiagnostic = `accessibility ${safeSummary}`;
    throw new Error(`Accessibility checks failed (${safeSummary}).`);
  }
  safeDiagnostic = undefined;
}

async function exactGoto(
  pageToUse: Page,
  config: BrowserCanaryConfiguration,
  pathname: string
): Promise<void> {
  const response = await pageToUse.goto(new URL(pathname, config.origin).href, { waitUntil: "domcontentloaded" });
  const current = new URL(pageToUse.url());
  if (response?.status() !== 200 || current.origin !== config.origin || current.pathname !== pathname) throw new Error();
}

async function captureSyntheticFailureScreenshot(
  pageToUse: Page,
  config: BrowserCanaryConfiguration
): Promise<void> {
  const current = new URL(pageToUse.url());
  if (current.origin !== config.origin || !current.pathname.startsWith("/app")) return;
  const directory = path.join(process.cwd(), "output", "playwright");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const filename = `browser-canary-${config.mode}-${config.releaseSha.slice(0, 12)}-${config.runId}.png`;
  await pageToUse.screenshot({
    animations: "disabled",
    fullPage: true,
    mask: [pageToUse.locator("input, textarea, select, [contenteditable=true]")],
    path: path.join(directory, filename),
    timeout: 10_000
  });
}

type BoundedResponse = Pick<APIResponse, "body">;

async function boundedJson(response: BoundedResponse, maximumBytes: number): Promise<Record<string, unknown>> {
  const text = await boundedText(response, maximumBytes);
  const value = JSON.parse(text) as unknown;
  if (!isRecord(value)) throw new Error();
  return value;
}

async function boundedText(response: BoundedResponse, maximumBytes: number): Promise<string> {
  const bytes = await response.body();
  if (bytes.length > maximumBytes) throw new Error();
  return bytes.toString("utf8");
}

async function expectVisible(locator: ReturnType<Page["locator"]>): Promise<void> {
  await locator.waitFor({ state: "visible" });
}

async function expectEnabled(locator: ReturnType<Page["locator"]>): Promise<void> {
  await locator.click({ trial: true });
}

function requiredPrivateEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error();
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
