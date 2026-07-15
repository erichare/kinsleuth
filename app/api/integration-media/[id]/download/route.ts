import { withPermission } from "@/lib/api-authorization";
import { integrationErrorResponse } from "@/lib/integrations/api-response";
import { streamIntegrationMedia } from "@/lib/integrations/media-store";

type RouteContext = { params: Promise<{ id: string }> };

export const GET = withPermission("imports:manage", async (_request, authorization, context: RouteContext) => {
  const { id } = await context.params;
  try {
    const { media, body } = await streamIntegrationMedia(id, {
      archiveId: authorization.archiveId
    });
    return new Response(toReadableStream(body), {
      status: 200,
      headers: {
        "cache-control": "private, no-store",
        "content-disposition": `attachment; filename="${downloadFileName(media.sourceArchivePath, media.mimeType)}"`,
        "content-length": String(media.size),
        "content-security-policy": "default-src 'none'; sandbox",
        "content-type": media.mimeType,
        "x-content-type-options": "nosniff"
      }
    });
  } catch (error) {
    return integrationErrorResponse(error, "Unable to download private integration media", "Media not found");
  }
});

function toReadableStream(iterable: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> {
  const iterator = iterable[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const result = await iterator.next();
      if (result.done) controller.close();
      else controller.enqueue(result.value);
    },
    async cancel() {
      await iterator.return?.();
    }
  });
}

function downloadFileName(sourceArchivePath: string, mimeType: string): string {
  const fallbackExtension = mimeType === "application/pdf" ? ".pdf" : "";
  const candidate = sourceArchivePath.split("/").at(-1) || `private-media${fallbackExtension}`;
  const sanitized = candidate.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 180);
  return sanitized || `private-media${fallbackExtension}`;
}
