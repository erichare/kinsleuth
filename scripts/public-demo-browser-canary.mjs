#!/usr/bin/env node
import axeCore from "axe-core";
import { chromium, firefox, webkit } from "playwright";

import { runPublicDemoMonitor } from "./public-demo-monitor.mjs";

const canonicalOrigin = "https://demo.kinresolve.com";
const guidedPath = "/app/cases/case-mercer-march-identity?guide=1";
const sessionCookieName = "__Host-kinresolve-demo";
const timeoutMs = 30_000;
const browserTypes = Object.freeze({ chromium, firefox, webkit });
const keyboardTraversalKeys = Object.freeze([
  "Tab",
  "Shift+Tab",
  ...(process.platform === "darwin" ? ["Alt+Tab", "Alt+Shift+Tab"] : [])
]);
const safeBrowserCanaryControls = Object.freeze({
  "Start guided demo": "start-guided-demo",
  "Likely the same writer": "outcome-likely-same-writer",
  "Not enough to decide": "outcome-not-enough-to-decide",
  "Suggest the next three checks": "ai-next-three-checks",
  "Share feedback": "share-feedback",
  "Send ratings": "send-ratings",
  "Reset demo": "reset-demo",
  "Yes, reset": "confirm-reset"
});
const safeBrowserCanaryControlSlugs = Object.freeze(Object.values(safeBrowserCanaryControls));
const safeOptionalAiResultLabels = Object.freeze([
  "Curated external AI analysis",
  "Deterministic demo analysis"
]);
const safeBrowserCanaryStages = Object.freeze([
  "shallow-monitor",
  "browser-launch",
  "capacity-fallback",
  "capacity-context",
  "capacity-landing",
  "capacity-action",
  "capacity-result",
  "capacity-links",
  "guided-journey",
  "landing",
  "session-start",
  "outcome-save",
  "accessibility",
  "mobile-overflow",
  "mobile-overflow-landing",
  "mobile-overflow-outcome",
  "mobile-overflow-completion",
  "session-state",
  "optional-ai",
  "optional-ai-action",
  "optional-ai-response",
  "optional-ai-result",
  "feedback",
  "feedback-open",
  "feedback-usefulness",
  "feedback-clarity",
  "feedback-feature",
  "feedback-beta-interest",
  "feedback-submit-action",
  "feedback-submit-response",
  "feedback-confirmation",
  "beta-cta",
  "keyboard-target",
  "keyboard-ready",
  "keyboard-focus",
  "keyboard-activate",
  "reset",
  "reset-cookie-initial",
  "reset-open",
  "reset-confirmation",
  "reset-action",
  "reset-response",
  "reset-cookie",
  "stale-credential",
  "stale-context",
  "stale-response",
  "cleanup",
  "unknown"
]);
const safeBrowserCanarySurfaces = Object.freeze(["desktop", "mobile", "shared", "unknown"]);

