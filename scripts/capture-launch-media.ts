#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium, type APIResponse, type Page } from "playwright";
import sharp from "sharp";

import { processIntegrationSyncRun } from "../lib/integrations/run-processor.ts";
import { createConfiguredArchiveObjectStorage } from "../lib/storage/object-storage.ts";
import launchMediaContent from "../site/lib/launch-media-content.json";
import {
  resolveBrowserCanaryConfiguration,
  syntheticGedcomFixtureSha256
} from "./browser-canary-contract.ts";

const captureAcknowledgement =
  "I confirm this launch-media capture uses only the disposable Hartwell-Mercer synthetic demo cell.";
const outputWidth = 1600;
const outputHeight = 1000;
const sourceName = "Hartwell–Mercer launch demonstration";
const captureContent = new Map(
  launchMediaContent.captures.map((record) => [record.filename, record] as const)
);

type CaptureRecord = Readonly<{
  alt: string;
  filename: string;
  sha256: string;
  title: string;
}>;

async function main(): Promise<void> {
  if (process.env.KINRESOLVE_LAUNCH_MEDIA_CAPTURE_ACKNOWLEDGEMENT !== captureAcknowledgement) {
    throw new Error("Launch-media capture requires the exact synthetic-data acknowledgement.");
  }
  const configuration = resolveBrowserCanaryConfiguration("disposable");
  if (!configuration.bootstrapOwner || !configuration.headless || !configuration.mutable) {
    throw new Error("Launch-media capture requires the headless disposable owner-bootstrap profile.");
  }
  const checkedOutCommit = gitOutput(["rev-parse", "HEAD"]);
  if (checkedOutCommit !== configuration.releaseSha) {
    throw new Error("Launch-media capture must run from the exact canary release commit.");
  }
  const status = gitOutput(["status", "--porcelain", "--untracked-files=all"]);
  if (status) {
    throw new Error("Launch-media capture requires a completely clean worktree.");
  }

  const fixtureBytes = await readFile(configuration.gedcomFixturePath!);
  if (sha256(fixtureBytes) !== syntheticGedcomFixtureSha256) {
    throw new Error("The repository-owned synthetic GEDCOM fixture does not match its pinned digest.");
  }
  const contentBytes = await readFile(path.join(process.cwd(), "site", "lib", "launch-media-content.json"));

  const outputDirectory = path.join(
    process.cwd(),
    "output",
    "launch-media",
    configuration.releaseSha
  );
  await mkdir(outputDirectory, { recursive: true, mode: 0o700 });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    acceptDownloads: false,
    baseURL: configuration.origin,
    colorScheme: "light",
    deviceScaleFactor: 1,
    locale: "en-US",
    reducedMotion: "reduce",
    serviceWorkers: "block",
    viewport: { width: outputWidth, height: outputHeight }
  });
  await context.route("**/*", async (route) => {
    let requestOrigin: string;
    try {
      requestOrigin = new URL(route.request().url()).origin;
    } catch {
      await route.abort("blockedbyclient");
      return;
    }
    if (requestOrigin !== configuration.origin) {
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  const websocketOrigin = configuration.origin.replace(/^http/, "ws");
  await context.routeWebSocket(/.*/, async (websocket) => {
    if (new URL(websocket.url()).origin !== websocketOrigin) {
      await websocket.close({ code: 1008, reason: "Launch-media capture is loopback-only." });
      return;
    }
    websocket.connectToServer();
  });
  context.setDefaultNavigationTimeout(configuration.timeoutMs);
  context.setDefaultTimeout(configuration.timeoutMs);
  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.name));

  const captures: CaptureRecord[] = [];
  try {
    await verifyCell(page, configuration.releaseSha);
    await bootstrapOwner(page, configuration.origin, configuration.email!, configuration.password!);

    await exactGoto(page, configuration.origin, "/app");
    await page.getByRole("heading", { level: 1, name: "Investigation Dashboard" }).waitFor();
    captures.push(await capture(page, outputDirectory, captureMetadata("01-synthetic-dashboard.webp")));

    await exactGoto(page, configuration.origin, "/app/imports");
    const gedcomCard = page.locator("article.data-source-card").filter({
      has: page.getByRole("heading", { level: 2, name: "GEDCOM", exact: true })
    });
    await gedcomCard.getByLabel("Name this GEDCOM source", { exact: true }).fill(sourceName);
    const connectionResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.origin === configuration.origin
        && url.pathname === "/api/integrations"
        && response.request().method() === "POST";
    }).catch(() => {
      throw new Error("Launch-media capture did not observe the GEDCOM connection response.");
    });
    const runResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.origin === configuration.origin
        && /^\/api\/integrations\/[^/]+\/sync-runs$/.test(url.pathname)
        && response.request().method() === "POST";
    }).catch(() => {
      throw new Error("Launch-media capture did not observe the GEDCOM refresh-queue response.");
    });
    await gedcomCard.getByLabel("Choose GEDCOM source file", { exact: true })
      .setInputFiles(configuration.gedcomFixturePath!);
    const connection = await boundedJson(await connectionResponse, 32 * 1024);
    const queued = await boundedJson(await runResponse, 32 * 1024);
    const connectionId = nestedIdentifier(connection, "connection");
    const runId = nestedIdentifier(queued, "run");
    await gedcomCard.getByRole("status").filter({ hasText: "Refresh queued" }).waitFor();
    captures.push(await capture(page, outputDirectory, captureMetadata("02-durable-gedcom-source.webp")));

    const processed = await processIntegrationSyncRun(runId, {
      archiveId: configuration.archiveId!,
      databaseUrl: requiredEnvironment("DATABASE_URL"),
      objectStorage: createConfiguredArchiveObjectStorage()
    });
    if (
      processed.run.id !== runId
      || processed.run.connectionId !== connectionId
      || processed.run.status !== "review_ready"
    ) {
      throw new Error("The synthetic GEDCOM did not reach the exact review-ready state.");
    }
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { level: 2, name: "Proposed refresh changes" }).waitFor();
    await page.getByRole("region", { name: "Import report" }).waitFor();
    const changeGroups = page.locator(".sync-change-groups");
    await changeGroups.waitFor();
    await changeGroups.getByRole("heading", { level: 3, name: /Incoming changes/ }).waitFor();
    await page.getByText("Loading proposed changes…", { exact: true }).waitFor({ state: "detached" });
    captures.push(await capture(page, outputDirectory, captureMetadata("03-review-before-apply.webp")));

    await exactGoto(page, configuration.origin, "/app/cases/case-mercer-march-identity");
    await page.getByRole("heading", { level: 1 }).waitFor();
    await page.getByRole("heading", { level: 2, name: "Evidence", exact: true }).waitFor();
    captures.push(await capture(page, outputDirectory, captureMetadata("04-evidence-and-hypotheses.webp")));

    const sourceRegisterResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.origin === configuration.origin
        && url.pathname === "/api/sources"
        && response.request().method() === "GET";
    }).catch(() => {
      throw new Error("Launch-media capture did not observe the settled source-register response.");
    });
    await exactGoto(page, configuration.origin, "/app/sources");
    await page.getByRole("heading", { level: 1, name: "Sources" }).waitFor();
    await page.getByText(/Transcript-only in this private beta/).waitFor();
    const settledSourceResponse = await sourceRegisterResponse;
    if (settledSourceResponse.status() !== 200) {
      throw new Error("Launch-media source register refresh did not return HTTP 200.");
    }
    const settledSourceBody = await boundedJson(settledSourceResponse, 256 * 1024);
    if (!Array.isArray(settledSourceBody.items) || settledSourceBody.items.length === 0) {
      throw new Error("Launch-media source register refresh returned no synthetic sources.");
    }
    const sourceRegister = page.locator('section.people-search-card[aria-busy="false"]');
    await sourceRegister.waitFor();
    await page.getByText(/Updating\.\.\./).waitFor({ state: "detached" });
    if (await sourceRegister.locator(".form-error").count() !== 0) {
      throw new Error("Launch-media source frame is not in the exact settled register state.");
    }
    captures.push(await capture(page, outputDirectory, captureMetadata("05-sources-in-context.webp")));

    await exactGoto(page, configuration.origin, "/app/reports");
    await page.getByText("Deterministic checks · No external AI used", { exact: true }).waitFor();
    captures.push(await capture(page, outputDirectory, captureMetadata("06-deterministic-quality.webp")));

    await exactGoto(page, configuration.origin, "/app/settings");
    const apiHeading = page.getByRole("heading", { level: 2, name: "Developer API" });
    await apiHeading.waitFor();
    await page.getByText("No API tokens yet.", { exact: true }).waitFor();
    if (
      await page.getByText("Shown once — copy this secret before dismissing it", { exact: true }).count() !== 0
      || await page.locator(".form-error").count() !== 0
    ) {
      throw new Error("Launch-media API frame is not in the exact empty, non-secret state.");
    }
    await scrollBelowStickyHeader(page, apiHeading);
    captures.push(await capture(page, outputDirectory, captureMetadata("07-scoped-developer-api.webp")));

    await exactGoto(page, configuration.origin, "/app/imports");
    const portability = page.getByRole("heading", { level: 2, name: "Archive portability" });
    await portability.waitFor();
    await scrollBelowStickyHeader(page, portability);
    captures.push(await capture(page, outputDirectory, captureMetadata("08-export-and-control.webp")));

    if (pageErrors.length > 0) {
      throw new Error(`Launch-media pages emitted browser errors: ${[...new Set(pageErrors)].join(", ")}.`);
    }
    await page.getByRole("button", { name: "Sign out", exact: true }).first().click();
    await page.waitForURL((url) => url.origin === configuration.origin && url.pathname === "/login");
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }

  const manifest = {
    schemaVersion: 1,
    sourceCommit: configuration.releaseSha,
    contentSha256: sha256(contentBytes),
    dataset: "Hartwell-Mercer fictional demo",
    demoFixtureVersion: 1,
    capturedAt: new Date().toISOString(),
    viewport: { width: outputWidth, height: outputHeight },
    captures
  };
  await writeFile(
    path.join(outputDirectory, "capture.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { encoding: "utf8", mode: 0o600 }
  );
  console.log(`Captured ${captures.length} synthetic launch images from ${configuration.releaseSha}.`);
}

