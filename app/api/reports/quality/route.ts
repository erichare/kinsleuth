import { NextResponse } from "next/server";
import { withPermission } from "@/lib/api-authorization";
import { resolveHostedCapabilities } from "@/lib/hosted-capabilities";
import { parsePositiveInteger } from "@/lib/pagination";
import { buildQualityReportPage } from "@/lib/quality";
import { readWorkspace } from "@/lib/workspace-store";

export const dynamic = "force-dynamic";

export const GET = withPermission("archive:read-private", async (request, authorization) => {
  const capabilities = resolveHostedCapabilities();
  const workspace = await readWorkspace({ archiveId: authorization.archiveId });
  const url = new URL(request.url);

  return NextResponse.json(
    buildQualityReportPage(workspace.people, capabilities.dna ? workspace.dnaMatches : [], workspace.cases, {
      page: parsePositiveInteger(url.searchParams.get("page"), 1),
      pageSize: parsePositiveInteger(url.searchParams.get("pageSize"), 50)
    })
  );
});
