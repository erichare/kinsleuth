import { NextResponse } from "next/server";

import {
  HostedCapabilityError,
  requireHostedCapability,
  resolveHostedCapabilities,
  type HostedCapabilityName
} from "./hosted-capabilities";
import { captureOperationalError } from "./observability";

type Environment = Record<string, string | undefined>;

export function capabilityUnavailableResponse(
  capability: HostedCapabilityName,
  environment: Environment = process.env
): NextResponse | undefined {
  try {
    requireHostedCapability(capability, environment);
    return undefined;
  } catch (error) {
    if (error instanceof HostedCapabilityError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    void captureOperationalError({
      event: "api_error",
      route: "/api/capability"
    }, error);
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }
}

export function hostedDeploymentUnavailableResponse(
  environment: Environment = process.env
): NextResponse | undefined {
  try {
    if (resolveHostedCapabilities(environment).deploymentMode === "hosted") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return undefined;
  } catch (error) {
    void captureOperationalError({
      event: "api_error",
      route: "/api/capability"
    }, error);
    return NextResponse.json({ error: "Service unavailable" }, { status: 503 });
  }
}
