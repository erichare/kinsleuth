import { afterEach, describe, expect, it, vi } from "vitest";

import { integrationErrorResponse } from "@/lib/integrations/api-response";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("integration API error reporting", () => {
  it("logs only a structured error event and sanitized code", async () => {
    const secret = "private-synthetic-tree-filename.ged";
    const error = Object.assign(new Error(secret), {
      code: "STORAGE_UNAVAILABLE",
      privateDetail: secret
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = integrationErrorResponse(error, "Unable to stage the private artifact");

    expect(response.status).toBe(503);
    expect(consoleError).toHaveBeenCalledExactlyOnceWith({
      event: "integration_api_error",
      code: "STORAGE_UNAVAILABLE"
    });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(secret);
  });

  it("does not treat an attacker-shaped error code as safe log metadata", () => {
    const secret = "PRIVATE_TREE_FILENAME\nSECOND_LINE";
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    integrationErrorResponse(
      Object.assign(new Error("private synthetic failure"), { code: secret }),
      "Unable to stage the private artifact"
    );

    expect(consoleError).toHaveBeenCalledExactlyOnceWith({
      event: "integration_api_error",
      code: "UNEXPECTED_ERROR"
    });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(secret);
  });

  it.each([
    ["INVALID_INPUT", 400],
    ["INVALID_CURSOR", 400],
    ["ARTIFACT_REQUIRED", 400],
    ["RUN_STATE", 409],
    ["RUN_CANCELLED", 409],
    ["RESOLUTION_REQUIRED", 409],
    ["EXTERNAL_ID_CONFLICT", 409],
    ["ARTIFACT_INTEGRITY", 409],
    ["UNSUPPORTED_MEDIA", 415],
    ["CAPABILITY_DISABLED", 404],
    ["PLAIN_GEDCOM_REQUIRED", 415],
    ["GEDCOM_FILE_INVALID", 400],
    ["GEDCOM_FILE_TOO_LARGE", 413],
    ["GEDCOM_PERSON_COUNT_INVALID", 400],
    ["GEDCOM_PERSON_LIMIT_EXCEEDED", 413],
    ["MALWARE_DETECTED", 422],
    ["MALWARE_SCANNER_UNAVAILABLE", 503]
  ])("maps the public integration code %s to HTTP %i", (code, status) => {
    const response = integrationErrorResponse(
      Object.assign(new Error("private detail"), { code }),
      "Unable to process the refresh"
    );

    expect(response.status).toBe(status);
  });
});
