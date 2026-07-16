import { NextResponse } from "next/server";
import { z } from "zod";

import { withDemoGuestCapability } from "@/lib/api-authorization";
import { captureOperationalError } from "@/lib/observability";
import { recordPublicDemoEvent } from "@/lib/public-demo-session-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const eventSchema = z.object({
  eventName: z.literal("beta_cta_clicked")
}).strict();

export const POST = withDemoGuestCapability("demo:analytics", async (request, guest) => {
  try {
    const parsed = eventSchema.safeParse(await request.json());
    if (!parsed.success) {
      return privateJson({ error: "Invalid demo event" }, 400);
    }
    await recordPublicDemoEvent({
      eventName: "beta_cta_clicked",
      sessionId: guest.sessionId
    });
    return privateJson({ accepted: true }, 202);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return privateJson({ error: "Request body must be JSON" }, 400);
    }
    await captureOperationalError({
      event: "api_error",
      requestId: guest.requestId,
      route: "/api/demo/events"
    }, error);
    return privateJson({ error: "Unable to record the demo event" }, 503);
  }
});

function privateJson(body: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex, nofollow, noarchive"
    }
  });
}
