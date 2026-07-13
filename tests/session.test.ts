import { describe, expect, it } from "vitest";

import { safeInternalPath } from "@/lib/session";

describe("safeInternalPath", () => {
  it("allows same-origin absolute paths", () => {
    expect(safeInternalPath("/app/cases?view=open")).toBe("/app/cases?view=open");
  });

  it("falls back for missing or external values", () => {
    expect(safeInternalPath(undefined)).toBe("/app");
    expect(safeInternalPath("app")).toBe("/app");
    expect(safeInternalPath("https://evil.example")).toBe("/app");
  });

  it("rejects protocol-relative escapes", () => {
    expect(safeInternalPath("//evil.example")).toBe("/app");
    expect(safeInternalPath("/\\evil.example")).toBe("/app");
  });
});
