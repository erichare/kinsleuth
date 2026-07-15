import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

import { createApiRequestId } from "./api-response";
import { captureOperationalError } from "./observability";
import {
  acquireReleaseFence,
  assertReleaseFence,
  reacquireReleaseFence,
  releaseReleaseFence,
  ReleaseFenceError,
  validateReleaseFenceIdentity,
  type ReleaseFence,
  type ReleaseFenceIdentity,
  type ReleaseFenceTransitionResult
} from "./release-fence";

export type ReleaseFenceControlAction = "acquire" | "assert" | "reacquire" | "release";
type ReleaseFenceOperation = (identity: ReleaseFenceIdentity) => Promise<ReleaseFenceTransitionResult>;

const maximumControlBodyBytes = 512;

export function createReleaseFenceControlHandler(
  action: ReleaseFenceControlAction,
  operation: ReleaseFenceOperation = operationFor(action)
): (request: Request) => Promise<NextResponse> {
  return async (request) => {
    if (isHostedDeployment() && action !== "assert") {
      return controlError(405, "Release fence transitions are disabled in the hosted runtime");
    }
    const authenticationFailure = authenticateFenceControl(request);
    if (authenticationFailure) return authenticationFailure;

    const identity = await readFenceIdentity(request);
    if (!identity) return controlError(400, "The release fence request is invalid");

    try {
      const result = await operation(identity);
      const { fence } = result;
      return NextResponse.json(
        {
          fenceId: fence.fenceId,
          releaseCommitSha: fence.releaseCommitSha,
          active: fence.state === "active",
          released: fence.state === "released",
          activatedAt: fence.activatedAt,
          activationGeneration: fence.activationGeneration,
          transition: result.transition
        },
        {
          status: action === "acquire" && result.transition === "acquired" ? 201 : 200,
          headers: privateNoStoreHeaders()
        }
      );
    } catch (error) {
      if (error instanceof ReleaseFenceError) {
        if (error.code === "NOT_FOUND") return controlError(404, "Release fence not found");
        if (error.code === "CONFLICT") return controlError(409, "Release fence transition conflict");
        return controlError(400, "The release fence request is invalid");
      }
      await captureOperationalError({
        event: "api_error",
        route: `/api/release/fence/${action}`
      }, error);
      return controlError(503, "Release fence control is unavailable");
    }
  };
}

function isHostedDeployment(): boolean {
  return process.env.KINRESOLVE_DEPLOYMENT_MODE?.trim().toLowerCase() === "hosted";
}

export function releaseFenceLockedResponse(
  fence: ReleaseFence,
  options: { discloseControlIdentity?: boolean } = {}
): NextResponse {
  const controlIdentity = options.discloseControlIdentity
    ? { fenceId: fence.fenceId, releaseCommitSha: fence.releaseCommitSha }
    : {};
  return NextResponse.json(
    {
      error: "Writes are temporarily paused for release safety",
      ...controlIdentity
    },
    {
      status: 423,
      headers: {
        ...privateNoStoreHeaders(),
        "x-request-id": createApiRequestId()
      }
    }
  );
}

function operationFor(action: ReleaseFenceControlAction): ReleaseFenceOperation {
  if (action === "acquire") return acquireReleaseFence;
  if (action === "assert") return assertReleaseFence;
  if (action === "reacquire") return reacquireReleaseFence;
  return releaseReleaseFence;
}

function authenticateFenceControl(request: Request): NextResponse | null {
  const expected = process.env.RELEASE_FENCE_SECRET;
  if (!isValidReleaseFenceSecret(expected)) {
    return controlError(503, "Release fence control is not configured");
  }

  const authorization = request.headers.get("authorization");
  const provided = authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
  if (!provided || !safeSecretEqual(provided, expected)) {
    return controlError(401, "Unauthorized");
  }
  return null;
}

export function isValidReleaseFenceSecret(value: string | undefined): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43,128}$/.test(value);
}

async function readFenceIdentity(request: Request): Promise<ReleaseFenceIdentity | null> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    return null;
  }
  const declaredLength = Number.parseInt(request.headers.get("content-length") ?? "", 10);
  if (Number.isFinite(declaredLength) && declaredLength > maximumControlBodyBytes) return null;

  try {
    const source = await request.text();
    if (Buffer.byteLength(source, "utf8") > maximumControlBodyBytes) return null;
    const value: unknown = JSON.parse(source);
    if (!isRecord(value)) return null;
    if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(["fenceId", "releaseCommitSha"])) {
      return null;
    }
    if (typeof value.fenceId !== "string" || typeof value.releaseCommitSha !== "string") return null;
    return validateReleaseFenceIdentity({
      fenceId: value.fenceId,
      releaseCommitSha: value.releaseCommitSha
    });
  } catch {
    return null;
  }
}

function safeSecretEqual(provided: string, expected: string): boolean {
  const providedDigest = createHash("sha256").update(provided, "utf8").digest();
  const expectedDigest = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

function controlError(status: number, error: string): NextResponse {
  return NextResponse.json({ error }, { status, headers: privateNoStoreHeaders() });
}

function privateNoStoreHeaders(): Record<string, string> {
  return { "cache-control": "private, no-store" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
