const errorCodePattern = /^[A-Z0-9_]{1,64}$/;

export type IntegrationErrorEvent = "integration_api_error" | "integration_worker_error";

export function getIntegrationErrorCode(error: unknown): string | undefined {
  if (!isRecord(error) || typeof error.code !== "string") return undefined;
  const code = error.code.trim();
  return errorCodePattern.test(code) ? code : undefined;
}

export function logRedactedIntegrationError(event: IntegrationErrorEvent, error: unknown): void {
  console.error({
    event,
    code: getIntegrationErrorCode(error) ?? "UNEXPECTED_ERROR"
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