export async function runPublicDemoBrowserCanary(
  environment = process.env,
  dependencies = {
    browserTypes,
    shallowMonitor: runPublicDemoMonitor,
    axeSource: axeCore.source
  }
) {
  const configuration = resolveConfiguration(environment);
  try {
    await runCanaryStage("shallow-monitor", () => (
      dependencies.shallowMonitor("shallow", environment)
    ));

    const browserType = dependencies.browserTypes[configuration.browserName];
    if (!browserType) throw browserCanaryFailure("browser-launch");
    const browserInstance = await runCanaryStage("browser-launch", () => (
      browserType.launch({ headless: true })
    ));
    let desktopContext;
    let mobileContext;
    let staleContext;
    let primaryFailure;
    let hasPrimaryFailure = false;
    try {
      await runCanaryStage("capacity-fallback", () => (
        auditCapacityFallback(browserInstance, configuration, dependencies.axeSource)
      ));

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
      const pages = await allSettledOrThrow(journeys.map((journey) => (
        runCanaryStage("guided-journey", async () => {
          const surface = journey.mobile ? "mobile" : "desktop";
          const page = await journey.context.newPage();
          await runCanaryStage("landing", () => (
            startGuidedDemo(page, dependencies.axeSource, journey.mobile)
          ), surface);
          await runCanaryStage("outcome-save", () => (
            chooseOutcome(page, journey.outcomeLabel)
          ), surface);
          await runCanaryStage("accessibility", () => (
            auditAccessibility(page, dependencies.axeSource)
          ), surface);
          if (journey.mobile) {
            await assertNoMobileOverflow(page, "mobile-overflow-outcome", surface);
          }
          await runCanaryStage("session-state", () => (
            assertGuidedOutcome(journey.context, configuration, journey.outcome)
          ), surface);
          return { ...journey, page };
        }, journey.mobile ? "mobile" : "desktop")
      )));

      if (configuration.browserName !== "firefox") {
        await allSettledOrThrow(pages.map(async ({ page, mobile }) => {
          const surface = mobile ? "mobile" : "desktop";
          await runCanaryStage("optional-ai", () => (
            runOptionalAiAndAudit(page, dependencies.axeSource, surface)
          ), surface);
          await runCanaryStage("feedback", () => (
            submitFeedbackAndAudit(page, dependencies.axeSource, surface)
          ), surface);
          await runCanaryStage("beta-cta", () => exerciseBetaCta(page), surface);
          if (mobile) {
            await assertNoMobileOverflow(page, "mobile-overflow-completion", surface);
          }
        }));
      }

      const desktopPage = pages[0].page;
      const staleCookie = await runCanaryStage("reset-cookie-initial", () => (
        requireSessionCookie(desktopContext, configuration.origin)
      ), "desktop");
      await runCanaryStage("reset-open", async () => {
        await activateByKeyboard(desktopPage, "Reset demo");
        await runCanaryStage("reset-confirmation", () => (
          desktopPage.getByRole("group", { name: "Confirm demo reset" }).waitFor()
        ), "desktop");
        await runCanaryStage("accessibility", () => (
          auditAccessibility(desktopPage, dependencies.axeSource)
        ), "desktop");
      }, "desktop");
      const resetWaiters = await runCanaryStage("reset-action", async () => {
        const resetResponse = observePlaywrightWaiter(desktopPage.waitForResponse((response) => (
          new URL(response.url()).pathname === "/api/demo/session/reset"
        )));
        const navigation = observePlaywrightWaiter(desktopPage.waitForNavigation({
          waitUntil: "domcontentloaded"
        }));
        await activateByKeyboard(desktopPage, "Yes, reset");
        return { navigation, resetResponse };
      }, "desktop");
      await runCanaryStage("reset-response", async () => {
        const [response] = await Promise.all([
          resetWaiters.resetResponse,
          resetWaiters.navigation
        ]);
        if (response.status() !== 200) {
          throw browserCanaryFailure("reset-response", { status: response.status() });
        }
      }, "desktop");
      await runCanaryStage("reset-cookie", async () => {
        const rotatedCookie = await requireSessionCookie(desktopContext, configuration.origin);
        if (rotatedCookie.value === staleCookie.value) {
          throw browserCanaryFailure("reset-cookie");
        }
      }, "desktop");

      staleContext = await runCanaryStage("stale-context", async () => {
        const context = await browserInstance.newContext({ baseURL: configuration.origin });
        await context.addCookies([{
          name: sessionCookieName,
          value: staleCookie.value,
          url: configuration.origin
        }]);
        return context;
      }, "desktop");
      await runCanaryStage("stale-response", async () => {
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
          throw browserCanaryFailure("stale-response", { status: stale.status() });
        }
      }, "desktop");
      if (mobileContext) {
        await runCanaryStage("session-state", () => (
          assertGuidedOutcome(mobileContext, configuration, "inconclusive")
        ), "mobile");
      }
    } catch (error) {
      primaryFailure = error;
      hasPrimaryFailure = true;
    } finally {
      const sessionContexts = [desktopContext, mobileContext].filter(Boolean);
      const cleanup = await Promise.allSettled(sessionContexts.map((context) => (
        endContextSession(context, configuration)
      )));
      await closeContextAfterRoutes(staleContext);
      await Promise.allSettled(sessionContexts.map(closeContextAfterRoutes));
      await browserInstance.close().catch(() => undefined);
      const selected = selectBrowserCanaryFailure(
        hasPrimaryFailure,
        primaryFailure,
        cleanup
      );
      if (selected.hasFailure) throw selected.failure;
    }
  } catch (error) {
    throw attachBrowserCanaryContext(error, configuration.browserName);
  }
}

