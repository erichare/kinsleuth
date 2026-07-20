import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sqlReaderModules = [
  "lib/store/people-queries.ts",
  "lib/store/case-queries.ts",
  "lib/store/source-queries.ts",
  "lib/store/dna-queries.ts"
] as const;

describe("public demo SQL read generation snapshot", () => {
  it("keeps archive provisioning and the demo generation fence locked for the complete read callback", async () => {
    const workspaceStore = await source("lib/workspace-store.ts");
    const readTransaction = exportedFunction(
      workspaceStore,
      "withWorkspaceReadTransaction"
    );

    expect(
      readTransaction,
      "Add a shared SQL-read seam that owns the transaction used by both generation validation and every archive query."
    ).not.toBe("");
    expect(readTransaction).toContain("withTransaction(withRlsArchiveScope(options, archiveId)");
    expect(readTransaction).toContain("requireProvisionedArchiveRow(client, archiveId, options)");
    expect(readTransaction).toMatch(/action\(client,\s*archiveId\)/);

    const transaction = readTransaction.indexOf("withTransaction(withRlsArchiveScope(options, archiveId)");
    const fence = readTransaction.indexOf("requireProvisionedArchiveRow(client, archiveId, options)");
    const queryCallback = readTransaction.search(/action\(client,\s*archiveId\)/);
    expect(transaction).toBeGreaterThan(-1);
    expect(fence).toBeGreaterThan(transaction);
    expect(queryCallback).toBeGreaterThan(fence);
  });

  it.each(sqlReaderModules)(
    "%s runs every exported SQL reader through that fenced transaction instead of a later pool query",
    async (relativePath) => {
      const contents = await source(relativePath);
      const exportedReaders = exportedAsyncFunctions(contents);

      expect(exportedReaders.length).toBeGreaterThan(0);
      expect(contents).not.toMatch(
        /import\s*\{[^}]*\bquery\b[^}]*\}\s*from\s*["']\.\.\/db["']/s
      );
      expect(contents).not.toContain("ensureWorkspaceProvisioned");

      for (const reader of exportedReaders) {
        expect(
          reader.source,
          `${relativePath}:${reader.name} must keep its SQL inside withWorkspaceReadTransaction so reset cannot rotate the generation between validation and query.`
        ).toContain("withWorkspaceReadTransaction(");
      }
    }
  );
});

function exportedAsyncFunctions(contents: string): Array<{ name: string; source: string }> {
  const matches = [...contents.matchAll(/^export async function\s+([A-Za-z0-9_]+)\s*\(/gm)];
  return matches.map((match, index) => ({
    name: match[1]!,
    source: contents.slice(match.index, matches[index + 1]?.index ?? contents.length)
  }));
}

function exportedFunction(contents: string, name: string): string {
  return exportedAsyncFunctions(contents).find((candidate) => candidate.name === name)?.source ?? "";
}

function source(relativePath: string): Promise<string> {
  return readFile(path.join(process.cwd(), relativePath), "utf8");
}
