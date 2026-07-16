#!/usr/bin/env node
import axeCore from "axe-core";
import { chromium, firefox, webkit } from "playwright";

import { runPublicDemoMonitor } from "./public-demo-monitor.mjs";

const canonicalOrigin = "https://demo.kinresolve.com";
const guidedPath = "/app/cases/case-mercer-march-identity?guide=1";
const sessionCookieName = "__Host-kinresolve-demo";
const timeoutMs = 30_000;
const browserTypes = Object.freeze({ chromium, firefox, webkit });

export async function runPublicDemoBrowserCanary(
  environment = process.env,
  dependencies = {
    browserTypes,
    shallowMonitor: runPublicDemoMonitor,
    axeSource: axeCore.source
  }
) {
  const configuration = resolveConfiguration(environment);
  await dependencies.shallowMonitor("shallow", environment);

  const browserType = dependencies.browserTypes[configuration.browserName];
  if (!browserType) throw new Error("The requested public demo browser is unavailable.");
  const browserInstance = await browserType.launch({ headless: true });
  let desktopContext;
  let mobileContext;
  let staleContext;
  try {
    await auditCapacityFallback(browserInstance, configuration, dependencies.axeSource);

    desktopContext = await createContext(browserInstance, configuration, {
      viewport: { width: 1280, height: 900 }
    });
    if (configuration.browserName !== "firefox") {
      mobileContext = await createContext(browserInstance, configuration, {
        hasTouch: true,
        isMobile: true,
        viewport: { width: 390, height: 844 }
      });
    }

    const journeys = [
      {
        context: desktopContext,
        mobile: false,
        outcome: "found",
        outcomeLabel: "Likely the same writer"
      },
      ...(mobileContext ? [{
        context: mobileContext,
        mobile: true,
        outcome: "inconclusive",
        outcomeLabel: "Not enough to decide"
      }] : [])
    ];
    const pages = await Promise.all(journeys.map(async (journey) => {
      const page = await journey.context.newPage();
      await startGuidedDemo(page, dependencies.axeSource, journey.mobile);
      await chooseOutcome(page, journey.outcomeLabel);
      await auditAccessibility(page, dependencies.axeSource);
      if (journey.mobile) await assertNoMobileOverflow(page);
      await assertGuidedOutcome(journey.context, configuration, journey.outcome);
      return { ...journey, page };
    }));

    if (configuration.browserName !== "firefox") {
      await Promise.all(pages.map(async ({ page, mobile }) => {
        await runOptionalAiAndAudit(page, dependencies.axeSource);
        await submitFeedbackAndAudit(page, dependencies.axeSource);
        await exerciseBetaCta(page);
        if (mobile) await assertNoMobileOverflow(page);
      }));
    }

    const desktopPage = pages[0].page;
    const staleCookie = await requireSessionCookie(desktopContext, configuration.origin);
    await activateByKeyboard(desktopPage, "Reset demo");
    await desktopPage.getByRole("group", { name: "Confirm demo reset" }).waitFor();
    await auditAccessibility(desktopPage, dependencies.axeSource);
    const resetResponse = desktopPage.waitForResponse((response) => (
      new URL(response.url()).pathname === "/api/demo/session/reset"
    ));
    const navigation = desktopPage.waitForNavigation({ waitUntil: "domcontentloaded" });
    await activateByKeyboard(desktopPage, "Yes, reset");
    const [response] = await Promise.all([resetResponse, navigation]);
    if (response.status() !== 200) throw new Error("The browser reset contract failed.");
    const rotatedCookie = await requireSessionCookie(desktopContext, configuration.origin);
    if (rotatedCookie.value === staleCookie.value) {
      throw new Error("The browser reset did not rotate its credential.");
    }

    staleContext = await browserInstance.newContext({ baseURL: configuration.origin });
    await staleContext.addCookies([{
      name: sessionCookieName,
      value: staleCookie.value,
      url: configuration.origin
    }]);
    const stale = await staleContext.request.post(
      new URL("/api/demo/cases/case-mercer-march-identity/guide", configuration.origin).href,
      {
        data: { command: "record_outcome", outcome: "not_found" },
        failOnStatusCode: false,
        headers: requestHeaders(configuration, true),
        maxRedirects: 0,
        timeout: timeoutMs
      }
    );
    if (stale.status() !== 401 && stale.status() !== 403) {
      throw new Error("The stale browser credential remained authorized; expected 401 or 403.");
    }
    if (mobileContext) {
      await assertGuidedOutcome(mobileContext, configuration, "inconclusive");
    }
  } finally {
    const sessionContexts = [desktopContext, mobileContext].filter(Boolean);
    const cleanup = await Promise.allSettled(sessionContexts.map((context) => (
      endContextSession(context, configuration)
    )));
    await staleContext?.close().catch(() => undefined);
    await Promise.allSettled(sessionContexts.map((context) => context.close()));
    await browserInstance.close().catch(() => undefined);
    if (cleanup.some(({ status }) => status === "rejected")) {
      throw new Error("The browser canary could not clean up every disposable session.");
    }
  }
}

