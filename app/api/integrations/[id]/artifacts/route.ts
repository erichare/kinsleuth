import { NextResponse } from "next/server";

import { withPermission } from "@/lib/api-authorization";
import {
  integrationErrorResponse,
  nonEmptyString,
  readJsonObject
} from "@/lib/integrations/api-response";
import {
  createIntegrationArtifact,
  deleteIntegrationArtifact
} from "@/lib/integrations/store";
import { toPublicIntegrationArtifact } from "@/lib/integrations/artifact-store";
import { DESKTOP_MEDIA_RIGHTS_ACKNOWLEDGEMENT_VERSION } from "@/lib/integrations/types";

type RouteContext = { params: Promise<{ id: string }> };

export const runtime = "nodejs";
export const maxDuration = 60;

// This route currently buffers multipart bodies in the Next.js process. Keep its
// ceiling aligned with the deployment request limit; larger media packages will
// use a future direct-to-object-storage completion flow.
const maximumPackageSizeBytes = 64 * 1024 * 1024;
const executableExtension = /\.(?:app|bat|cmd|com|dll|dmg|exe|jar|js|msi|ps1|scr|sh)$/i;
const executableMime = new Set([
  "application/x-msdownload",
  "application/x-dosexec",
  "application/x-executable"
]);

export const POST = withPermission("imports:manage", async (request, authorization, context: RouteContext) => {
  const { id } = await context.params;
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Upload a GEDCOM or ZIP package" }, { status: 400 });
  }

  const selected = form.get("file");
  if (!(selected instanceof File) || !selected.name.trim() || selected.size === 0) {
    return NextResponse.json({ error: "Upload a GEDCOM or ZIP package" }, { status: 400 });
  }
  if (selected.size > maximumPackageSizeBytes) {
    return NextResponse.json({ error: "The selected package is too large" }, { status: 413 });
  }
  const acknowledgementAccepted = form.get("mediaRightsAcknowledgementAccepted");
  const acknowledgementVersion = form.get("mediaRightsAcknowledgementVersion");
  const acknowledgementSupplied = acknowledgementAccepted !== null || acknowledgementVersion !== null;
  if (
    acknowledgementSupplied
    && (
      acknowledgementAccepted !== "true"
      || acknowledgementVersion !== DESKTOP_MEDIA_RIGHTS_ACKNOWLEDGEMENT_VERSION
    )
  ) {
    return NextResponse.json(
      { error: "The current desktop-media rights acknowledgement is required" },
      { status: 400 }
    );
  }

  const bytes = new Uint8Array(await selected.arrayBuffer());
  if (isExecutable(selected, bytes)) {
    return NextResponse.json({ error: "Executable files cannot be imported" }, { status: 415 });
  }

  try {
    const artifact = await createIntegrationArtifact(
      id,
      {
        fileName: selected.name,
        contentType: selected.type || "application/octet-stream",
        size: selected.size,
        bytes,
        ...(acknowledgementSupplied ? {
          mediaRightsAcknowledgement: {
            accepted: true,
            version: DESKTOP_MEDIA_RIGHTS_ACKNOWLEDGEMENT_VERSION,
            actorId: authorization.userId
          }
        } : {})
      },
      { archiveId: authorization.archiveId }
    );
    return NextResponse.json({ artifact: toPublicIntegrationArtifact(artifact) }, { status: 201 });
  } catch (error) {
    return integrationErrorResponse(error, "Unable to stage the private import package");
  }
});

export const DELETE = withPermission("imports:manage", async (request, authorization, context: RouteContext) => {
  const { id } = await context.params;
  const body = await readJsonObject(request);
  if (!body.ok) return body.response;
  const artifactId = nonEmptyString(body.value.artifactId, 128);
  if (!artifactId) {
    return NextResponse.json({ error: "Artifact identifier is required" }, { status: 400 });
  }

  try {
    await deleteIntegrationArtifact(id, artifactId, { archiveId: authorization.archiveId });
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return integrationErrorResponse(error, "Unable to remove the staged package");
  }
});

function isExecutable(file: File, bytes: Uint8Array): boolean {
  return executableExtension.test(file.name)
    || executableMime.has(file.type.toLowerCase())
    || (bytes[0] === 0x4d && bytes[1] === 0x5a);
}
