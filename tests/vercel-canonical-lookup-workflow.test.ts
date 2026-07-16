import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const workflowNames = [
  "vercel-holding.yml",
  "vercel-release.yml",
  "release-containment.yml",
  "recovery-evidence.yml"
] as const;

const canonicalModes = ["holding", "containment", "promoted"] as const;
const canonicalInvocation = new RegExp(
  `scripts/validate-vercel-deployment\\.mjs (${canonicalModes.join("|")})`,
  "g"
);

describe("Vercel canonical hostname lookup workflow contract", () => {
  it.each(workflowNames)(
    "%s binds every canonical response validator to APP_BASE_URL's exact hostname",
    async (workflowName) => {
      const contents = await readFile(
        path.join(process.cwd(), ".github", "workflows", workflowName),
        "utf8"
      );
      const invocations = [...contents.matchAll(canonicalInvocation)];

      expect(invocations.length).toBeGreaterThan(0);
      for (const match of invocations) {
        const invocationIndex = match.index;
        const invocation = contents.slice(invocationIndex, invocationIndex + 400);
        const inputFile = invocation.match(/("[^"\n]+\.json")/i)?.[1];
        expect(inputFile).toBeDefined();
        expect(invocation).toContain('"${APP_BASE_URL#https://}"');

        const outputIndex = contents.lastIndexOf(`--output ${inputFile}`, invocationIndex);
        expect(outputIndex, `missing canonical fetch for ${inputFile}`).toBeGreaterThan(0);
        const curlIndex = contents.lastIndexOf("curl ", outputIndex);
        expect(curlIndex, `missing curl for ${inputFile}`).toBeGreaterThan(0);
        const stepIndex = contents.lastIndexOf("\n      - name:", curlIndex);
        const fetchBlock = contents.slice(stepIndex, outputIndex + inputFile!.length + 9);
        const hostnameVariable = fetchBlock.match(
          /(deployment_host|canonical_host)="\$\{APP_BASE_URL#https:\/\/\}"/
        )?.[1];
        expect(
          hostnameVariable,
          `canonical fetch for ${inputFile} must derive its hostname from APP_BASE_URL`
        ).toBeDefined();
        expect(fetchBlock).toMatch(new RegExp(
          `/v13/deployments/(?:\\$${hostnameVariable}|\\$\\{${hostnameVariable}\\})`
        ));
      }
    }
  );
});
