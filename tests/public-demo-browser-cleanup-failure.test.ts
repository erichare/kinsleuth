import { describe, expect, it } from "vitest";

type SettledCleanup = PromiseSettledResult<void>;

type BrowserCanaryFailure = Error & {
  control?: unknown;
  stage?: unknown;
  status?: unknown;
  surface?: unknown;
  violations?: unknown;
};

type FailureSelection =
  | { hasFailure: false }
  | { failure: unknown; hasFailure: true };

async function loadFailureSelector(): Promise<(
  hasPrimaryFailure: boolean,
  primaryFailure: unknown,
  cleanup: SettledCleanup[]
) => FailureSelection> {
  const browserCanaryUrl: string = new URL(
    "../scripts/public-demo-browser-canary.mjs",
    import.meta.url
  ).href;
  const browserCanary = await import(browserCanaryUrl) as {
    selectBrowserCanaryFailure?: (
      hasPrimaryFailure: boolean,
      primaryFailure: unknown,
      cleanup: SettledCleanup[]
    ) => FailureSelection;
  };

  expect(browserCanary.selectBrowserCanaryFailure).toBeTypeOf("function");
  if (typeof browserCanary.selectBrowserCanaryFailure !== "function") {
    throw new Error("The browser canary failure selector is unavailable.");
  }
  return browserCanary.selectBrowserCanaryFailure;
}

describe("public demo browser cleanup failure precedence", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["false", false],
    ["zero", 0],
    ["empty string", ""]
  ] as const)("preserves a thrown %s when cleanup also rejects", async (_label, primaryFailure) => {
    const selectBrowserCanaryFailure = await loadFailureSelector();
    const cleanupReason = new Error("sensitive cleanup implementation detail");

    const selected = selectBrowserCanaryFailure(true, primaryFailure, [{
      reason: cleanupReason,
      status: "rejected"
    }]);

    expect(selected.hasFailure).toBe(true);
    if (!selected.hasFailure) return;
    expect(selected.failure).toBe(primaryFailure);
  });

  it("returns a fixed cleanup-stage failure when cleanup is the only failure", async () => {
    const selectBrowserCanaryFailure = await loadFailureSelector();
    const cleanupReason = new Error("sensitive cleanup implementation detail");

    const selected = selectBrowserCanaryFailure(false, undefined, [{
      reason: cleanupReason,
      status: "rejected"
    }]);

    expect(selected.hasFailure).toBe(true);
    if (!selected.hasFailure) return;
    const failure = selected.failure as BrowserCanaryFailure;

    expect(failure).toBeInstanceOf(Error);
    expect(failure).toMatchObject({
      control: "unknown",
      stage: "cleanup",
      status: null,
      surface: "unknown",
      violations: []
    });
    expect(failure.message).toBe("The public demo browser canary stage failed.");
    expect(failure).not.toHaveProperty("reason");
    expect(failure).not.toHaveProperty("cause");
    expect(JSON.stringify(failure)).not.toContain(cleanupReason.message);
  });
});
