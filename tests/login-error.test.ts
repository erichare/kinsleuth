import { describe, expect, it } from "vitest";

import { toPublicLoginError } from "@/lib/login-error";

describe("login error disclosure", () => {
  it("maps provider and transport details to one generic public message", () => {
    const providerDetail = "No credential account exists for private-user@example.test";

    expect(toPublicLoginError({ message: providerDetail })).toBe(
      "Sign-in failed. Check your email and password and try again."
    );
    expect(toPublicLoginError(new Error("database host db.internal.example refused the connection"))).toBe(
      "Sign-in failed. Check your email and password and try again."
    );
  });
});
