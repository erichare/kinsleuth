import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const implementationPaths = [
  "lib/research-instincts.ts",
  "components/research-instincts-challenge.tsx",
  "app/challenge/page.tsx"
] as const;

function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/(?:from\s+|import\s*)["']([^"']+)["']/g)].map((match) => match[1]);
}

describe("research instincts static public boundary", () => {
  it("does not import private auth, database, session, or workspace modules", async () => {
    for (const relativePath of implementationPaths) {
      const source = await readFile(path.join(process.cwd(), relativePath), "utf8");
      const imports = importSpecifiers(source);

      expect(imports, relativePath).not.toContain("pg");
      expect(imports, relativePath).not.toContain("better-auth");
      expect(imports, relativePath).not.toContain("@/lib/db");
      expect(imports, relativePath).not.toContain("@/lib/workspace-store");
      expect(imports, relativePath).not.toContain("@/lib/auth");
      expect(imports, relativePath).not.toContain("@/lib/auth-session");
      expect(imports, relativePath).not.toContain("@/lib/session");
      expect(imports.some((specifier) => specifier.startsWith("@/lib/store/")), relativePath).toBe(false);
    }
  });

  it("uses browser-local progress without API or network mutation", async () => {
    const source = await readFile(
      path.join(process.cwd(), "components/research-instincts-challenge.tsx"),
      "utf8"
    );

    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/\bXMLHttpRequest\b/);
    expect(source).not.toMatch(/["'`]\/api\//);
    expect(source).toContain("RESEARCH_INSTINCTS_STORAGE_KEY");
  });

  it("links to the easter egg from both public discovery surfaces", async () => {
    const [home, stories] = await Promise.all([
      readFile(path.join(process.cwd(), "app/page.tsx"), "utf8"),
      readFile(path.join(process.cwd(), "app/stories/page.tsx"), "utf8")
    ]);

    expect(home).toMatch(/href=["']\/challenge["']/);
    expect(stories).toMatch(/href=["']\/challenge["']/);
    expect(`${home}\n${stories}`).toMatch(/test your genealogical skills/i);
  });
});
