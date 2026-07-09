import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({
    status: "ok",
    product: "KinSleuth",
    version: "0.17.0"
  });
}