async function allSettledOrThrow(work) {
  const settled = await Promise.allSettled(work);
  const rejected = settled.find(({ status }) => status === "rejected");
  if (rejected) throw rejected.reason;
  return settled.map((result) => result.value);
}

export function selectBrowserCanaryFailure(hasPrimaryFailure, primaryFailure, cleanup) {
  if (hasPrimaryFailure) return { failure: primaryFailure, hasFailure: true };
  return cleanup.some(({ status }) => status === "rejected")
    ? { failure: browserCanaryFailure("cleanup"), hasFailure: true }
    : { hasFailure: false };
}

async function closeContextAfterRoutes(context) {
  if (!context) return;
  await context.unrouteAll({ behavior: "wait" }).catch(() => undefined);
  await context.close().catch(() => undefined);
}

export function observePlaywrightWaiter(waiter) {
  void waiter.catch(() => undefined);
  return waiter;
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
  const { candidateContext, page } = await runCanaryStage("capacity-context", async () => {
    const candidateContext = await createContext(browserInstance, configuration, {
      hasTouch: true,
      isMobile: configuration.browserName !== "firefox",
      viewport: { width: 390, height: 844 }
    });
    const page = await candidateContext.newPage();
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
    return { candidateContext, page };
  }, "mobile");
  try {
    await runCanaryStage("capacity-landing", () => (
      page.goto("/", { waitUntil: "domcontentloaded" })
    ), "mobile");
    await runCanaryStage("capacity-action", () => (
      activateByKeyboard(page, "Start guided demo")
    ), "mobile");
    await runCanaryStage("capacity-result", () => (
      page.getByRole("alert")
        .getByText("The public demo is at capacity. Please try again shortly.")
        .waitFor()
    ), "mobile");
    await runCanaryStage("capacity-links", async () => {
      const fallback = page.getByRole("navigation", { name: "Other fictional demo options" });
      const family = fallback.getByRole("link", { name: "Explore the fictional family" });
      const challenge = fallback.getByRole("link", { name: "Try the research challenge" });
      if (await family.getAttribute("href") !== "/family"
        || await challenge.getAttribute("href") !== "/challenge") {
        throw browserCanaryFailure("capacity-links");
      }
    }, "mobile");
    await runCanaryStage("accessibility", () => (
      auditAccessibility(page, axeSource)
    ), "mobile");
    await assertNoMobileOverflow(page, "mobile-overflow-landing", "mobile");
  } finally {
    await closeContextAfterRoutes(candidateContext);
  }
}