async function createContext(browserInstance, configuration, options) {
  const context = await browserInstance.newContext({
    baseURL: configuration.origin,
    ...options
  });
  context.setDefaultTimeout(timeoutMs);
  context.setDefaultNavigationTimeout(timeoutMs);
  await installProtectedCandidateRoute(context, configuration);
  return context;
}

async function auditCapacityFallback(browserInstance, configuration, axeSource) {
  const context = await createContext(browserInstance, configuration, {
    hasTouch: true,
    isMobile: configuration.browserName !== "firefox",
    viewport: { width: 390, height: 844 }
  });
  try {
    const page = await context.newPage();
    await page.route("**/api/demo/sessions", async (route) => {
      if (route.request().method() !== "POST") {
        await route.fallback();
        return;
      }
      await route.fulfill({
        body: JSON.stringify({
          error: "The public demo is at capacity. Please try again shortly.",
          maximumActiveSessions: 25,
          familyUrl: "/family",
          challengeUrl: "/challenge"
        }),
        headers: {
          "cache-control": "private, no-store",
          "content-type": "application/json",
          "retry-after": "300"
        },
        status: 429
      });
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await activateByKeyboard(page, "Start guided demo");
    await page.getByRole("alert").getByText("The public demo is at capacity. Please try again shortly.").waitFor();
    const family = page.getByRole("link", { name: "Explore the fictional family" });
    const challenge = page.getByRole("link", { name: "Try the research challenge" });
    if (await family.getAttribute("href") !== "/family" || await challenge.getAttribute("href") !== "/challenge") {
      throw new Error("The capacity state did not expose only fixed safe fallbacks.");
    }
    await auditAccessibility(page, axeSource);
    await assertNoMobileOverflow(page);
  } finally {
    await context.close().catch(() => undefined);
  }
}

async function startGuidedDemo(page, axeSource, mobile) {
  const response = await page.goto("/", { waitUntil: "domcontentloaded" });
  if (response?.status() !== 200) throw new Error("The demo landing page was unavailable.");
  await page.getByRole("note").getByText("Safe, synthetic, and temporary.").waitFor();
  await page.getByRole("button", { name: "Start guided demo" }).waitFor();
  await auditAccessibility(page, axeSource);
  if (mobile) await assertNoMobileOverflow(page);

  const navigation = page.waitForURL((url) => (
    url.pathname === "/app/cases/case-mercer-march-identity"
      && url.searchParams.get("guide") === "1"
  ));
  await activateByKeyboard(page, "Start guided demo");
  await navigation;
  await page.getByRole("heading", {
    name: "Do these signatures point to the same fictional person?"
  }).waitFor();
  await auditAccessibility(page, axeSource);
}

async function chooseOutcome(page, label) {
  await activateByKeyboard(page, label);
  await page.getByText("Outcome saved. Your next assignment is ready.").waitFor();
}

async function runOptionalAiAndAudit(page, axeSource) {
  await activateByKeyboard(page, "Suggest the next three checks");
  await page.getByRole("article", { name: "Curated AI result" }).waitFor();
  await page.getByText("Curated external AI analysis", { exact: true }).waitFor();
  await auditAccessibility(page, axeSource);
}

async function submitFeedbackAndAudit(page, axeSource) {
  await activateByKeyboard(page, "Share feedback");
  const usefulness = page.getByRole("radiogroup", { name: "Usefulness rating" })
    .getByRole("radio").last();
  const clarity = page.getByRole("radiogroup", { name: "Clarity rating" })
    .getByRole("radio").last();
  const feature = page.getByLabel("What would you explore next?");
  const betaInterest = page.getByRole("group", { name: "Interested in the private beta?" })
    .getByRole("radio").first();
  await activateLocatorByKeyboard(page, usefulness, "Space");
  await activateLocatorByKeyboard(page, clarity, "Space");
  await focusByKeyboard(page, feature);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await activateLocatorByKeyboard(page, betaInterest, "Space");
  await activateByKeyboard(page, "Send ratings");
  await page.getByText(
    "Thanks—your ratings were saved without free-form text or contact details."
  ).waitFor();
  await page.getByRole("button", { name: "Feedback saved" }).waitFor();
  await auditAccessibility(page, axeSource);
}

async function exerciseBetaCta(page) {
  const link = page.getByRole("link", { name: "Apply for the private beta" });
  if (await link.getAttribute("href") !== "https://kinresolve.com/beta") {
    throw new Error("The demo beta CTA destination changed.");
  }
  await link.evaluate((element) => {
    element.addEventListener("click", (event) => event.preventDefault(), { once: true });
  });
  const tracked = page.waitForResponse((response) => (
    new URL(response.url()).pathname === "/api/demo/events"
      && response.request().method() === "POST"
  ));
  await activateLocatorByKeyboard(page, link, "Enter");
  const response = await tracked;
  let body;
  try {
    body = response.request().postDataJSON();
  } catch {
    throw new Error("The beta CTA analytics request was not fixed JSON.");
  }
  if (response.status() !== 202 || body?.eventName !== "beta_cta_clicked") {
    throw new Error("The beta CTA fixed-schema event was not accepted.");
  }
}

async function activateByKeyboard(page, accessibleName) {
  const target = page.getByRole("button", { name: accessibleName }).or(
    page.getByText(accessibleName, { exact: true })
  ).first();
  await activateLocatorByKeyboard(page, target, "Enter");
}

async function activateLocatorByKeyboard(page, target, key) {
  await focusByKeyboard(page, target);
  await page.keyboard.press(key);
}

async function focusByKeyboard(page, target) {
  await target.waitFor();
  for (let index = 0; index < 240; index += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error("The demo journey was not keyboard operable.");
}

async function auditAccessibility(page, axeSource) {
  if (await page.locator("html").getAttribute("lang") !== "en") {
    throw new Error("The demo page language contract failed.");
  }
  if (await page.getByRole("main").count() !== 1) {
    throw new Error("The demo main-landmark contract failed.");
  }
  if (await page.getByRole("heading", { level: 1 }).count() !== 1) {
    throw new Error("The demo heading contract failed.");
  }
  await page.evaluate(axeSource);
  const violations = await page.evaluate(async () => {
    const result = await window.axe.run(document, {
      resultTypes: ["violations"],
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]
      }
    });
    return result.violations
      .filter(({ impact }) => impact === "serious" || impact === "critical")
      .map(({ id, nodes }) => ({ id, count: nodes.length }));
  });
  if (violations.length > 0) {
    throw new Error(`The demo accessibility contract failed (${violations.map(({ id, count }) => `${id}:${count}`).join(",")}).`);
  }
}

async function assertNoMobileOverflow(page) {
  const fits = await page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth
  ));
  if (!fits) throw new Error("The 390-pixel demo viewport has horizontal overflow.");
}

