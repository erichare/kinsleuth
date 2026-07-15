import { NextResponse } from "next/server";

import { withPermission } from "@/lib/api-authorization";
import { integrationErrorResponse } from "@/lib/integrations/api-response";
import { listIntegrationMedia } from "@/lib/integrations/media-store";
import { toPublicIntegrationMedia } from "@/lib/integrations/public-projections";

export const GET = withPermission("imports:manage", async (request, authorization) => {
  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor")?.trim() || undefined;
  const rawPageSize = url.searchParams.get("pageSize");
  const pageSize = rawPageSize === null ? undefined : Number(rawPageSize);
  if (rawPageSize !== null && !Number.isInteger(pageSize)) {
    return NextResponse.json({ error: "The request is invalid" }, { status: 400 });
  }

  try {
    const result = await listIntegrationMedia(
      { cursor, pageSize },
      { archiveId: authorization.archiveId }
    );
    return NextResponse.json({
      ...result,
      items: result.items.map(toPublicIntegrationMedia)
    }, {
      headers: { "cache-control": "private, no-store" }
    });
  } catch (error) {
    return integrationErrorResponse(error, "Unable to list private integration media", "Media not found");
  }
});