async function startGuidedDemo(page, axeSource, mobile) {
  const response = await page.goto("/", { waitUntil: "domcontentloaded" });
  if (response?.status() !== 200) throw new Error("The demo landing page was unavailable.");
  await page.getByRole("note").getByText("Safe, synthetic, and temporary.").waitFor();
  await page.getByRole("button", { name: "Start guided demo" }).waitFor();
  await auditAccessibility(page, axeSource);
  if (mobile) await assertNoMobileOverflow(page, "mobile-overflow-landing", "mobile");

  const startResponse = observePlaywrightWaiter(page.waitForResponse((response) => (
    new URL(response.url()).pathname === "/api/demo/sessions"
      && response.request().method() === "POST"
  )));
  await activateByKeyboard(page, "Start guided demo");
  const responseAfterStart = await startResponse;
  if (!responseAfterStart.ok()) {
    throw browserCanaryFailure("session-start", { status: responseAfterStart.status() });
  }
  const navigation = page.waitForURL((url) => (
    url.pathname === "/app/cases/case-mercer-march-identity"
      && url.searchParams.get("guide") === "1"
  ));
  await navigation;
  await page.getByRole("heading", {
    name: "Do these signatures point to the same fictional person?"
  }).waitFor();
  await auditAccessibility(page, axeSource);
}

async function chooseOutcome(page, label) {
  const pageOrigin = new URL(page.url()).origin;
  const outcomeResponse = observePlaywrightWaiter(page.waitForResponse((response) => {
    const responseUrl = new URL(response.url());
    if (responseUrl.origin !== pageOrigin
      || responseUrl.pathname !== "/api/demo/cases/case-mercer-march-identity/guide"
      || response.request().method() !== "POST") {
      return false;
    }
    try {
      return response.request().postDataJSON()?.command === "record_outcome";
    } catch {
      return false;
    }
  }));
  await activateByKeyboard(page, label);
  const responseAfterOutcome = await outcomeResponse;
  if (!responseAfterOutcome.ok()) {
    throw browserCanaryFailure("outcome-save", { status: responseAfterOutcome.status() });
  }
  await page.getByText("Outcome saved. Your next assignment is ready.").waitFor();
}

async function runOptionalAiAndAudit(page, axeSource, surface) {
  const aiResponse = observePlaywrightWaiter(page.waitForResponse((response) => (
    new URL(response.url()).pathname === "/api/demo/ai"
      && response.request().method() === "POST"
  )));
  await runCanaryStage("optional-ai-action", () => (
    activateByKeyboard(page, "Suggest the next three checks")
  ), surface);
  await runCanaryStage("optional-ai-response", async () => {
    const responseAfterAi = await aiResponse;
    if (!responseAfterAi.ok() || responseAfterAi.status() !== 200) {
      throw browserCanaryFailure("optional-ai-response", {
        status: responseAfterAi.status()
      });
    }
  }, surface);
  await runCanaryStage("optional-ai-result", async () => {
    const result = page.getByRole("article", { name: "Curated AI result" });
    await result.waitFor();
    let matchedLabel = null;
    for (const label of safeOptionalAiResultLabels) {
      if (await result.getByText(label, { exact: true }).isVisible().catch(() => false)) {
        matchedLabel = label;
        break;
      }
    }
    if (!safeOptionalAiResultLabels.includes(matchedLabel)) {
      throw browserCanaryFailure("optional-ai-result");
    }
    if (matchedLabel === "Deterministic demo analysis") {
      await page.getByText(
        "External AI was unavailable; a deterministic demo analysis is shown instead.",
        { exact: true }
      ).waitFor();
    }
  }, surface);
  await runCanaryStage("accessibility", () => auditAccessibility(page, axeSource), surface);
}