async function assertGuidedOutcome(context, configuration, expected) {
  const response = await context.request.get("/api/demo/session", {
    headers: requestHeaders(configuration, false),
    maxRedirects: 0,
    timeout: timeoutMs
  });
  if (response.status() !== 200) throw new Error("The browser session state was unavailable.");
  const document = await response.json();
  if (document?.progress?.guidedOutcome !== expected) {
    throw new Error("The browser contexts did not preserve isolated guidedOutcome state.");
  }
}

async function endContextSession(context, configuration) {
  if (!context) return;
  const cookies = await context.cookies(configuration.origin).catch(() => []);
  if (!cookies.some(({ name }) => name === sessionCookieName)) return;
  const response = await context.request.post("/api/demo/session/end", {
    data: {},
    failOnStatusCode: false,
    headers: requestHeaders(configuration, true),
    maxRedirects: 0,
    timeout: timeoutMs
  });
  if (response.status() !== 200 && response.status() !== 204) {
    throw new Error("The browser canary could not end its disposable session.");
  }
}

async function requireSessionCookie(context, origin) {
  const cookies = (await context.cookies(origin)).filter(({ name }) => name === sessionCookieName);
  if (cookies.length !== 1 || !/^[A-Za-z0-9_-]{43,256}$/.test(cookies[0].value)) {
    throw new Error("The browser session cookie contract failed.");
  }
  return cookies[0];
}

