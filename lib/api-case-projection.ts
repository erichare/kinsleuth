import { NextResponse } from "next/server";
import {
  isDnaResearchCase,
  projectCaseResponseForDnaCapability
} from "./case-search";
import { resolveHostedCapabilities } from "./hosted-capabilities";
import { readResearchCase } from "./workspace-store";

export function projectCaseApiResponse(value: unknown): unknown {
  return projectCaseResponseForDnaCapability(value, resolveHostedCapabilities().dna);
}

export async function unavailableCaseMutationResponse(
  caseId: string,
  archiveId: string
): Promise<NextResponse | undefined> {
  const capabilities = resolveHostedCapabilities();
  if (capabilities.dna) {
    return undefined;
  }

  const researchCase = await readResearchCase(caseId, { archiveId });
  if (!researchCase || isDnaResearchCase(researchCase)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return undefined;
}