async function submitFeedbackAndAudit(page, axeSource, surface) {
  await runCanaryStage("feedback-open", () => (
    activateByKeyboard(page, "Share feedback")
  ), surface);
  const usefulness = page.getByRole("radiogroup", { name: "Usefulness rating" });
  const clarity = page.getByRole("radiogroup", { name: "Clarity rating" });
  const feature = page.getByLabel("What would you explore next?");
  const betaInterest = page.getByRole("group", { name: "Interested in the private beta?" })
    .getByRole("radio").first();
  await runCanaryStage("feedback-usefulness", () => (
    selectLastRadioByKeyboard(page, usefulness)
  ), surface);
  await runCanaryStage("feedback-clarity", () => (
    selectLastRadioByKeyboard(page, clarity)
  ), surface);
  await runCanaryStage("feedback-feature", async () => {
    await focusByKeyboard(page, feature);
    await page.keyboard.press("r");
    if (await feature.inputValue() !== "research-cases") {
      throw browserCanaryFailure("feedback-feature");
    }
  }, surface);
  await runCanaryStage("feedback-beta-interest", async () => {
    await activateLocatorByKeyboard(page, betaInterest, "Space");
    if (!(await betaInterest.isChecked())) {
      throw browserCanaryFailure("feedback-beta-interest");
    }
  }, surface);
  const feedbackResponse = observePlaywrightWaiter(page.waitForResponse((response) => (
    new URL(response.url()).pathname === "/api/demo/feedback"
      && response.request().method() === "POST"
  )));
  await runCanaryStage("feedback-submit-action", () => (
    activateByKeyboard(page, "Send ratings")
  ), surface);
  await runCanaryStage("feedback-submit-response", async () => {
    const responseAfterFeedback = await feedbackResponse;
    if (!responseAfterFeedback.ok()) {
      throw browserCanaryFailure("feedback-submit-response", {
        status: responseAfterFeedback.status()
      });
    }
  }, surface);
  await runCanaryStage("feedback-confirmation", async () => {
    await page.getByText(
      "Thanks—your ratings were saved without free-form text or contact details."
    ).waitFor();
    await page.getByRole("button", { name: "Feedback saved" }).waitFor();
  }, surface);
  await runCanaryStage("accessibility", () => auditAccessibility(page, axeSource), surface);
}

async function exerciseBetaCta(page) {
  const link = page.getByRole("link", { name: "Apply for the private beta" });
  if (await link.getAttribute("href") !== "https://kinresolve.com/beta") {
    throw new Error("The demo beta CTA destination changed.");
  }
  await link.evaluate((element) => {
    element.addEventListener("click", (event) => event.preventDefault(), { once: true });
  });
  const pageOrigin = new URL(page.url()).origin;
  const tracked = observePlaywrightWaiter(page.waitForResponse((response) => {
    const responseUrl = new URL(response.url());
    const isPost = response.request().method() === "POST";
    if (responseUrl.origin !== pageOrigin
      || responseUrl.pathname !== "/api/demo/events"
      || !isPost) {
      return false;
    }
    try {
      return response.request().postDataJSON()?.eventName === "beta_cta_clicked";
    } catch {
      return false;
    }
  }));
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
  const control = Object.hasOwn(safeBrowserCanaryControls, accessibleName)
    ? safeBrowserCanaryControls[accessibleName]
    : "unknown";
  const button = page.getByRole("button", { name: accessibleName });
  const buttonCount = await button.count();
  const target = buttonCount > 0
    ? button.first()
    : page.getByText(accessibleName, { exact: true }).first();
  try {
    await activateLocatorByKeyboard(page, target, "Enter");
  } catch (error) {
    const failure = isBrowserCanaryFailure(error)
      ? error
      : browserCanaryFailure("keyboard-activate");
    failure.control = control;
    throw failure;
  }
}

async function activateLocatorByKeyboard(page, target, key) {
  await focusByKeyboard(page, target);
  await runCanaryStage("keyboard-activate", () => page.keyboard.press(key), "unknown");
}

async function selectLastRadioByKeyboard(page, group) {
  const radios = group.getByRole("radio");
  const count = await radios.count();
  if (count !== 5) throw new Error("The fixed feedback rating scale changed.");
  const first = radios.first();
  const last = radios.last();
  await focusByKeyboard(page, first);
  await page.keyboard.press("Space");
  for (let index = 1; index < count; index += 1) {
    await page.keyboard.press("ArrowRight");
  }
  if (!(await last.isChecked())) {
    throw new Error("The feedback rating radio group was not keyboard operable.");
  }
}