async function verifyCell(page: Page, releaseSha: string): Promise<void> {
  const response = await page.request.get("/api/internal/health", {
    headers: { authorization: `Bearer ${requiredEnvironment("KINRESOLVE_CANARY_OBSERVABILITY_PROBE_SECRET")}` },
    maxRedirects: 0
  });
  if (response.status() !== 200) {
    throw new Error("The launch-media source cell health contract is unavailable.");
  }
  const body = await boundedJson(response, 256 * 1024);
  if (
    body.status !== "ok"
    || body.releaseCommitSha !== releaseSha
    || !isRecord(body.database)
    || body.database.configured !== true
    || body.database.connected !== true
    || body.database.provisioned !== true
    || body.database.datasetMode !== "demo"
    || body.database.expectedDatasetMode !== "demo"
    || body.database.datasetModeMatches !== true
    || body.database.demoFixtureVersion !== 1
    || !isRecord(body.api)
    || body.api.enabled !== true
    || body.api.configured !== true
    || !isRecord(body.storage)
    || body.storage.configured !== true
    || !isRecord(body.scheduledWrites)
    || body.scheduledWrites.valid !== true
    || body.scheduledWrites.configured !== true
    || body.scheduledWrites.enabled !== false
    || !isRecord(body.capabilities)
    || body.capabilities.valid !== true
    || body.capabilities.deploymentMode !== "self-hosted"
    || body.capabilities.datasetMode !== "demo"
    || body.capabilities.dna !== false
    || body.capabilities.externalAi !== false
    || body.capabilities.publicArchive !== false
    || body.capabilities.publicPublishing !== false
    || body.capabilities.evidenceBinaryUploads !== false
    || body.capabilities.packageMedia !== false
    || body.capabilities.plainGedcom !== true
  ) {
    throw new Error("The launch-media source cell is not the exact isolated synthetic release cell.");
  }
}

