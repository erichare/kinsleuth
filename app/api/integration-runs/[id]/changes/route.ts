import { NextResponse } from "next/server";

import { withPermission } from "@/lib/api-authorization";
import { integrationErrorResponse } from "@/lib/integrations/api-response";
import { toPublicSyncChange } from "@/lib/integrations/public-projections";
import { listSyncChanges } from "@/lib/integrations/store";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = withPermission("imports:manage", async (request, authorization, context: RouteContext) => {
  const { id } = await context.params;
  const url = new URL(request.url);
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null ? 50 : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return NextResponse.json({ error: "Page limit must be between 1 and 100" }, { status: 400 });
  }
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const rawQuery = url.searchParams.get("query");
  const searchQuery = rawQuery?.trim() || undefined;
  const classification = url.searchParams.get("classification") ?? undefined;
  if ((searchQuery && searchQuery.length > 160) || (classification && ![
    "remote_only",
    "local_only",
    "same",
    "conflict",
    "deletion"
  ].includes(classification))) {
    return NextResponse.json({ error: "Choose valid change filters" }, { status: 400 });
  }

  try {
    const page = await listSyncChanges(
      id,
      {
        ...(cursor ? { cursor } : {}),
        limit,
        ...(searchQuery ? { query: searchQuery } : {}),
        ...(classification ? { classification: classification as "remote_only" | "local_only" | "same" | "conflict" | "deletion" } : {})
      },
      { archiveId: authorization.archiveId }
    );
    return NextResponse.json({
      ...page,
      items: page.items.map(toPublicSyncChange)
    });
  } catch (error) {
    return integrationErrorResponse(error, "Unable to list refresh changes", "Refresh not found");
  }
});