async function focusByKeyboard(page, target) {
  await runCanaryStage("keyboard-target", () => target.waitFor(), "unknown");
  await runCanaryStage("keyboard-ready", async () => {
    const enabledDeadline = Date.now() + timeoutMs;
    while (!(await target.isEnabled())) {
      if (Date.now() >= enabledDeadline) {
        throw browserCanaryFailure("keyboard-ready");
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }, "unknown");
  await runCanaryStage("keyboard-focus", async () => {
    for (const key of keyboardTraversalKeys) {
      for (let index = 0; index < 240; index += 1) {
        if (await target.evaluate((element) => element === document.activeElement)) return;
        await page.keyboard.press(key);
      }
    }
    if (await target.evaluate((element) => element === document.activeElement)) return;
    throw browserCanaryFailure("keyboard-focus");
  }, "unknown");
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
      .map(({ id, nodes }) => ({
        id,
        count: nodes.length,
        targets: nodes.flatMap(({ target }) => target).filter((target) => (
          typeof target === "string"
        ))
      }));
  });
  if (violations.length > 0) {
    throw browserCanaryFailure("accessibility", { violations });
  }
}

async function assertNoMobileOverflow(page, stage, surface) {
  if (!safeBrowserCanaryStages.includes(stage)) {
    throw browserCanaryFailure("unknown");
  }
  const overflow = await page.evaluate(() => {
    const viewportWidth = document.documentElement.clientWidth;
    const documentOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth;
    const elementDepth = (element) => {
      let depth = 0;
      for (let current = element; current.parentElement; current = current.parentElement) depth += 1;
      return depth;
    };
    const overflowing = Array.from(document.querySelectorAll("*")).flatMap((element) => {
      const bounds = element.getBoundingClientRect();
      const overflowAmount = Math.max(
        -bounds.left,
        bounds.right - viewportWidth,
        element.scrollWidth - element.clientWidth
      );
      return overflowAmount > 1 ? [{ element, overflowAmount }] : [];
    })
      .sort((left, right) => elementDepth(right.element) - elementDepth(left.element))
      .sort((left, right) => right.overflowAmount - left.overflowAmount);
    return {
      count: documentOverflow ? Math.max(1, overflowing.length) : 0,
      targets: overflowing.slice(0, 12).map(({ element }) => {
        const id = /^[A-Za-z0-9_-]+$/.test(element.id) ? `#${element.id}` : "";
        if (id) return id;
        const tag = element.tagName.toLowerCase();
        const classNames = Array.from(element.classList)
          .filter((name) => /^[A-Za-z0-9_-]+$/.test(name))
          .slice(0, 3);
        return `${tag}${classNames.map((name) => `.${name}`).join("")}`;
      })
    };
  });
  if (overflow.count > 0) {
    const targets = overflow.targets.filter(isSafeSyntheticCssTarget);
    throw browserCanaryFailure(stage, {
      surface,
      violations: [{ id: "horizontal-overflow", count: overflow.count, targets }]
    });
  }
}

