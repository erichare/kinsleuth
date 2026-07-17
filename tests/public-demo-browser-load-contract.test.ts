import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  const absolute = path.join(process.cwd(), relativePath);
  return existsSync(absolute) ? readFileSync(absolute, "utf8") : "";
}

const browser = source("scripts/public-demo-browser-canary.mjs");
const load = source("scripts/public-demo-load-test.mjs");
const release = source(".github/workflows/public-demo-release.yml");
const monitoring = source(".github/workflows/public-demo-monitoring.yml");
const sessionStore = source("lib/public-demo-session-store.ts");
const expectedSafeKeyboardControls = Object.freeze({
  "Start guided demo": "start-guided-demo",
  "Likely the same writer": "outcome-likely-same-writer",
  "Not enough to decide": "outcome-not-enough-to-decide",
  "Suggest the next three checks": "ai-next-three-checks",
  "Share feedback": "share-feedback",
  "Send ratings": "send-ratings",
  "Reset demo": "reset-demo",
  "Yes, reset": "confirm-reset"
});

describe("public demo browser and capacity launch gates", () => {
  it("runs the guided journey in isolated desktop and 390-pixel Playwright contexts", () => {
    expect(browser).toMatch(/from ["']playwright["']/);
    expect(browser).toMatch(/from ["']axe-core["']/);
    expect(browser).toContain("desktopContext");
    expect(browser).toContain("mobileContext");
    expect(browser).toMatch(/width:\s*390/);
    expect(browser).toContain("Start guided demo");
    expect(browser).toContain("Likely the same writer");
    expect(browser).toContain("Not enough to decide");
    expect(browser).toContain("Curated external AI analysis");
    expect(browser).toContain("guidedOutcome");
    expect(browser).toContain("/api/demo/session/reset");
    expect(browser).toMatch(/stale[\s\S]*(?:401|403)|(?:401|403)[\s\S]*stale/i);
    expect(browser).toContain("/api/demo/session/end");
    expect(browser).not.toContain('runPublicDemoMonitor("full")');
  });

  it("settles sibling canary work and drains intercepted routes before context teardown", () => {
    const runStart = browser.indexOf("export async function runPublicDemoBrowserCanary");
    const runEnd = browser.indexOf("async function createContext", runStart);
    const run = browser.slice(runStart, runEnd);
    expect(run).toMatch(/allSettledOrThrow\(journeys\.map\(/);
    expect(run).toMatch(/allSettledOrThrow\(pages\.map\(/);
    expect(run).not.toMatch(/Promise\.all\(journeys\.map\(|Promise\.all\(pages\.map\(/);

    const settleStart = browser.indexOf("async function allSettledOrThrow");
    const settleEnd = browser.indexOf("\nasync function", settleStart + 1);
    expect(settleStart).toBeGreaterThan(-1);
    expect(settleEnd).toBeGreaterThan(settleStart);
    const settle = browser.slice(settleStart, settleEnd);
    expect(settle).toMatch(/await\s+Promise\.allSettled\(/);
    expect(settle).toMatch(/status\s*===\s*["']rejected["']/);
    expect(settle).toMatch(/throw\s+\w+\.reason/);
    expect(settle.indexOf("Promise.allSettled(")).toBeLessThan(settle.indexOf("throw"));

    const closeStart = browser.indexOf("async function closeContextAfterRoutes");
    const closeEnd = browser.indexOf("\nasync function", closeStart + 1);
    expect(closeStart).toBeGreaterThan(-1);
    expect(closeEnd).toBeGreaterThan(closeStart);
    const close = browser.slice(closeStart, closeEnd);
    expect(close).toMatch(/await\s+context\.unrouteAll\(\{\s*behavior:\s*["']wait["']\s*\}\)/);
    expect(close).toMatch(/unrouteAll[\s\S]*\.catch\(\(\)\s*=>\s*undefined\)/);
    expect(close.indexOf("unrouteAll")).toBeLessThan(close.indexOf("context.close"));
    expect(browser.match(/closeContextAfterRoutes\(/g)?.length ?? 0).toBeGreaterThan(2);
  });

  it("preserves a primary journey failure when session cleanup also fails", () => {
    const runStart = browser.indexOf("export async function runPublicDemoBrowserCanary");
    const runEnd = browser.indexOf("async function allSettledOrThrow", runStart);
    const run = browser.slice(runStart, runEnd);

    expect(run).toMatch(/let\s+primaryFailure\s*;/);
    expect(run).toMatch(/let\s+hasPrimaryFailure\s*=\s*false/);
    expect(run).toMatch(
      /catch\s*\(error\)\s*\{[\s\S]{0,120}primaryFailure\s*=\s*error[\s\S]{0,120}hasPrimaryFailure\s*=\s*true[\s\S]{0,120}\}\s*finally/
    );
    expect(run).toMatch(
      /const\s+selected\s*=\s*selectBrowserCanaryFailure\(\s*hasPrimaryFailure,\s*primaryFailure,\s*cleanup\s*\)/
    );
    expect(run).toMatch(/if\s*\(selected\.hasFailure\)\s*throw\s+selected\.failure/);
    expect(run).not.toMatch(/if\s*\(primaryFailure\)|if\s*\(selected\.failure\)/);
    expect(run).not.toMatch(
      /if\s*\(cleanup\.some\([\s\S]{0,120}status[\s\S]{0,120}rejected[\s\S]{0,120}\)\)\s*\{?\s*throw\s+browserCanaryFailure\(["']cleanup["']/
    );
  });

  it("observes every Playwright response and navigation waiter without replacing it", () => {
    const helperStart = browser.indexOf("export function observePlaywrightWaiter");
    const helperEnd = browser.indexOf("\n}", helperStart);
    expect(helperStart).toBeGreaterThan(-1);
    expect(helperEnd).toBeGreaterThan(helperStart);
    const helper = browser.slice(helperStart, helperEnd + 2);
    expect(helper).toMatch(
      /export\s+function\s+observePlaywrightWaiter\(waiter\)\s*\{\s*void\s+waiter\.catch\(\s*\(\)\s*=>\s*undefined\s*\)\s*;\s*return\s+waiter\s*;\s*\}/
    );
    expect(helper).not.toMatch(/\basync\b|\bawait\b|new\s+Promise|console\.|error\.(?:message|stack)|JSON\.stringify/);

    const waiterCalls = Array.from(
      browser.matchAll(/\b[A-Za-z_$][\w$]*\.waitFor(?:Response|Navigation)\(/g)
    );
    expect(waiterCalls).toHaveLength(7);
    for (const call of waiterCalls) {
      const prefix = browser.slice(Math.max(0, (call.index ?? 0) - 80), call.index);
      expect(prefix).toMatch(/observePlaywrightWaiter\(\s*$/);
    }

    for (const [variable, receiver, kind] of [
      ["resetResponse", "desktopPage", "Response"],
      ["navigation", "desktopPage", "Navigation"],
      ["startResponse", "page", "Response"],
      ["outcomeResponse", "page", "Response"],
      ["aiResponse", "page", "Response"],
      ["feedbackResponse", "page", "Response"],
      ["tracked", "page", "Response"]
    ]) {
      expect(browser).toMatch(new RegExp(
        `const\\s+${variable}\\s*=\\s*observePlaywrightWaiter\\(\\s*${receiver}\\.waitFor${kind}\\(`
      ));
    }
  });

  it("awaits each original observed waiter and retains every response status gate", () => {
    for (const [waiter, response] of [
      ["startResponse", "responseAfterStart"],
      ["outcomeResponse", "responseAfterOutcome"],
      ["aiResponse", "responseAfterAi"],
      ["feedbackResponse", "responseAfterFeedback"],
      ["tracked", "response"]
    ]) {
      expect(browser).toMatch(new RegExp(`const\\s+${response}\\s*=\\s*await\\s+${waiter}\\s*;`));
    }
    for (const response of [
      "responseAfterStart",
      "responseAfterOutcome",
      "responseAfterAi",
      "responseAfterFeedback"
    ]) {
      expect(browser).toMatch(new RegExp(`${response}\\.(?:ok|status)\\(\\)`));
      expect(browser).toMatch(new RegExp(`${response}\\.status\\(\\)`));
    }

    const resetStart = browser.indexOf('runCanaryStage("reset-action"');
    const resetEnd = browser.indexOf('runCanaryStage("reset-cookie"', resetStart);
    const reset = browser.slice(resetStart, resetEnd);
    expect(reset).toMatch(/return\s*\{\s*navigation\s*,\s*resetResponse\s*\}/);
    expect(reset).toMatch(
      /Promise\.all\(\s*\[\s*resetWaiters\.resetResponse\s*,\s*resetWaiters\.navigation\s*\]\s*\)/
    );
    expect(reset).toMatch(/response\.status\(\)\s*!==\s*200/);

    const betaStart = browser.indexOf("async function exerciseBetaCta");
    const betaEnd = browser.indexOf("async function activateByKeyboard", betaStart);
    const beta = browser.slice(betaStart, betaEnd);
    expect(beta).toMatch(/const\s+response\s*=\s*await\s+tracked/);
    expect(beta).toMatch(/response\.status\(\)\s*!==\s*202/);
  });

  it("audits keyboard, WCAG 2.2 AA, and mobile overflow states", () => {
    expect(browser).toContain("keyboard.press");
    expect(browser).toContain("wcag22aa");
    expect(browser).toContain("serious");
    expect(browser).toContain("critical");
    expect(browser).toContain("document.documentElement.scrollWidth");
    expect(browser).toContain("Confirm demo reset");
    expect(browser).toContain("Share feedback");
  });

  it("emits allowlisted browser and fixed-stage context through a safe CLI failure formatter", () => {
    const cli = browser.slice(browser.indexOf("if (import.meta.url"));

    expect(cli).toMatch(/\.catch\(\s*\(?error\)?\s*=>/);
    expect(cli).toContain("safeBrowserCanaryFailure(error)");
    expect(cli).not.toMatch(/\.catch\(\s*\(\s*\)\s*=>/);
    expect(browser).toMatch(
      /const\s+safeBrowserCanaryStages\s*=\s*Object\.freeze\(\[[\s\S]*["']accessibility["']/
    );

    const formatterStart = browser.indexOf("function safeBrowserCanaryFailure");
    const formatterEnd = browser.indexOf("\nif (import.meta.url", formatterStart);
    expect(formatterStart).toBeGreaterThan(-1);
    expect(formatterEnd).toBeGreaterThan(formatterStart);
    const formatter = browser.slice(formatterStart, formatterEnd);
    expect(formatter).toMatch(/browserName/);
    expect(formatter).toMatch(/stage/);
    expect(formatter).toMatch(/safeBrowserCanaryStages\.includes\(/);
    expect(formatter).toMatch(/Object\.hasOwn\(browserTypes,/);
  });

  it("allowlists only axe summaries and synthetic CSS targets in CLI failure detail", () => {
    const formatterStart = browser.indexOf("function safeBrowserCanaryFailure");
    const formatterEnd = browser.indexOf("\nif (import.meta.url", formatterStart);
    expect(formatterStart).toBeGreaterThan(-1);
    expect(formatterEnd).toBeGreaterThan(formatterStart);
    const formatter = browser.slice(formatterStart, formatterEnd);

    expect(formatter).toMatch(/violations/);
    expect(formatter).toMatch(/\bid\b/);
    expect(formatter).toMatch(/\bcount\b/);
    expect(formatter).toMatch(/targets/);
    expect(formatter).toContain("isSafeSyntheticCssTarget");
    expect(formatter).not.toMatch(/error\.(?:message|stack)|JSON\.stringify\(\s*error|\.\.\.error/);
    expect(formatter).not.toMatch(
      /process\.env|\benvironment\b|\bheaders?\b|\bcookies?\b|\bresponseBody\b|\bprompts?\b|\bsecrets?\b/i
    );
  });

  it("emits only fixed-stage numeric load-gate diagnostics and retains primary failures", () => {
    const cli = load.slice(load.indexOf("if (import.meta.url"));
    expect(cli).toMatch(/\.catch\(\s*\(?error\)?\s*=>/);
    expect(cli).toContain("safePublicDemoLoadFailure(error)");
    expect(cli).not.toMatch(/\.catch\(\s*\(\s*\)\s*=>/);

    const stageStart = load.indexOf("const safePublicDemoLoadStages");
    const stageEnd = load.indexOf("]);", stageStart);
    expect(stageStart).toBeGreaterThan(-1);
    expect(stageEnd).toBeGreaterThan(stageStart);
    const stages = load.slice(stageStart, stageEnd);
    for (const stage of [
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
    ]) {
      expect(stages).toContain(`"${stage}"`);
    }

    const formatterStart = load.indexOf("export function safePublicDemoLoadFailure");
    const formatterEnd = load.indexOf("\nasync function request", formatterStart);
    expect(formatterStart).toBeGreaterThan(-1);
    expect(formatterEnd).toBeGreaterThan(formatterStart);
    const formatter = load.slice(formatterStart, formatterEnd);
    expect(formatter).toContain("safePublicDemoLoadStages.includes");
    for (const field of [
      "status",
      "attempted",
      "succeeded",
      "failed",
      "invalid",
      "unique",
      "p95Milliseconds",
      "cleanupFailed"
    ]) {
      expect(formatter).toContain(`"${field}"`);
    }
    expect(formatter).not.toMatch(/error\.(?:message|stack|cause)|JSON\.stringify\(\s*error|\.\.\.error/);
    expect(formatter).not.toMatch(
      /process\.env|\benvironment\b|\borigin\b|\bheaders?\b|\bcookies?\b|\b(?:response)?bod(?:y|ies)\b|\bprompts?\b|\bsecrets?\b/i
    );

    const runStart = load.indexOf("export async function runPublicDemoLoadTest");
    const runEnd = load.indexOf("async function assertCapacityBoundary", runStart);
    const run = load.slice(runStart, runEnd);
    expect(run).toMatch(/let\s+primaryFailure\s*;/);
    expect(run).toMatch(/primaryFailure\s*=\s*isLoadGateFailure\(error\)/);
    expect(run).toMatch(
      /if\s*\(primaryFailure\)\s*\{\s*throw\s+extendLoadGateFailure\(primaryFailure,\s*["']unknown["'],\s*\{\s*cleanupFailed\s*\}\)/
    );
  });

  it("guided diagnostics use fixed sub-stages, allowlisted surfaces, and numeric HTTP status", () => {
    const stageStart = browser.indexOf("const safeBrowserCanaryStages");
    const stageEnd = browser.indexOf("]);", stageStart);
    expect(stageStart).toBeGreaterThan(-1);
    expect(stageEnd).toBeGreaterThan(stageStart);
    const stageAllowlist = browser.slice(stageStart, stageEnd);
    for (const stage of [
      "landing",
      "session-start",
      "outcome-save",
      "accessibility",
      "mobile-overflow-landing",
      "mobile-overflow-outcome",
      "mobile-overflow-completion",
      "session-state"
    ]) {
      expect(stageAllowlist).toContain(`"${stage}"`);
      expect(browser.match(new RegExp(`"${stage}"`, "g"))?.length ?? 0).toBeGreaterThan(1);
    }

    expect(browser).toMatch(
      /const\s+safeBrowserCanarySurfaces\s*=\s*Object\.freeze\(\[\s*["']desktop["'],\s*["']mobile["'],\s*["']shared["']/
    );
    expect(browser).toMatch(/failure\.surface\s*=\s*safeBrowserCanarySurfaces\.includes\(/);
    expect(browser).toMatch(/failure\.status\s*=\s*Number\.isSafeInteger\(/);

    const formatterStart = browser.indexOf("function safeBrowserCanaryFailure");
    const formatterEnd = browser.indexOf("\nif (import.meta.url", formatterStart);
    const formatter = browser.slice(formatterStart, formatterEnd);
    expect(formatter).toMatch(/safeBrowserCanarySurfaces\.includes\(/);
    expect(formatter).toMatch(/Number\.isSafeInteger\([^)]*status/);
    expect(formatter).toMatch(/status\s*>=\s*100/);
    expect(formatter).toMatch(/status\s*<=\s*599/);
    expect(formatter).toMatch(/surface=\$\{surface\}/);
    expect(formatter).toMatch(/status=\$\{status\}/);
    expect(formatter).not.toMatch(/error\.(?:message|stack)|\b(?:response)?bod(?:y|ies)\b/i);
  });

  it("guided diagnostics reject a failed session-start POST before awaiting navigation", () => {
    const start = browser.indexOf("async function startGuidedDemo");
    const end = browser.indexOf("async function chooseOutcome", start);
    const guidedStart = browser.slice(start, end);
    const responseWait = guidedStart.indexOf("waitForResponse(");
    const activation = guidedStart.indexOf('activateByKeyboard(page, "Start guided demo")');
    const navigationWait = guidedStart.indexOf("await navigation", activation);

    expect(responseWait).toBeGreaterThan(-1);
    expect(responseWait).toBeLessThan(activation);
    expect(guidedStart.slice(responseWait, activation)).toContain("/api/demo/sessions");
    expect(guidedStart.slice(responseWait, activation)).toMatch(
      /request\(\)\.method\(\)\s*===\s*["']POST["']/
    );
    expect(navigationWait).toBeGreaterThan(activation);
    expect(guidedStart.slice(activation, navigationWait)).toMatch(
      /await\s+\w*[Rr]esponse[\s\S]*if\s*\([\s\S]{0,120}(?:\.ok\(\)|\.status\(\))[\s\S]{0,180}browserCanaryFailure\(["']session-start["'][\s\S]{0,120}status/
    );
  });

  it("guided diagnostics reject a failed outcome-save POST before awaiting confirmation text", () => {
    const start = browser.indexOf("async function chooseOutcome");
    const end = browser.indexOf("async function runOptionalAiAndAudit", start);
    const outcomeSave = browser.slice(start, end);
    const responseWait = outcomeSave.indexOf("waitForResponse(");
    const activation = outcomeSave.indexOf("activateByKeyboard(page, label)");
    const confirmationWait = outcomeSave.indexOf("Outcome saved. Your next assignment is ready.", activation);

    expect(responseWait).toBeGreaterThan(-1);
    expect(responseWait).toBeLessThan(activation);
    expect(outcomeSave.slice(responseWait, activation)).toContain(
      "/api/demo/cases/case-mercer-march-identity/guide"
    );
    expect(outcomeSave.slice(responseWait, activation)).toMatch(
      /request\(\)\.method\(\)\s*!==\s*["']POST["']/
    );
    expect(confirmationWait).toBeGreaterThan(activation);
    expect(outcomeSave.slice(activation, confirmationWait)).toMatch(
      /await\s+\w*[Rr]esponse[\s\S]*if\s*\([\s\S]{0,120}(?:\.ok\(\)|\.status\(\))[\s\S]{0,180}browserCanaryFailure\(["']outcome-save["'][\s\S]{0,120}status/
    );
  });

  it("correlates outcome responses to the current origin and fixed record-outcome JSON", () => {
    const start = browser.indexOf("async function chooseOutcome");
    const end = browser.indexOf("async function runOptionalAiAndAudit", start);
    const outcome = browser.slice(start, end);
    const predicateStart = outcome.indexOf("waitForResponse(");
    const activationStart = outcome.indexOf("activateByKeyboard(page, label)");
    expect(predicateStart).toBeGreaterThan(-1);
    expect(activationStart).toBeGreaterThan(predicateStart);
    const predicate = outcome.slice(predicateStart, activationStart);

    expect(outcome).toMatch(
      /const\s+pageOrigin\s*=\s*new\s+URL\(page\.url\(\)\)\.origin\s*;/
    );
    expect(predicate).toMatch(
      /const\s+responseUrl\s*=\s*new\s+URL\(response\.url\(\)\)\s*;/
    );
    expect(predicate).toMatch(/responseUrl\.origin\s*!==\s*pageOrigin/);
    expect(predicate).toMatch(
      /responseUrl\.pathname\s*!==\s*["']\/api\/demo\/cases\/case-mercer-march-identity\/guide["']/
    );
    expect(predicate).toMatch(/response\.request\(\)\.method\(\)\s*!==\s*["']POST["']/);
    expect(predicate).toMatch(
      /try\s*\{\s*return\s+response\.request\(\)\.postDataJSON\(\)\?\.command\s*===\s*["']record_outcome["']\s*;?\s*\}\s*catch\s*\{\s*return\s+false\s*;?\s*\}/
    );
    expect(predicate).not.toMatch(
      /console\.|error\.(?:message|stack)|JSON\.stringify|response\.(?:body|text)\s*\(|request\(\)\.postData\s*\(/
    );
  });

  it("correlates the beta CTA waiter to the fixed beta-click event JSON", () => {
    const start = browser.indexOf("async function exerciseBetaCta");
    const end = browser.indexOf("async function activateByKeyboard", start);
    const beta = browser.slice(start, end);
    const predicateStart = beta.indexOf("waitForResponse(");
    const activationStart = beta.indexOf("activateLocatorByKeyboard(page, link", predicateStart);
    expect(predicateStart).toBeGreaterThan(-1);
    expect(activationStart).toBeGreaterThan(predicateStart);
    const predicate = beta.slice(predicateStart, activationStart);

    expect(predicate).toContain("/api/demo/events");
    expect(predicate).toMatch(/response\.request\(\)\.method\(\)\s*===\s*["']POST["']/);
    expect(predicate).toMatch(
      /response\.request\(\)\.postDataJSON\(\)\?\.eventName\s*===\s*["']beta_cta_clicked["']/
    );
    expect(predicate).not.toMatch(
      /console\.|error\.(?:message|stack)|JSON\.stringify|response\.(?:body|text)\s*\(|request\(\)\.postData\s*\(/
    );
  });

  it("feedback diagnostics use fixed sub-stages and contextual optional-work surfaces", () => {
    const stageStart = browser.indexOf("const safeBrowserCanaryStages");
    const stageEnd = browser.indexOf("]);", stageStart);
    const stageAllowlist = browser.slice(stageStart, stageEnd);
    for (const stage of [
      "feedback-open",
      "feedback-submit-action",
      "feedback-submit-response",
      "feedback-confirmation"
    ]) {
      expect(stageAllowlist).toContain(`"${stage}"`);
      expect(browser.match(new RegExp(`"${stage}"`, "g"))?.length ?? 0).toBeGreaterThan(1);
    }
    expect(stageAllowlist).not.toContain('"feedback-submit"');

    const optionalStart = browser.indexOf("if (configuration.browserName !== \"firefox\")", stageEnd);
    const optionalEnd = browser.indexOf("const desktopPage", optionalStart);
    const optionalWork = browser.slice(optionalStart, optionalEnd);
    expect(optionalWork).toMatch(/const\s+surface\s*=\s*mobile\s*\?\s*["']mobile["']\s*:\s*["']desktop["']/);
    expect(optionalWork).toMatch(/runCanaryStage\(["']optional-ai["'][\s\S]{0,220},\s*surface\s*\)/);
    expect(optionalWork).toMatch(/submitFeedbackAndAudit\([^)]*surface\)/);
    expect(optionalWork).toMatch(/runCanaryStage\(["']beta-cta["'][\s\S]{0,180},\s*surface\s*\)/);

    const stageRunnerStart = browser.indexOf("async function runCanaryStage");
    const stageRunnerEnd = browser.indexOf("\nfunction browserCanaryFailure", stageRunnerStart);
    const stageRunner = browser.slice(stageRunnerStart, stageRunnerEnd);
    expect(stageRunner).toMatch(
      /failure\.surface\s*===\s*["']unknown["'][\s\S]*failure\.surface\s*=\s*safeBrowserCanarySurfaces\.includes\(surface\)/
    );

    const accessibilityStart = browser.indexOf("async function auditAccessibility");
    const accessibilityEnd = browser.indexOf("async function assertNoMobileOverflow", accessibilityStart);
    const accessibility = browser.slice(accessibilityStart, accessibilityEnd);
    expect(accessibility).toMatch(/browserCanaryFailure\(["']accessibility["'],\s*\{\s*violations\s*\}\)/);
    expect(accessibility).toMatch(/targets:\s*nodes\.flatMap/);
  });

  it("feedback diagnostics report failed submit status before waiting for confirmation", () => {
    const start = browser.indexOf("async function submitFeedbackAndAudit");
    const end = browser.indexOf("async function exerciseBetaCta", start);
    const feedback = browser.slice(start, end);
    const responseWait = feedback.indexOf("waitForResponse(");
    const actionStart = feedback.indexOf('runCanaryStage("feedback-submit-action"');
    const responseStart = feedback.indexOf('runCanaryStage("feedback-submit-response"');
    const confirmationStart = feedback.indexOf('runCanaryStage("feedback-confirmation"');
    const accessibilityStart = feedback.indexOf('runCanaryStage("accessibility"');

    expect(feedback).toMatch(/runCanaryStage\(["']feedback-open["'][\s\S]{0,240},\s*surface\s*\)/);
    expect(responseWait).toBeGreaterThan(-1);
    expect(responseWait).toBeLessThan(actionStart);
    expect(feedback.slice(responseWait, actionStart)).toContain("/api/demo/feedback");
    expect(feedback.slice(responseWait, actionStart)).toMatch(
      /request\(\)\.method\(\)\s*===\s*["']POST["']/
    );
    expect(actionStart).toBeGreaterThan(responseWait);
    expect(responseStart).toBeGreaterThan(actionStart);
    expect(confirmationStart).toBeGreaterThan(responseStart);
    expect(accessibilityStart).toBeGreaterThan(confirmationStart);
    expect(feedback.slice(actionStart, responseStart)).toMatch(
      /activateByKeyboard\(page,\s*["']Send ratings["']\)[\s\S]*,\s*surface\s*\)/
    );
    expect(feedback.slice(responseStart, confirmationStart)).toMatch(
      /await\s+feedbackResponse[\s\S]*if\s*\([\s\S]{0,120}(?:\.ok\(\)|\.status\(\))[\s\S]{0,180}browserCanaryFailure\(["']feedback-submit-response["'][\s\S]{0,120}status[\s\S]*,\s*surface\s*\)/
    );
    expect(feedback.slice(confirmationStart, accessibilityStart)).toMatch(
      /Thanks—your ratings were saved without free-form text or contact details\.[\s\S]*Feedback saved[\s\S]*,\s*surface\s*\)/
    );
    expect(feedback).toMatch(/runCanaryStage\(["']accessibility["'][\s\S]{0,220},\s*surface\s*\)/);
  });

  it("feedback diagnostics assert the fixed feature value and checked beta interest", () => {
    const start = browser.indexOf("async function submitFeedbackAndAudit");
    const end = browser.indexOf("async function exerciseBetaCta", start);
    const feedback = browser.slice(start, end);
    const featureStart = feedback.indexOf('runCanaryStage("feedback-feature"');
    const betaStart = feedback.indexOf('runCanaryStage("feedback-beta-interest"');
    const submitStart = feedback.indexOf('runCanaryStage("feedback-submit-action"');
    expect(featureStart).toBeGreaterThan(-1);
    expect(betaStart).toBeGreaterThan(featureStart);
    expect(submitStart).toBeGreaterThan(betaStart);

    const feature = feedback.slice(featureStart, betaStart);
    expect(feature).toMatch(/focusByKeyboard\(page,\s*feature\)[\s\S]*keyboard\.press\(["']r["']\)/);
    expect(feature).not.toMatch(/keyboard\.press\(["'](?:ArrowDown|Enter)["']\)/);
    expect(feature).toMatch(/await\s+feature\.inputValue\(\)[\s\S]*["']research-cases["']/);
    expect(feature).toMatch(/,\s*surface\s*\)/);

    const betaInterest = feedback.slice(betaStart, submitStart);
    expect(betaInterest).toMatch(/activateLocatorByKeyboard\(page,\s*betaInterest,\s*["']Space["']\)/);
    expect(betaInterest.indexOf("activateLocatorByKeyboard")).toBeLessThan(
      betaInterest.indexOf("betaInterest.isChecked()")
    );
    expect(betaInterest).toMatch(/await\s+betaInterest\.isChecked\(\)/);
    expect(betaInterest).toMatch(/,\s*surface\s*\)/);
  });

  it("feedback field diagnostics preserve the exact failed keyboard control", () => {
    const stageStart = browser.indexOf("const safeBrowserCanaryStages");
    const stageEnd = browser.indexOf("]);", stageStart);
    const stageAllowlist = browser.slice(stageStart, stageEnd);
    const exactStages = [
      "feedback-usefulness",
      "feedback-clarity",
      "feedback-feature",
      "feedback-beta-interest"
    ];
    for (const stage of exactStages) {
      expect(stageAllowlist).toContain(`"${stage}"`);
      expect(browser.match(new RegExp(`"${stage}"`, "g"))?.length ?? 0).toBeGreaterThan(1);
    }
    expect(stageAllowlist).not.toContain('"feedback-fields"');

    const start = browser.indexOf("async function submitFeedbackAndAudit");
    const end = browser.indexOf("async function exerciseBetaCta", start);
    const feedback = browser.slice(start, end);
    expect(feedback).not.toContain('runCanaryStage("feedback-fields"');

    const expectedInteractions = new Map([
      ["feedback-usefulness", /selectLastRadioByKeyboard\(page,\s*usefulness\)/],
      ["feedback-clarity", /selectLastRadioByKeyboard\(page,\s*clarity\)/],
      ["feedback-feature", /focusByKeyboard\(page,\s*feature\)[\s\S]*keyboard\.press\(["']r["']\)/],
      ["feedback-beta-interest", /activateLocatorByKeyboard\(page,\s*betaInterest,\s*["']Space["']\)/]
    ]);
    for (const [stage, interaction] of expectedInteractions) {
      const wrapperStart = feedback.indexOf(`runCanaryStage("${stage}"`);
      const wrapperEnd = feedback.indexOf("runCanaryStage(", wrapperStart + 1);
      expect(wrapperStart).toBeGreaterThan(-1);
      expect(wrapperEnd).toBeGreaterThan(wrapperStart);
      const wrapper = feedback.slice(wrapperStart, wrapperEnd);
      expect(wrapper).toMatch(interaction);
      expect(wrapper).toMatch(/,\s*surface\s*\)\s*;?/);
    }
  });

  it("feedback rating diagnostics navigate each radio group from first to checked fifth", () => {
    const start = browser.indexOf("async function submitFeedbackAndAudit");
    const end = browser.indexOf("async function exerciseBetaCta", start);
    const feedback = browser.slice(start, end);
    expect(feedback).toMatch(
      /const\s+usefulness\s*=\s*page\.getByRole\(["']radiogroup["'],\s*\{\s*name:\s*["']Usefulness rating["']\s*\}\)\s*;/
    );
    expect(feedback).toMatch(
      /const\s+clarity\s*=\s*page\.getByRole\(["']radiogroup["'],\s*\{\s*name:\s*["']Clarity rating["']\s*\}\)\s*;/
    );
    expect(feedback).not.toMatch(
      /const\s+(?:usefulness|clarity)[\s\S]{0,180}getByRole\(["']radio["']\)\.last\(\)/
    );
    expect(feedback).toMatch(
      /runCanaryStage\(["']feedback-usefulness["'][\s\S]{0,180}selectLastRadioByKeyboard\(page,\s*usefulness\)[\s\S]{0,100},\s*surface\s*\)/
    );
    expect(feedback).toMatch(
      /runCanaryStage\(["']feedback-clarity["'][\s\S]{0,180}selectLastRadioByKeyboard\(page,\s*clarity\)[\s\S]{0,100},\s*surface\s*\)/
    );

    const helperStart = browser.indexOf("async function selectLastRadioByKeyboard");
    const helperEnd = browser.indexOf("\nasync function", helperStart + 1);
    expect(helperStart).toBeGreaterThan(-1);
    expect(helperEnd).toBeGreaterThan(helperStart);
    const helper = browser.slice(helperStart, helperEnd);
    expect(helper).toMatch(/group\.getByRole\(["']radio["']\)/);
    expect(helper).toMatch(/await\s+radios\.count\(\)[\s\S]*!==\s*5/);
    expect(helper).toMatch(/radios\.first\(\)/);
    expect(helper).toMatch(/radios\.last\(\)/);
    expect(helper.indexOf("focusByKeyboard(page, first")).toBeLessThan(
      helper.indexOf('keyboard.press("ArrowRight")')
    );
    expect(helper).toMatch(/for\s*\([^)]*<\s*(?:count|5)[^)]*\)[\s\S]*keyboard\.press\(["']ArrowRight["']\)/);
    expect(helper).toMatch(/last\.isChecked\(\)/);
    expect(helper).not.toMatch(/(?:focusByKeyboard|activateLocatorByKeyboard)\([^)]*\.last\(\)/);
  });

  it("mobile overflow diagnostics identify the exact 390px checkpoint with safe selectors", () => {
    const stageStart = browser.indexOf("const safeBrowserCanaryStages");
    const stageEnd = browser.indexOf("]);", stageStart);
    const stageAllowlist = browser.slice(stageStart, stageEnd);
    for (const stage of [
      "mobile-overflow-landing",
      "mobile-overflow-outcome",
      "mobile-overflow-completion"
    ]) {
      expect(stageAllowlist).toContain(`"${stage}"`);
      expect(browser.match(new RegExp(`"${stage}"`, "g"))?.length ?? 0).toBeGreaterThan(1);
      expect(browser).toMatch(
        new RegExp(`assertNoMobileOverflow\\(page,\\s*"${stage}",\\s*(?:"mobile"|surface)\\)`)
      );
    }

    const helperStart = browser.indexOf("async function assertNoMobileOverflow");
    const helperEnd = browser.indexOf("async function assertGuidedOutcome", helperStart);
    expect(helperStart).toBeGreaterThan(-1);
    expect(helperEnd).toBeGreaterThan(helperStart);
    const helper = browser.slice(helperStart, helperEnd);
    expect(helper).toMatch(/safeBrowserCanaryStages\.includes\(stage\)/);
    expect(helper).toMatch(/browserCanaryFailure\(["']unknown["']/);
    expect(helper).toMatch(/querySelectorAll/);
    expect(helper).toMatch(/getBoundingClientRect\(\)/);
    expect(helper).toMatch(
      /const\s+overflowAmount\s*=\s*Math\.max\([^)]*-bounds\.left[^)]*bounds\.right\s*-\s*viewportWidth[^)]*\)/
    );
    expect(helper).toMatch(/\{\s*element,\s*overflowAmount\s*\}/);
    expect(helper).toMatch(
      /\.sort\(\(left,\s*right\)\s*=>\s*right\.overflowAmount\s*-\s*left\.overflowAmount\)/
    );
    const ranked = helper.indexOf(".sort(");
    const truncated = helper.indexOf(".slice(", ranked);
    const selectors = helper.indexOf(".map(", truncated);
    expect(ranked).toBeGreaterThan(-1);
    expect(truncated).toBeGreaterThan(ranked);
    expect(selectors).toBeGreaterThan(truncated);
    expect(helper).toMatch(/targets[\s\S]*filter\(isSafeSyntheticCssTarget\)/);
    expect(helper).toMatch(/id:\s*["']horizontal-overflow["']/);
    expect(helper).toMatch(/count/);
    expect(helper).toMatch(/browserCanaryFailure\(stage,\s*\{[\s\S]*surface[\s\S]*violations/);
    expect(helper).not.toMatch(
      /innerHTML|outerHTML|innerText|textContent|getComputedStyle|cssText|\.style\b/i
    );
  });

  it("optional AI diagnostics stage action, HTTP response, and allowed result separately", () => {
    const stageStart = browser.indexOf("const safeBrowserCanaryStages");
    const stageEnd = browser.indexOf("]);", stageStart);
    const stageAllowlist = browser.slice(stageStart, stageEnd);
    for (const stage of ["optional-ai-action", "optional-ai-response", "optional-ai-result"]) {
      expect(stageAllowlist).toContain(`"${stage}"`);
      expect(browser.match(new RegExp(`"${stage}"`, "g"))?.length ?? 0).toBeGreaterThan(1);
    }

    const start = browser.indexOf("async function runOptionalAiAndAudit");
    const end = browser.indexOf("async function submitFeedbackAndAudit", start);
    const optionalAi = browser.slice(start, end);
    const responseWait = optionalAi.indexOf("waitForResponse(");
    const actionStart = optionalAi.indexOf('runCanaryStage("optional-ai-action"');
    const responseStart = optionalAi.indexOf('runCanaryStage("optional-ai-response"');
    const resultStart = optionalAi.indexOf('runCanaryStage("optional-ai-result"');
    const accessibilityStart = optionalAi.indexOf('runCanaryStage("accessibility"');
    expect(responseWait).toBeGreaterThan(-1);
    expect(responseWait).toBeLessThan(actionStart);
    expect(optionalAi.slice(responseWait, actionStart)).toContain("/api/demo/ai");
    expect(optionalAi.slice(responseWait, actionStart)).toMatch(
      /request\(\)\.method\(\)\s*===\s*["']POST["']/
    );
    expect(actionStart).toBeGreaterThan(responseWait);
    expect(responseStart).toBeGreaterThan(actionStart);
    expect(resultStart).toBeGreaterThan(responseStart);
    expect(accessibilityStart).toBeGreaterThan(resultStart);
    expect(optionalAi.slice(actionStart, responseStart)).toMatch(
      /activateByKeyboard\(page,\s*["']Suggest the next three checks["']\)[\s\S]*,\s*surface\s*\)/
    );
    expect(optionalAi.slice(responseStart, resultStart)).toMatch(
      /await\s+aiResponse[\s\S]*\.ok\(\)[\s\S]*\.status\(\)\s*!==\s*200[\s\S]*browserCanaryFailure\(["']optional-ai-response["'][\s\S]*status[\s\S]*,\s*surface\s*\)/
    );
  });

  it("optional AI diagnostics allow only external or explained deterministic results", () => {
    const labelsStart = browser.indexOf("const safeOptionalAiResultLabels");
    const labelsEnd = browser.indexOf("]);", labelsStart);
    expect(labelsStart).toBeGreaterThan(-1);
    expect(labelsEnd).toBeGreaterThan(labelsStart);
    const labels = [...browser.slice(labelsStart, labelsEnd).matchAll(/"([^"]+)"/g)]
      .map((match) => match[1]);
    expect(labels).toEqual([
      "Curated external AI analysis",
      "Deterministic demo analysis"
    ]);

    const start = browser.indexOf("async function runOptionalAiAndAudit");
    const end = browser.indexOf("async function submitFeedbackAndAudit", start);
    const optionalAi = browser.slice(start, end);
    const resultStart = optionalAi.indexOf('runCanaryStage("optional-ai-result"');
    const accessibilityStart = optionalAi.indexOf('runCanaryStage("accessibility"');
    const result = optionalAi.slice(resultStart, accessibilityStart);
    expect(result).toMatch(/Curated AI result/);
    expect(result).toMatch(/safeOptionalAiResultLabels\.includes\(/);
    expect(result).toContain("External AI was unavailable; a deterministic demo analysis is shown instead.");
    expect(result).toMatch(/Deterministic demo analysis[\s\S]*getByText|if[\s\S]*Deterministic demo analysis/);
    expect(result).toMatch(/,\s*surface\s*\)/);
    expect(optionalAi.slice(accessibilityStart)).toMatch(
      /runCanaryStage\(["']accessibility["'][\s\S]*auditAccessibility\([^)]*\)[\s\S]*,\s*surface\s*\)/
    );
    expect(optionalAi).not.toMatch(/\.json\(\)|\.text\(\)|\bprovider\b|console\.|error\.(?:message|stack)/i);

    const formatterStart = browser.indexOf("function safeBrowserCanaryFailure");
    const formatterEnd = browser.indexOf("\nif (import.meta.url", formatterStart);
    const formatter = browser.slice(formatterStart, formatterEnd);
    expect(formatter).not.toMatch(
      /error\.(?:message|stack)|\bprovider\b|\bresponseBody\b|\bresponse\s+body\b|JSON\.stringify\(\s*error/i
    );
  });

  it("cross-browser diagnostics split the capacity audit into fixed safe sub-stages", () => {
    const stageStart = browser.indexOf("const safeBrowserCanaryStages");
    const stageEnd = browser.indexOf("]);", stageStart);
    const stageAllowlist = browser.slice(stageStart, stageEnd);
    const stages = [
      "capacity-context",
      "capacity-landing",
      "capacity-action",
      "capacity-result",
      "capacity-links"
    ];
    for (const stage of stages) {
      expect(stageAllowlist).toContain(`"${stage}"`);
      expect(browser.match(new RegExp(`"${stage}"`, "g"))?.length ?? 0).toBeGreaterThan(1);
    }

    const start = browser.indexOf("async function auditCapacityFallback");
    const end = browser.indexOf("async function startGuidedDemo", start);
    const capacity = browser.slice(start, end);
    const positions = stages.map((stage) => capacity.indexOf(`runCanaryStage("${stage}"`));
    for (let index = 0; index < positions.length; index += 1) {
      expect(positions[index]).toBeGreaterThan(index === 0 ? -1 : positions[index - 1]);
    }
    expect(capacity.slice(positions[0], positions[1])).toMatch(/createContext\(/);
    expect(capacity.slice(positions[1], positions[2])).toMatch(/page\.goto\(["']\/["']/);
    expect(capacity.slice(positions[2], positions[3])).toMatch(/activateByKeyboard\(page,\s*["']Start guided demo["']\)/);
    expect(capacity.slice(positions[3], positions[4])).toMatch(/getByRole\(["']alert["']\)/);
    expect(capacity.slice(positions[4])).toMatch(/Other fictional demo options[\s\S]*\/family[\s\S]*\/challenge/);
    expect(capacity).toMatch(/runCanaryStage\(["']accessibility["'][\s\S]*auditAccessibility/);
    expect(capacity).toMatch(/assertNoMobileOverflow\(page,\s*["']mobile-overflow-/);
  });

  it("cross-browser diagnostics split reset and stale checks with numeric status only", () => {
    const stageStart = browser.indexOf("const safeBrowserCanaryStages");
    const stageEnd = browser.indexOf("]);", stageStart);
    const stageAllowlist = browser.slice(stageStart, stageEnd);
    const stages = [
      "reset-open",
      "reset-action",
      "reset-response",
      "reset-cookie",
      "stale-context",
      "stale-response"
    ];
    for (const stage of stages) {
      expect(stageAllowlist).toContain(`"${stage}"`);
      expect(browser.match(new RegExp(`"${stage}"`, "g"))?.length ?? 0).toBeGreaterThan(1);
    }

    const start = browser.indexOf("const desktopPage = pages[0].page");
    const end = browser.indexOf("} finally {", start);
    const lifecycle = browser.slice(start, end);
    const positions = stages.map((stage) => lifecycle.indexOf(`runCanaryStage("${stage}"`));
    for (let index = 0; index < positions.length; index += 1) {
      expect(positions[index]).toBeGreaterThan(index === 0 ? -1 : positions[index - 1]);
    }
    expect(lifecycle.slice(positions[0], positions[1])).toMatch(/Reset demo[\s\S]*Confirm demo reset/);
    expect(lifecycle.slice(positions[1], positions[2])).toMatch(/Yes, reset/);
    expect(lifecycle.slice(positions[2], positions[3])).toMatch(
      /status\(\)\s*!==\s*200[\s\S]*browserCanaryFailure\(["']reset-response["'],\s*\{\s*status:/
    );
    expect(lifecycle.slice(positions[3], positions[4])).toMatch(/requireSessionCookie[\s\S]*rotatedCookie/);
    expect(lifecycle.slice(positions[4], positions[5])).toMatch(/newContext[\s\S]*addCookies/);
    expect(lifecycle.slice(positions[5])).toMatch(
      /status\(\)\s*!==\s*401[\s\S]*status\(\)\s*!==\s*403[\s\S]*browserCanaryFailure\(["']stale-response["'],\s*\{\s*status:/
    );
    for (const stage of stages) {
      const stagePosition = lifecycle.indexOf(`runCanaryStage("${stage}"`);
      const block = lifecycle.slice(stagePosition, stagePosition + 1_200);
      expect(block).toMatch(/,\s*["']desktop["']\s*\)/);
    }
    expect(lifecycle).toMatch(
      /runCanaryStage\(["']session-state["'][\s\S]*assertGuidedOutcome\(mobileContext[\s\S]*,\s*["']mobile["']\s*\)/
    );
  });

  it("cross-browser diagnostics preserve specialized inner failures without raw output", () => {
    const runnerStart = browser.indexOf("async function runCanaryStage");
    const runnerEnd = browser.indexOf("\nfunction browserCanaryFailure", runnerStart);
    const runner = browser.slice(runnerStart, runnerEnd);
    expect(runner).toMatch(
      /const\s+failure\s*=\s*isBrowserCanaryFailure\(error\)\s*\?\s*error\s*:\s*browserCanaryFailure\(stage\)/
    );
    expect(runner).not.toMatch(/failure\.stage\s*=/);

    const formatterStart = browser.indexOf("function safeBrowserCanaryFailure");
    const formatterEnd = browser.indexOf("\nif (import.meta.url", formatterStart);
    const formatter = browser.slice(formatterStart, formatterEnd);
    expect(formatter).not.toMatch(
      /error\.(?:message|stack)|JSON\.stringify\(\s*error|\.\.\.error|\b(?:response)?bod(?:y|ies)\b|\bheaders?\b|\bcookies?\b|\bsecrets?\b|\bprovider\b/i
    );
    const cli = browser.slice(formatterEnd);
    expect(cli).not.toMatch(/console\.error\(\s*error(?:\.(?:message|stack))?\s*\)/);
  });

  it("keyboard reset diagnostics split target readiness focus and final activation", () => {
    const stageStart = browser.indexOf("const safeBrowserCanaryStages");
    const stageEnd = browser.indexOf("]);", stageStart);
    const stageAllowlist = browser.slice(stageStart, stageEnd);
    const stages = ["keyboard-target", "keyboard-ready", "keyboard-focus", "keyboard-activate"];
    for (const stage of stages) {
      expect(stageAllowlist).toContain(`"${stage}"`);
      expect(browser.match(new RegExp(`"${stage}"`, "g"))?.length ?? 0).toBeGreaterThan(1);
    }

    const focusStart = browser.indexOf("async function focusByKeyboard");
    const focusEnd = browser.indexOf("async function auditAccessibility", focusStart);
    const focus = browser.slice(focusStart, focusEnd);
    const targetStart = focus.indexOf('runCanaryStage("keyboard-target"');
    const readyStart = focus.indexOf('runCanaryStage("keyboard-ready"');
    const keyboardFocusStart = focus.indexOf('runCanaryStage("keyboard-focus"');
    expect(targetStart).toBeGreaterThan(-1);
    expect(readyStart).toBeGreaterThan(targetStart);
    expect(keyboardFocusStart).toBeGreaterThan(readyStart);
    expect(focus.slice(targetStart, readyStart)).toMatch(/target\.waitFor\(\)[\s\S]*,\s*["']unknown["']\s*\)/);
    expect(focus.slice(readyStart, keyboardFocusStart)).toMatch(
      /enabledDeadline[\s\S]*while\s*\([\s\S]*target\.isEnabled\(\)[\s\S]*setTimeout[\s\S]*,\s*["']unknown["']\s*\)/
    );
    expect(focus.slice(keyboardFocusStart)).toMatch(
      /for\s*\(\s*const\s+key\s+of\s+keyboardTraversalKeys\s*\)\s*\{\s*for\s*\([^)]*240[^)]*\)\s*\{[\s\S]*target\.evaluate\([\s\S]*page\.keyboard\.press\(key\)[\s\S]*,\s*["']unknown["']\s*\)/
    );

    const activationStart = browser.indexOf("async function activateLocatorByKeyboard");
    const activationEnd = browser.indexOf("async function selectLastRadioByKeyboard", activationStart);
    const activation = browser.slice(activationStart, activationEnd);
    expect(activation.indexOf("focusByKeyboard(page, target)")).toBeLessThan(
      activation.indexOf('runCanaryStage("keyboard-activate"')
    );
    expect(activation).toMatch(
      /runCanaryStage\(["']keyboard-activate["'][\s\S]*page\.keyboard\.press\(key\)[\s\S]*,\s*["']unknown["']\s*\)/
    );
  });

  it("keyboard reset diagnostics isolate the initial cookie and confirmation checks", () => {
    const stageStart = browser.indexOf("const safeBrowserCanaryStages");
    const stageEnd = browser.indexOf("]);", stageStart);
    const stageAllowlist = browser.slice(stageStart, stageEnd);
    for (const stage of ["reset-cookie-initial", "reset-confirmation"]) {
      expect(stageAllowlist).toContain(`"${stage}"`);
      expect(browser.match(new RegExp(`"${stage}"`, "g"))?.length ?? 0).toBeGreaterThan(1);
    }

    const start = browser.indexOf("const desktopPage = pages[0].page");
    const end = browser.indexOf("} finally {", start);
    const lifecycle = browser.slice(start, end);
    const initialCookie = lifecycle.indexOf('runCanaryStage("reset-cookie-initial"');
    const resetOpen = lifecycle.indexOf('runCanaryStage("reset-open"');
    const resetAction = lifecycle.indexOf('runCanaryStage("reset-action"');
    expect(initialCookie).toBeGreaterThan(-1);
    expect(resetOpen).toBeGreaterThan(initialCookie);
    expect(resetAction).toBeGreaterThan(resetOpen);
    expect(lifecycle.slice(initialCookie, resetOpen)).toMatch(
      /requireSessionCookie\(desktopContext,\s*configuration\.origin\)[\s\S]*,\s*["']desktop["']\s*\)/
    );

    const open = lifecycle.slice(resetOpen, resetAction);
    const activation = open.indexOf('activateByKeyboard(desktopPage, "Reset demo")');
    const confirmation = open.indexOf('runCanaryStage("reset-confirmation"');
    const accessibility = open.indexOf('runCanaryStage("accessibility"');
    expect(activation).toBeGreaterThan(-1);
    expect(confirmation).toBeGreaterThan(activation);
    expect(accessibility).toBeGreaterThan(confirmation);
    expect(open.slice(confirmation, accessibility)).toMatch(
      /Confirm demo reset[\s\S]*\.waitFor\(\)[\s\S]*,\s*["']desktop["']\s*\)/
    );
    expect(open.slice(accessibility)).toMatch(
      /auditAccessibility\(desktopPage[\s\S]*,\s*["']desktop["']\s*\)/
    );
  });

  it("defines the exact cross-engine keyboard traversal fallback order", () => {
    const keysStart = browser.indexOf("const keyboardTraversalKeys");
    const keysEnd = browser.indexOf("]);", keysStart);
    expect(keysStart).toBeGreaterThan(-1);
    expect(keysEnd).toBeGreaterThan(keysStart);
    const traversalKeys = browser.slice(keysStart, keysEnd + 3);

    expect(traversalKeys).toMatch(/Object\.freeze\(\s*\[/);
    expect(Array.from(
      traversalKeys.matchAll(/["']((?:Alt\+)?(?:Shift\+)?Tab)["']/g),
      (match) => match[1]
    )).toEqual(["Tab", "Shift+Tab", "Alt+Tab", "Alt+Shift+Tab"]);
    expect(traversalKeys).toMatch(
      /["']Tab["']\s*,\s*["']Shift\+Tab["']\s*,[\s\S]*process\.platform\s*===\s*["']darwin["'][\s\S]*\?\s*\[\s*["']Alt\+Tab["']\s*,\s*["']Alt\+Shift\+Tab["']\s*\]\s*:\s*\[\s*\]/
    );
  });

  it("uses only genuine key traversal and verifies focus after exhausting every fallback", () => {
    const focusStart = browser.indexOf("async function focusByKeyboard");
    const focusEnd = browser.indexOf("async function auditAccessibility", focusStart);
    expect(focusStart).toBeGreaterThan(-1);
    expect(focusEnd).toBeGreaterThan(focusStart);
    const focus = browser.slice(focusStart, focusEnd);
    const traversalStart = focus.indexOf('runCanaryStage("keyboard-focus"');
    expect(traversalStart).toBeGreaterThan(-1);
    const traversal = focus.slice(traversalStart);

    expect(traversal).toMatch(
      /for\s*\(\s*const\s+key\s+of\s+keyboardTraversalKeys\s*\)\s*\{\s*for\s*\(\s*let\s+index\s*=\s*0\s*;\s*index\s*<\s*240\s*;\s*index\s*\+=\s*1\s*\)\s*\{\s*if\s*\(\s*await\s+target\.evaluate\(\s*\(?element\)?\s*=>\s*element\s*===\s*document\.activeElement\s*\)\s*\)\s*return\s*;\s*await\s+page\.keyboard\.press\(key\)\s*;\s*\}\s*\}\s*if\s*\(\s*await\s+target\.evaluate\(\s*\(?element\)?\s*=>\s*element\s*===\s*document\.activeElement\s*\)\s*\)\s*return\s*;\s*throw\s+browserCanaryFailure\(["']keyboard-focus["']\)/
    );
    expect(traversal.match(/target\.evaluate\(/g)).toHaveLength(2);
    expect(traversal.match(/page\.keyboard\.press\(key\)/g)).toHaveLength(1);
    expect(traversal).toMatch(/,\s*["']unknown["']\s*\)\s*;/);
    expect(focus).not.toMatch(/\.focus\s*\(|\.click\s*\(|tabindex|tabIndex\s*=|setAttribute\(\s*["']tabindex["']/i);
  });

  it("allowlists every fixed keyboard control with an immutable exact name-to-slug mapping", () => {
    const allowlistStart = browser.indexOf("const safeBrowserCanaryControls");
    const allowlistEnd = browser.indexOf("\n});", allowlistStart);
    expect(allowlistStart).toBeGreaterThan(-1);
    expect(allowlistEnd).toBeGreaterThan(allowlistStart);
    const controlAllowlist = browser.slice(allowlistStart, allowlistEnd + 4);

    expect(controlAllowlist).toMatch(/Object\.freeze\(\s*\{/);
    const entries = Array.from(
      controlAllowlist.matchAll(/^\s*["']([^"']+)["']:\s*["']([^"']+)["'],?\s*$/gm),
      (match) => [match[1], match[2]]
    );
    expect(Object.fromEntries(entries)).toEqual(expectedSafeKeyboardControls);
    expect(browser).toMatch(
      /const\s+safeBrowserCanaryControlSlugs\s*=\s*Object\.freeze\(\s*Object\.values\(safeBrowserCanaryControls\)\s*\)/
    );

    const directNames = Array.from(
      browser.matchAll(/activateByKeyboard\(\s*[^,\n]+,\s*["']([^"']+)["']\s*\)/g),
      (match) => match[1]
    );
    const outcomeNames = Array.from(
      browser.matchAll(/outcomeLabel:\s*["']([^"']+)["']/g),
      (match) => match[1]
    );
    expect([...new Set([...directNames, ...outcomeNames])].sort()).toEqual(
      Object.keys(expectedSafeKeyboardControls).sort()
    );
  });

  it("adds only a mapped control slug while preserving specialized keyboard failures", () => {
    const activationStart = browser.indexOf("async function activateByKeyboard");
    const activationEnd = browser.indexOf("async function activateLocatorByKeyboard", activationStart);
    expect(activationStart).toBeGreaterThan(-1);
    expect(activationEnd).toBeGreaterThan(activationStart);
    const activation = browser.slice(activationStart, activationEnd);

    expect(activation).toMatch(
      /const\s+control\s*=\s*Object\.hasOwn\(safeBrowserCanaryControls,\s*accessibleName\)[\s\S]*\?\s*safeBrowserCanaryControls\[accessibleName\][\s\S]*:\s*["']unknown["']/
    );
    expect(activation).toMatch(
      /try\s*\{[\s\S]*await\s+activateLocatorByKeyboard\(page,\s*target,\s*["']Enter["']\)[\s\S]*\}\s*catch\s*\(error\)/
    );
    expect(activation).toMatch(
      /const\s+failure\s*=\s*isBrowserCanaryFailure\(error\)\s*\?\s*error\s*:\s*browserCanaryFailure\(["']keyboard-activate["']\)/
    );
    expect(activation).toMatch(/failure\.control\s*=\s*control[\s\S]*throw\s+failure/);
    expect(activation).not.toMatch(/failure\.(?:stage|surface|status|violations)\s*=/);
    expect(activation).not.toMatch(
      /failure\.(?:control|accessibleName)\s*=\s*accessibleName|accessibleName\.(?:toLowerCase|replace|normalize)\s*\(/
    );
  });

  it("formats only allowlisted control slugs and makes arbitrary control values unknown", () => {
    const factoryStart = browser.indexOf("function browserCanaryFailure");
    const factoryEnd = browser.indexOf("\nfunction isBrowserCanaryFailure", factoryStart);
    expect(factoryStart).toBeGreaterThan(-1);
    expect(factoryEnd).toBeGreaterThan(factoryStart);
    const factory = browser.slice(factoryStart, factoryEnd);
    expect(factory).toMatch(
      /failure\.control\s*=\s*safeBrowserCanaryControlSlugs\.includes\(detail\.control\)[\s\S]*\?\s*detail\.control[\s\S]*:\s*["']unknown["']/
    );

    const formatterStart = browser.indexOf("function safeBrowserCanaryFailure");
    const formatterEnd = browser.indexOf("\nif (import.meta.url", formatterStart);
    expect(formatterStart).toBeGreaterThan(-1);
    expect(formatterEnd).toBeGreaterThan(formatterStart);
    const formatter = browser.slice(formatterStart, formatterEnd);
    expect(formatter).toMatch(
      /const\s+control\s*=\s*typeof\s+error\?\.control\s*===\s*["']string["'][\s\S]*safeBrowserCanaryControlSlugs\.includes\(error\.control\)[\s\S]*\?\s*error\.control[\s\S]*:\s*["']unknown["']/
    );
    expect(formatter).toMatch(/control=\$\{control\}/);
    expect(formatter).not.toMatch(/\$\{\s*error\?*\.control\s*\}|accessibleName/);
    expect(formatter).not.toMatch(
      /error\.(?:message|stack)|JSON\.stringify\(\s*error|\.\.\.error|\b(?:response)?bod(?:y|ies)\b|\bheaders?\b|\bcookies?\b|\bsecrets?\b|\bprovider\b/i
    );
  });

  it("covers Chromium and WebKit desktop/mobile plus the Firefox core path", () => {
    expect(browser).toMatch(/import\s*\{[^}]*chromium[^}]*firefox[^}]*webkit[^}]*\}\s*from\s*["']playwright["']/s);
    expect(browser).toContain("KINRESOLVE_DEMO_BROWSER");
    expect(browser).toContain("chromium");
    expect(browser).toContain("webkit");
    expect(browser).toContain("firefox");
    expect(browser).toMatch(/browserName\s*!==\s*["']firefox["']/);
  });

  it("audits capacity fallback and completes feedback and beta CTA actions", () => {
    expect(browser).toContain("The public demo is at capacity");
    expect(browser).toContain("/family");
    expect(browser).toContain("/challenge");
    expect(browser).toContain("Send ratings");
    expect(browser).toContain("Feedback saved");
    expect(browser).toContain("Apply for the private beta");
    expect(browser).toContain("beta_cta_clicked");
  });

  it("scopes duplicate capacity fallback links to the fixed fallback navigation", () => {
    const start = browser.indexOf("async function auditCapacityFallback");
    const end = browser.indexOf("async function startGuidedDemo", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const capacityAudit = browser.slice(start, end);
    expect(capacityAudit).toContain(
      'getByRole("navigation", { name: "Other fictional demo options" })'
    );
    expect(capacityAudit).not.toMatch(
      /page\.getByRole\("link",\s*\{\s*name:\s*"Explore the fictional family"/
    );
    expect(capacityAudit).not.toMatch(
      /page\.getByRole\("link",\s*\{\s*name:\s*"Try the research challenge"/
    );
  });

  it("waits for a hydrated control to become enabled before keyboard activation", () => {
    const start = browser.indexOf("async function focusByKeyboard");
    const end = browser.indexOf("async function auditAccessibility", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const keyboardFocus = browser.slice(start, end);
    expect(keyboardFocus).toContain("target.isEnabled()");
    expect(keyboardFocus).toMatch(
      /Date\.now\(\)\s*\+\s*timeoutMs[\s\S]*while\s*\([\s\S]*target\.isEnabled\(\)[\s\S]*enabledDeadline[\s\S]*setTimeout/
    );
    expect(keyboardFocus.indexOf("target.isEnabled()")).toBeLessThan(
      keyboardFocus.indexOf("page.keyboard.press(key)")
    );
  });

  it("activates a role-based button before using an exact-text keyboard fallback", () => {
    const start = browser.indexOf("async function activateByKeyboard");
    const end = browser.indexOf("async function activateLocatorByKeyboard", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const activation = browser.slice(start, end);

    expect(activation).toMatch(
      /const\s+button\s*=\s*page\.getByRole\(["']button["'],\s*\{\s*name:\s*accessibleName\s*\}\)/
    );
    expect(activation).toMatch(/const\s+buttonCount\s*=\s*await\s+button\.count\(\)/);
    expect(activation).toMatch(
      /buttonCount\s*>\s*0\s*\?\s*button\.first\(\)\s*:\s*page\.getByText\(accessibleName,\s*\{\s*exact:\s*true\s*\}\)\.first\(\)/
    );
    expect(activation).not.toMatch(/\.or\s*\(/);
    expect(activation).toMatch(
      /activateLocatorByKeyboard\(page,\s*target,\s*["']Enter["']\)/
    );
    expect(activation.indexOf("button.count()")).toBeLessThan(
      activation.indexOf("page.getByText")
    );
  });

  it("rewrites protected candidate mutations to the canonical same-origin contract", () => {
    expect(browser).toContain("x-vercel-protection-bypass");
    expect(browser).toContain("x-kinresolve-demo-canary");
    expect(browser).toContain('origin: "https://demo.kinresolve.com"');
    expect(browser).toContain('"sec-fetch-site": "same-origin"');
    expect(browser).toMatch(/route\([\s\S]*request\(\)[\s\S]*route\.continue/);
  });

  it("fetches and fulfills generated-candidate mutations before the normal continue path", () => {
    const start = browser.indexOf("async function installProtectedCandidateRoute");
    const end = browser.indexOf("function requestHeaders", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);

    const protectedRoute = browser.slice(start, end);
    const fetch = protectedRoute.indexOf("route.fetch(");
    const fulfill = protectedRoute.indexOf("route.fulfill(", fetch);
    const normalContinue = protectedRoute.lastIndexOf("route.continue(");
    expect(protectedRoute.slice(0, fetch)).toMatch(/generatedCandidate[\s\S]*mutation|mutation[\s\S]*generatedCandidate/);
    expect(fetch).toBeGreaterThan(-1);
    expect(fulfill).toBeGreaterThan(fetch);
    expect(normalContinue).toBeGreaterThan(fulfill);
    expect(protectedRoute.slice(fetch, fulfill)).toMatch(/headers/);
    expect(protectedRoute.slice(fetch, fulfill)).toMatch(/maxRedirects:\s*0/);
    expect(protectedRoute.slice(fetch, fulfill)).toMatch(/timeout:\s*timeoutMs/);
    expect(protectedRoute.slice(fulfill, normalContinue)).toMatch(/response/);
  });

  it("starts 25 sessions concurrently, proves core reads, enforces p95, and always cleans up", () => {
    expect(load).toContain("/api/demo/sessions");
    expect(load).toContain("/api/demo/session");
    expect(load).toContain("/app/cases/case-mercer-march-identity?guide=1");
    expect(load).toContain("/api/demo/session/end");
    expect(load).toContain("maximumActiveSessions");
    expect(load).toContain('familyUrl');
    expect(load).toContain('challengeUrl');
    expect(load).toContain('retry-after');
    expect(load).toContain("KINRESOLVE_DEMO_CANARY_SECRET");
    expect(load).toContain("Promise.allSettled");
    expect(load).toContain("finally");
    expect(load).toMatch(/(?:simultaneousStarts|sessionCount)\s*=\s*25/);
    expect(load).toMatch(/(?:p95LimitMs|maxP95Ms)\s*=\s*5_?000/);
    expect(load).toMatch(/new Set\([\s\S]*cookie/);
    expect(load).not.toMatch(/x-forwarded-for|x-vercel-forwarded-for/i);
  });

  it("lets only an authenticated canary skip network buckets while preserving capacity admission", () => {
    const decision = sessionStore.indexOf("decidePublicDemoAdmission");
    const rateLimit = sessionStore.indexOf("consumePublicDemoNetworkRateLimit", decision);
    expect(decision).toBeGreaterThan(-1);
    expect(rateLimit).toBeGreaterThan(decision);
    const admission = sessionStore.slice(decision, rateLimit + 200);
    expect(admission).toMatch(/input\.isCanary\s*===\s*true/);
    expect(admission).toContain("consumePublicDemoNetworkRateLimit");
  });

  it("installs and runs browser and load gates before promotion and in full monitoring", () => {
    const install = release.indexOf("npx playwright install --with-deps chromium webkit firefox");
    const browserRun = release.indexOf("scripts/public-demo-browser-canary.mjs");
    const loadRun = release.indexOf("scripts/public-demo-load-test.mjs");
    const promote = release.indexOf('vercel promote "$CANDIDATE_DEPLOYMENT_URL"');

    expect(install).toBeGreaterThan(-1);
    expect(browserRun).toBeGreaterThan(install);
    expect(release).toContain("KINRESOLVE_DEMO_BROWSER");
    expect(release).toMatch(/for browser in chromium webkit firefox/);
    expect(loadRun).toBeGreaterThan(browserRun);
    expect(promote).toBeGreaterThan(loadRun);
    expect(monitoring).toContain("npm ci");
    expect(monitoring).toContain("npx playwright install --with-deps chromium");
    expect(monitoring).toContain("scripts/public-demo-browser-canary.mjs");
  });
});