async function installProtectedCandidateRoute(context, configuration) {
  await context.route("**/*", async (route) => {
    const request = route.request();
    if (new URL(request.url()).origin !== configuration.origin) {
      await route.continue();
      return;
    }
    const mutation = !["GET", "HEAD", "OPTIONS"].includes(request.method());
    await route.continue({
      headers: {
        ...request.headers(),
        "x-kinresolve-demo-canary": configuration.canarySecret,
        ...(configuration.bypassSecret
          ? { "x-vercel-protection-bypass": configuration.bypassSecret }
          : {}),
        ...(mutation ? {
          origin: "https://demo.kinresolve.com",
          "sec-fetch-site": "same-origin"
        } : {})
      }
    });
  });
}

function requestHeaders(configuration, mutation) {
  return {
    accept: "application/json",
    "x-kinresolve-demo-canary": configuration.canarySecret,
    ...(configuration.bypassSecret
      ? { "x-vercel-protection-bypass": configuration.bypassSecret }
      : {}),
    ...(mutation ? {
      origin: "https://demo.kinresolve.com",
      "sec-fetch-site": "same-origin"
    } : {})
  };
}

function resolveConfiguration(environment) {
  const origin = exactDemoOrigin(environment.PUBLIC_DEMO_ORIGIN);
  const generatedCandidate = new URL(origin).hostname.endsWith(".vercel.app");
  const bypassSecret = optionalSecret(environment.VERCEL_AUTOMATION_BYPASS_SECRET);
  if (origin !== canonicalOrigin && (!generatedCandidate || !bypassSecret)) {
    throw new Error("The browser canary origin is not an approved public demo deployment.");
  }
  const browserName = environment.KINRESOLVE_DEMO_BROWSER ?? "chromium";
  if (!Object.hasOwn(browserTypes, browserName)) {
    throw new Error("KINRESOLVE_DEMO_BROWSER is invalid.");
  }
  return Object.freeze({
    origin,
    browserName,
    bypassSecret,
    canarySecret: requiredSecret(environment.KINRESOLVE_DEMO_CANARY_SECRET)
  });
}

function exactDemoOrigin(value) {
  if (typeof value !== "string" || value.trim() !== value) {
    throw new Error("PUBLIC_DEMO_ORIGIN is invalid.");
  }
  const url = new URL(value);
  if (url.protocol !== "https:" || url.origin !== value || url.username || url.password || url.port) {
    throw new Error("PUBLIC_DEMO_ORIGIN is invalid.");
  }
  return url.origin;
}

function requiredSecret(value) {
  const secret = optionalSecret(value);
  if (!secret) throw new Error("The public demo canary credential is required.");
  return secret;
}

function optionalSecret(value) {
  if (value === undefined || value === "") return null;
  if (typeof value !== "string" || value.trim() !== value || !/^[A-Za-z0-9_-]{20,256}$/.test(value)) {
    throw new Error("A public demo canary credential is invalid.");
  }
  return value;
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  runPublicDemoBrowserCanary().then(() => {
    console.log("Disposable public demo browser canary passed.");
  }).catch(() => {
    console.error("Disposable public demo browser canary failed.");
    process.exitCode = 1;
  });
}
