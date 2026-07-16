import { NextResponse } from "next/server";
import { z } from "zod";

import { withDemoGuestCapability } from "@/lib/api-authorization";
import { captureOperationalError } from "@/lib/observability";
import {
  publicDemoSampleFixtureId,
  runPublicDemoSampleImport
} from "@/lib/public-demo-sample-import";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const sampleImportSchema = z.object({
  fixtureId: z.literal(publicDemoSampleFixtureId),
  action: z.enum(["review", "apply", "rollback"])
}).strict();

export const POST = withDemoGuestCapability("demo:sample-import", async (request, guest) => {
  try {
    const value = await request.json();
    const parsed = sampleImportSchema.safeParse(value);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid bundled sample operation" }, { status: 400 });
    }

    const result = await runPublicDemoSampleImport(
      parsed.data.action,
      parsed.data.fixtureId,
      { archiveId: guest.archiveId }
    );
    return NextResponse.json(result, { status: parsed.data.action === "apply" ? 201 : 200 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
    }
    if (error instanceof Error && /has not been applied|already applied/.test(error.message)) {
      return NextResponse.json({ error: "The bundled sample state changed; review it before continuing" }, { status: 409 });
    }
    await captureOperationalError({
      event: "api_error",
      requestId: guest.requestId,
      route: "/api/demo/sample-import"
    }, error);
    return NextResponse.json({ error: "Unable to run the bundled sample operation" }, { status: 500 });
  }
});
