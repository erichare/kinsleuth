import { NextResponse } from "next/server";

import { apiErrorResponse, createApiRequestId } from "./api-response";
import { getSessionContext, type SessionContext } from "./auth-session";
import { hasPermission, type Permission } from "./rbac";
import { captureOperationalError } from "./observability";

export type AuthorizedRequestContext = SessionContext & {
  requestId: string;
};

export type PermissionResult =
  | { ok: true; context: AuthorizedRequestContext }
  | { ok: false; response: NextResponse };

export async function requirePermission(
  request: Request,
  permission: Permission
): Promise<PermissionResult> {
  const requestId = createApiRequestId();

  try {
    const session = await getSessionContext(request.headers);
    if (!session) {
      return deniedResponse(401, "Authentication required", requestId);
    }
    if (!hasPermission(session.role, permission)) {
      return deniedResponse(403, "Permission denied", requestId);
    }

    return {
      ok: true,
      context: {
        ...session,
        requestId
      }
    };
  } catch (error) {
    await captureOperationalError({
      event: "api_error",
      requestId,
      route: "/api/authorization"
    }, error);
    return deniedResponse(500, "Authorization check failed", requestId);
  }
}

export function withPermission<RouteArguments extends unknown[]>(
  permission: Permission,
  handler: (
    request: Request,
    context: AuthorizedRequestContext,
    ...arguments_: RouteArguments
  ) => Response | Promise<Response>
): (request: Request, ...arguments_: RouteArguments) => Promise<Response> {
  return async (request, ...arguments_) => {
    const authorization = await requirePermission(request, permission);
    if (!authorization.ok) return authorization.response;

    const response = await handler(request, authorization.context, ...arguments_);
    response.headers.set("x-request-id", authorization.context.requestId);
    return response;
  };
}

function deniedResponse(
  status: number,
  error: string,
  requestId: string
): Extract<PermissionResult, { ok: false }> {
  return {
    ok: false,
    response: apiErrorResponse(status, error, { requestId })
  };
}