async function bootstrapOwner(page: Page, origin: string, email: string, password: string): Promise<void> {
  await exactGoto(page, origin, "/setup");
  await page.getByLabel("Name").fill("Hartwell–Mercer Demo Curator");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password (at least 10 characters)").fill(password);
  await page.getByRole("button", { name: "Create owner account" }).click();
  await page.waitForURL((url) => url.origin === origin && url.pathname === "/app");
}

async function exactGoto(page: Page, origin: string, pathname: string): Promise<void> {
  const response = await page.goto(new URL(pathname, origin).href, { waitUntil: "domcontentloaded" });
  const current = new URL(page.url());
  if (response?.status() !== 200 || current.origin !== origin || current.pathname !== pathname) {
    throw new Error(`Launch-media navigation failed for ${pathname}.`);
  }
}

async function scrollBelowStickyHeader(page: Page, locator: ReturnType<Page["locator"]>): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -120));
}

async function capture(
  page: Page,
  outputDirectory: string,
  metadata: Omit<CaptureRecord, "sha256">
): Promise<CaptureRecord> {
  if (new URL(page.url()).hostname !== "127.0.0.1") {
    throw new Error("Launch-media capture refuses non-loopback pages.");
  }
  await page.locator(".app-topbar .dataset-badge").getByText("Synthetic demo", { exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  const png = await page.screenshot({
    animations: "disabled",
    caret: "hide",
    fullPage: false,
    type: "png"
  });
  const outputPath = path.join(outputDirectory, metadata.filename);
  const webp = await sharp(png)
    .resize(outputWidth, outputHeight, { fit: "cover", position: "top" })
    .webp({ effort: 6, quality: 88, smartSubsample: true })
    .toBuffer();
  const imageMetadata = await sharp(webp).metadata();
  if (
    imageMetadata.width !== outputWidth
    || imageMetadata.height !== outputHeight
    || imageMetadata.format !== "webp"
    || imageMetadata.exif
    || imageMetadata.xmp
  ) {
    throw new Error(`Launch image ${metadata.filename} failed its metadata contract.`);
  }
  await writeFile(outputPath, webp, { mode: 0o600 });
  return { ...metadata, sha256: sha256(webp) };
}

async function boundedJson(response: Pick<APIResponse, "body">, maximumBytes: number): Promise<Record<string, unknown>> {
  const bytes = await response.body();
  if (bytes.length > maximumBytes) throw new Error("Launch-media response exceeded its bound.");
  const value = JSON.parse(bytes.toString("utf8")) as unknown;
  if (!isRecord(value)) throw new Error("Launch-media response was not an object.");
  return value;
}

function nestedIdentifier(value: Record<string, unknown>, key: string): string {
  const nested = value[key];
  if (!isRecord(nested) || typeof nested.id !== "string" || !nested.id) {
    throw new Error(`Launch-media response omitted ${key}.id.`);
  }
  return nested.id;
}

function captureMetadata(filename: string): Omit<CaptureRecord, "sha256"> {
  const record = captureContent.get(filename);
  if (!record) throw new Error(`Launch-media content is missing ${filename}.`);
  return { alt: record.alt, filename: record.filename, title: record.title };
}

function gitOutput(args: string[]): string {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for launch-media capture.`);
  return value;
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Launch-media capture failed.");
  process.exitCode = 1;
});
