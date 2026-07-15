import { withPermission } from "@/lib/api-authorization";
import { integrationErrorResponse } from "@/lib/integrations/api-response";
import { streamIntegrationArtifact } from "@/lib/integrations/artifact-store";

type RouteContext = {
  params: Promise<{ id: string; artifactId: string }>;
};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const GET = withPermission("imports:manage", async (_request, authorization, context: RouteContext) => {
  const { id, artifactId } = await context.params;
  try {
    const { artifact, body } = await streamIntegrationArtifact(id, artifactId, {
      archiveId: authorization.archiveId
    });
    return new Response(toReadableStream(body), {
      status: 200,
      headers: {
        "cache-control": "private, no-store",
        "content-disposition": attachmentContentDisposition(artifact.fileName),
        "content-length": String(artifact.size),
        "content-security-policy": "default-src 'none'; sandbox",
        "content-type": "application/octet-stream",
        "x-content-type-options": "nosniff"
      }
    });
  } catch (error) {
    return integrationErrorResponse(
      error,
      "Unable to download the private import package",
      "Import package not found"
    );
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

function attachmentContentDisposition(fileName: string): string {
  const normalizedPath = toWellFormed(fileName).normalize("NFKC").replace(/\\/g, "/");
  const candidate = normalizedPath.split("/").at(-1)
    ?.replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
  const limited = Array.from(candidate || "kin-resolve-import.bin").slice(0, 180).join("");
  const safeName = !limited || limited === "." || limited === ".."
    ? "kin-resolve-import.bin"
    : limited;
  const fallback = safeName
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\;]/g, "_");
  const encoded = encodeURIComponent(safeName).replace(/['()*]/g, (character) => (
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  ));
  return `attachment; filename="${fallback || "kin-resolve-import.bin"}"; filename*=UTF-8''${encoded}`;
}

function toWellFormed(value: string): string {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint >= 0xd800 && codePoint <= 0xdfff ? "\ufffd" : character;
  }).join("");
}
