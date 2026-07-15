import { NextResponse } from "next/server";

import { getIntegrationErrorCode, logRedactedIntegrationError } from "./error-reporting";

export type JsonObject = Record<string, unknown>;

export async function readJsonObject(
  request: Request
): Promise<{ ok: true; value: JsonObject } | { ok: false; response: NextResponse }> {
  try {
    const value: unknown = await request.json();
    if (!isRecord(value)) throw new Error("not an object");
    return { ok: true, value };
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "Request body must be a JSON object" }, { status: 400 })
    };
  }
}

export function integrationErrorResponse(
  error: unknown,
  fallbackMessage: string,
  notFoundMessage = "Data source not found"
): NextResponse {
  const code = getIntegrationErrorCode(error);

  if (code === "NOT_FOUND") {
    return NextResponse.json({ error: notFoundMessage }, { status: 404 });
  }
  if (code === "ACTIVE_RUN") {
    return NextResponse.json(
      { error: "A refresh is already active for this data source" },
      { status: 409 }
    );
  }
  if (code === "STALE_BASELINE") {
    return NextResponse.json(
      { error: "The archive changed after this refresh was prepared; review the changes again" },
      { status: 409 }
    );
  }
  if (code && [
    "INVALID_STATE",
    "RUN_STATE",
    "RUN_CANCELLED",
    "IDEMPOTENCY_CONFLICT",
    "RESOLUTION_REQUIRED",
    "EXTERNAL_ID_CONFLICT",
    "ARTIFACT_INTEGRITY"
  ].includes(code)) {
    return NextResponse.json({ error: "The refresh is no longer in the required state" }, { status: 409 });
  }
  if (code === "UNSUPPORTED_MEDIA") {
    return NextResponse.json({ error: "The selected file type is not supported" }, { status: 415 });
  }
  if (code === "UPLOAD_NOT_READY") {
    return NextResponse.json({ error: "The private upload is not available yet" }, { status: 409 });
  }
  if (code === "UPLOAD_EXPIRED") {
    return NextResponse.json({ error: "The private upload authorization expired" }, { status: 410 });
  }
  if (code === "FEATURE_DISABLED") {
    return NextResponse.json({ error: "This data-source import is not enabled" }, { status: 404 });
  }
  if (code === "DESKTOP_MEDIA_DISABLED") {
    return NextResponse.json(
      { error: "Desktop media ZIP import is unavailable; upload a standalone GEDCOM export instead" },
      { status: 400 }
    );
  }
  if (code === "MEDIA_RIGHTS_REQUIRED") {
    return NextResponse.json(
      { error: "Accept the current desktop-media rights acknowledgement or upload a standalone GEDCOM export" },
      { status: 400 }
    );
  }
  if (code === "MEDIA_RIGHTS_NOT_APPLICABLE") {
    return NextResponse.json(
      { error: "Desktop-media rights acknowledgement applies only to Family Tree Maker or RootsMagic ZIP packages" },
      { status: 400 }
    );
  }
  if (code === "MEDIA_RIGHTS_MISMATCH") {
    return NextResponse.json(
      { error: "The rights acknowledgement does not match the staged package; stage it again" },
      { status: 400 }
    );
  }
  if (code === "MALWARE_DETECTED") {
    return NextResponse.json({ error: "The package did not pass its security scan" }, { status: 422 });
  }
  if (code === "MALWARE_SCANNER_UNAVAILABLE" || code === "STORAGE_UNAVAILABLE") {
    logRedactedIntegrationError("integration_api_error", error);
    return NextResponse.json({ error: "Private import processing is temporarily unavailable" }, { status: 503 });
  }
  if (
    code === "VALIDATION_ERROR"
    || code === "INVALID_INPUT"
    || code === "INVALID_CURSOR"
    || code === "ARTIFACT_REQUIRED"
  ) {
    return NextResponse.json({ error: "The request is invalid" }, { status: 400 });
  }

  logRedactedIntegrationError("integration_api_error", error);
  return NextResponse.json({ error: fallbackMessage }, { status: 500 });
}

export function nonEmptyString(value: unknown, maximumLength = 240): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maximumLength ? normalized : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
