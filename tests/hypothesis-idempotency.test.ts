import { describe, expect, it } from "vitest";

import { hypothesisDecisionRequestFor } from "@/components/hypothesis-workspace";

const draft = {
  expectedUpdatedAt: "2026-07-13T18:00:00.000Z",
  status: "weakened" as const,
  reason: "The bounded search did not locate the expected record."
};

describe("hypothesis decision retry identity", () => {
  it("reuses a request id when an identical decision is retried after a lost response", () => {
    const first = hypothesisDecisionRequestFor(undefined, draft, () => "request-first");
    const retry = hypothesisDecisionRequestFor(first, draft, () => "request-should-not-be-used");

    expect(retry).toBe(first);
    expect(retry.requestId).toBe("request-first");
  });

  it("allocates a new request id after a material draft change or successful reset", () => {
    const first = hypothesisDecisionRequestFor(undefined, draft, () => "request-first");
    const changed = hypothesisDecisionRequestFor(
      first,
      { ...draft, reason: "A different decision reason." },
      () => "request-changed"
    );
    const afterSuccess = hypothesisDecisionRequestFor(undefined, draft, () => "request-after-success");

    expect(changed.requestId).toBe("request-changed");
    expect(afterSuccess.requestId).toBe("request-after-success");
  });
});
