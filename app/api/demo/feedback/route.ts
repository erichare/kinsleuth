import { NextResponse } from "next/server";
import { z } from "zod";

import { withDemoGuestCapability } from "@/lib/api-authorization";
import { recordPublicDemoEvent } from "@/lib/public-demo-session-store";

export const dynamic = "force-dynamic";

const feedbackSchema = z.object({
  usefulness: z.number().int().min(1).max(5),
  clarity: z.number().int().min(1).max(5),
  featureInterest: z.enum([
    "research-cases",
    "sources",
    "gedcom",
    "dna",
    "ai",
    "public-family"
  ]),
  betaInterest: z.boolean()
}).strict();

export const POST = withDemoGuestCapability("demo:feedback", async (request, guest) => {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be JSON" }, { status: 400 });
  }

  const parsed = feedbackSchema.safeParse(value);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid feedback ratings" }, { status: 400 });
  }

  await recordPublicDemoEvent({
    sessionId: guest.sessionId,
    eventName: "feedback_submitted",
    feedback: {
      usefulness: parsed.data.usefulness,
      clarity: parsed.data.clarity,
      featureInterest: parsed.data.featureInterest,
      betaInterest: parsed.data.betaInterest
    }
  });
  return NextResponse.json({ saved: true }, { status: 201 });
});
