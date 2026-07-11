import { describe, expect, it } from "vitest";
import { createSessionToken, safeInternalPath, verifySessionToken } from "@/lib/session";

describe("session tokens", () => {
  it("verifies a signed token", async () => {
    const token = await createSessionToken("test-secret", 1_000);

    await expect(verifySessionToken(token, "test-secret", 2_000)).resolves.toBe(true);
  });

  it("rejects tampered signatures", async () => {
    const token = await createSessionToken("test-secret", 1_000);

    await expect(verifySessionToken(`${token.slice(0, -2)}xx`, "test-secret", 2_000)).resolves.toBe(false);
  });

  it("rejects expired tokens", async () => {
    const token = await createSessionToken("test-secret", 1_000);

    await expect(verifySessionToken(token, "test-secret", 1_000 + 8 * 24 * 60 * 60 * 1000)).resolves.toBe(false);
  });
});

describe("safeInternalPath", () => {
  it("allows same-origin absolute paths", () => {
    expect(safeInternalPath("/app/cases?view=open")).toBe("/app/cases?view=open");
  });

  it("falls back for missing or non-path values", () => {
    expect(safeInternalPath(undefined)).toBe("/app");
    expect(safeInternalPath("app")).toBe("/app");
    expect(safeInternalPath("https://evil.example")).toBe("/app");
  });

  it("rejects protocol-relative escapes, including backslash variants", () => {
    expect(safeInternalPath("//evil.example")).toBe("/app");
    expect(safeInternalPath("/\\evil.example")).toBe("/app");
  });
});
