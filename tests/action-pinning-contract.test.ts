import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { pinnedActionWithComment } from "./helpers/action-pins";

const githubRoot = path.join(process.cwd(), ".github");
const repoRoot = process.cwd();

interface UsesReference {
  readonly file: string;
  readonly reference: string;
}

function collectYamlFiles(): string[] {
  return readdirSync(githubRoot, { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".yml") || entry.endsWith(".yaml"))
    .map((entry) => path.join(githubRoot, entry));
}

function collectUsesReferences(): UsesReference[] {
  const references: UsesReference[] = [];
  for (const file of collectYamlFiles()) {
    const contents = readFileSync(file, "utf8");
    for (const match of contents.matchAll(/^\s*(?:-\s+)?uses:\s*(.+?)\s*$/gm)) {
      references.push({
        file: path.relative(repoRoot, file),
        reference: match[1]
      });
    }
  }
  return references;
}

describe("repository-wide action pinning contract", () => {
  it("pins every remote action under .github to a full commit SHA with a version comment", () => {
    const remote = collectUsesReferences().filter(
      ({ reference }) => !reference.startsWith("./")
    );

    expect(remote.length).toBeGreaterThan(0);
    for (const { file, reference } of remote) {
      expect(reference, `${file}: ${reference}`).toMatch(
        /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+@[0-9a-f]{40} # v\d[\w.-]*$/
      );
    }
  });

  it("resolves every local action reference to a checked-in composite action", () => {
    const local = collectUsesReferences().filter(({ reference }) =>
      reference.startsWith("./")
    );

    expect(local.length).toBeGreaterThan(0);
    for (const { file, reference } of local) {
      expect(reference, `${file}: ${reference}`).toMatch(
        /^\.\/\.github\/actions\/[a-z0-9-]+$/
      );
      const definition = path.join(repoRoot, reference, "action.yml");
      expect(existsSync(definition), `${file}: ${reference} must resolve to ${definition}`).toBe(
        true
      );
    }
  });

  it("pins the composite setup action to the shared immutable setup-node revision", () => {
    const composite = readFileSync(
      path.join(githubRoot, "actions", "setup-node-npm", "action.yml"),
      "utf8"
    );

    expect(composite).toContain(`uses: ${pinnedActionWithComment("setupNode")}`);
    expect(composite).not.toMatch(/uses:\s+actions\/setup-node@v\d/);
    expect(composite).toMatch(/node-version:[\s\S]*?default: "22"/);
    expect(composite).toContain("run: npm ci");
  });
});
