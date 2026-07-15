import { NextResponse } from "next/server";

import { withPermission } from "@/lib/api-authorization";
import { integrationErrorResponse } from "@/lib/integrations/api-response";
import { disconnectIntegrationConnection } from "@/lib/integrations/store";

type RouteContext = { params: Promise<{ id: string }> };

export const DELETE = withPermission("imports:manage", async (_request, authorization, context: RouteContext) => {
  const { id } = await context.params;
  try {
    await disconnectIntegrationConnection(id, { archiveId: authorization.archiveId });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return integrationErrorResponse(error, "Unable to disconnect the data source");
  }
});
