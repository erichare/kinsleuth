import { describe, expect, it } from "vitest";

import { classifyRefreshChange } from "@/lib/integrations/refresh";

describe("three-way integration refresh classification", () => {
  it("accepts an entity added by the incoming source", () => {
    expect(
      classifyRefreshChange({
        baseHash: null,
        localHash: null,
        incomingHash: "incoming"
      })
    ).toEqual({ classification: "remote_only", proposedAction: "accept_incoming" });
  });

  it("accepts an incoming edit when the local entity still matches the baseline", () => {
    expect(
      classifyRefreshChange({
        baseHash: "baseline",
        localHash: "baseline",
        incomingHash: "incoming"
      })
    ).toEqual({ classification: "remote_only", proposedAction: "accept_incoming" });
  });

  it("preserves a local-only edit when the incoming entity still matches the baseline", () => {
    expect(
      classifyRefreshChange({
        baseHash: "baseline",
        localHash: "local",
        incomingHash: "baseline"
      })
    ).toEqual({ classification: "local_only", proposedAction: "keep_local" });
  });

  it("treats equal local and incoming edits as a no-op", () => {
    expect(
      classifyRefreshChange({
        baseHash: "baseline",
        localHash: "shared-edit",
        incomingHash: "shared-edit"
      })
    ).toEqual({ classification: "same", proposedAction: "no_op" });
  });

  it("requires review when local and incoming edits diverge from the baseline", () => {
    expect(
      classifyRefreshChange({
        baseHash: "baseline",
        localHash: "local-edit",
        incomingHash: "incoming-edit"
      })
    ).toEqual({ classification: "conflict", proposedAction: "review" });
  });

  it("never turns an incoming deletion into a local hard delete", () => {
    expect(
      classifyRefreshChange({
        baseHash: "baseline",
        localHash: "baseline",
        incomingHash: null
      })
    ).toEqual({ classification: "deletion", proposedAction: "keep_local" });
  });

  it("keeps the local entity even when it was edited before the incoming deletion", () => {
    expect(
      classifyRefreshChange({
        baseHash: "baseline",
        localHash: "local-edit",
        incomingHash: null
      })
    ).toEqual({ classification: "deletion", proposedAction: "keep_local" });
  });
});
