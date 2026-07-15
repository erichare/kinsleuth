import { NextResponse } from "next/server";

import { withPermission } from "@/lib/api-authorization";
import {
  integrationErrorResponse,
  nonEmptyString,
  readJsonObject
} from "@/lib/integrations/api-response";
import { getIntegrationFeatureFlags, isIntegrationProviderEnabled } from "@/lib/integrations/feature-flags";
import { toPublicIntegrationConnection } from "@/lib/integrations/public-projections";
import type { IntegrationProvider } from "@/lib/integrations/types";
import {
  createIntegrationConnection,
  listIntegrationConnections
} from "@/lib/integrations/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const supportedProviders = new Set([
  "ancestry_export",
  "family_tree_maker",
  "rootsmagic",
  "gedcom"
]);
const supportedAuthorities = new Set([
  "ancestry",
  "family_tree_maker",
  "rootsmagic",
  "another_genealogy_app"
]);

export const GET = withPermission("imports:manage", async (_request, authorization) => {
  try {
    const items = await listIntegrationConnections({ archiveId: authorization.archiveId });
    return NextResponse.json({ items: items.map(toPublicIntegrationConnection) });
  } catch (error) {
    return integrationErrorResponse(error, "Unable to list data sources");
  }
});

export const POST = withPermission("imports:manage", async (request, authorization) => {
  const body = await readJsonObject(request);
  if (!body.ok) return body.response;

  const provider = nonEmptyString(body.value.provider, 64);
  const authority = nonEmptyString(body.value.authority, 64);
  const displayName = nonEmptyString(body.value.displayName, 240);
  if (
    !provider
    || !authority
    || !displayName
    || !supportedProviders.has(provider)
    || !supportedAuthorities.has(authority)
  ) {
    return NextResponse.json({ error: "Choose a supported data source and name" }, { status: 400 });
  }
  if (!isIntegrationProviderEnabled(provider as IntegrationProvider, getIntegrationFeatureFlags())) {
    return NextResponse.json({ error: "This data-source import is not enabled" }, { status: 404 });
  }

  try {
    const connection = await createIntegrationConnection(
      { provider, authority, displayName },
      { archiveId: authorization.archiveId }
    );
    return NextResponse.json(
      { connection: toPublicIntegrationConnection(connection) },
      { status: 201 }
    );
  } catch (error) {
    return integrationErrorResponse(error, "Unable to create the data source");
  }
});
