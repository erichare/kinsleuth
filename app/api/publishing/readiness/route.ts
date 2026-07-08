import { NextResponse } from "next/server";
import { demoPeople } from "@/lib/demo-data";
import { buildPublicationPlan } from "@/lib/publishing";

export function GET() {
  return NextResponse.json(buildPublicationPlan(demoPeople));
}