async function assertGuidedOutcome(context, configuration, expected) {
  const response = await context.request.get("/api/demo/session", {
    headers: requestHeaders(configuration, false),
    maxRedirects: 0,
    timeout: timeoutMs
  });
  if (response.status() !== 200) {
    throw browserCanaryFailure("session-state", { status: response.status() });
  }
  const document = await response.json();
  if (document?.progress?.guidedOutcome !== expected) {
    throw browserCanaryFailure("session-state");
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
    const headers = {
      ...request.headers(),
      "x-kinresolve-demo-canary": configuration.canarySecret,
      ...(configuration.bypassSecret
        ? { "x-vercel-protection-bypass": configuration.bypassSecret }
        : {}),
      ...(mutation ? {
        origin: "https://demo.kinresolve.com",
        "sec-fetch-site": "same-origin"
      } : {})
    };
    if (configuration.generatedCandidate && mutation) {
      const response = await route.fetch({
        headers,
        maxRedirects: 0,
        timeout: timeoutMs
      });
      await route.fulfill({ response });
      return;
    }
    await route.continue({ headers });
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
    generatedCandidate,
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

async function runCanaryStage(stage, operation, surface = "shared") {
  try {
    return await operation();
  } catch (error) {
    const failure = isBrowserCanaryFailure(error) ? error : browserCanaryFailure(stage);
    if (failure.surface === "unknown" || !safeBrowserCanarySurfaces.includes(failure.surface)) {
      failure.surface = safeBrowserCanarySurfaces.includes(surface) ? surface : "unknown";
    }
    throw failure;
  }
}

function browserCanaryFailure(stage, detail = {}) {
  const failure = new Error("The public demo browser canary stage failed.");
  failure.stage = safeBrowserCanaryStages.includes(stage) ? stage : "unknown";
  failure.surface = safeBrowserCanarySurfaces.includes(detail.surface) ? detail.surface : "unknown";
  failure.control = safeBrowserCanaryControlSlugs.includes(detail.control)
    ? detail.control
    : "unknown";
  failure.status = Number.isSafeInteger(detail.status) && detail.status >= 100 && detail.status <= 599
    ? detail.status
    : null;
  failure.violations = Array.isArray(detail.violations) ? detail.violations : [];
  return failure;
}

function isBrowserCanaryFailure(error) {
  return error instanceof Error && safeBrowserCanaryStages.includes(error.stage);
}

function attachBrowserCanaryContext(error, browserName) {
  const failure = isBrowserCanaryFailure(error) ? error : browserCanaryFailure("unknown");
  failure.browserName = Object.hasOwn(browserTypes, browserName) ? browserName : "unknown";
  return failure;
}

function safeBrowserCanaryFailure(error) {
  const browserName = typeof error?.browserName === "string"
    && Object.hasOwn(browserTypes, error.browserName)
    ? error.browserName
    : "unknown";
  const stage = typeof error?.stage === "string"
    && safeBrowserCanaryStages.includes(error.stage)
    ? error.stage
    : "unknown";
  const surface = typeof error?.surface === "string"
    && safeBrowserCanarySurfaces.includes(error.surface)
    ? error.surface
    : "unknown";
  const control = typeof error?.control === "string"
    && safeBrowserCanaryControlSlugs.includes(error.control)
    ? error.control
    : "unknown";
  const status = Number.isSafeInteger(error?.status)
    && error.status >= 100
    && error.status <= 599
    ? error.status
    : null;
  const violations = Array.isArray(error?.violations)
    ? error.violations.slice(0, 8).flatMap((violation) => {
        const id = typeof violation?.id === "string" && /^[a-z0-9-]{1,80}$/.test(violation.id)
          ? violation.id
          : null;
        const count = Number.isSafeInteger(violation?.count) && violation.count > 0
          ? Math.min(violation.count, 1_000)
          : null;
        if (!id || count === null) return [];
        const targets = Array.isArray(violation.targets)
          ? violation.targets.filter(isSafeSyntheticCssTarget).slice(0, 8)
          : [];
        return [`${id}:${count}${targets.length > 0 ? `:${targets.join("|")}` : ""}`];
      })
    : [];
  const detail = violations.length > 0 ? ` accessibility=${violations.join(";")}` : "";
  const statusDetail = status === null ? "" : ` status=${status}`;
  return `Disposable public demo browser canary failed. browser=${browserName} surface=${surface} stage=${stage} control=${control}${statusDetail}${detail}`;
}

function isSafeSyntheticCssTarget(value) {
  return typeof value === "string" && /^[#.a-zA-Z0-9_ >+~:()*-]{1,160}$/.test(value);
}

if (import.meta.url === new URL(process.argv[1], "file:").href) {
  runPublicDemoBrowserCanary().then(() => {
    console.log("Disposable public demo browser canary passed.");
  }).catch((error) => {
    console.error(safeBrowserCanaryFailure(error));
    process.exitCode = 1;
  });
}
