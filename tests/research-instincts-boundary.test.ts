import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const adapterAndRoutePaths = [
  "site/components/research-instincts-challenge.tsx",
  "lib/research-instincts.ts",
  "components/research-instincts-challenge.tsx",
  "app/challenge/page.tsx",
  "site/app/challenge/page.tsx"
] as const;

async function sharedModulePaths(directory = path.join(process.cwd(), "site/shared")): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) return sharedModulePaths(absolutePath);
      if (!entry.isFile() || !/\.[cm]?[jt]sx?$/.test(entry.name)) return [];
      return [path.relative(process.cwd(), absolutePath)];
    })
  );

  return paths.flat().sort();
}

async function implementationPaths() {
  return [...(await sharedModulePaths()), ...adapterAndRoutePaths];
}

function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/(?:from\s+|import\s*)["']([^"']+)["']/g)].map((match) => match[1]);
}

describe("research instincts static public boundary", () => {
  it("recursively discovers every shared implementation module", async () => {
    const sharedPaths = await sharedModulePaths();

    expect(sharedPaths).toContain("site/shared/research-instincts.ts");
    expect(sharedPaths).toContain("site/shared/research-instincts-challenge.tsx");
  });

  it("does not import private auth, database, session, or workspace modules", async () => {
    for (const relativePath of await implementationPaths()) {
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

  it("keeps every shared module browser-local without API or network mutation", async () => {
    const sharedPaths = await sharedModulePaths();
    const sources = await Promise.all(
      sharedPaths.map(async (relativePath) => ({
        relativePath,
        source: await readFile(path.join(process.cwd(), relativePath), "utf8")
      }))
    );

    for (const { relativePath, source } of sources) {
      expect(source, relativePath).not.toMatch(/\bfetch\s*\(/);
      expect(source, relativePath).not.toMatch(/\bXMLHttpRequest\b/);
      expect(source, relativePath).not.toMatch(/["'`]\/api\//);
    }
    expect(sources.map(({ source }) => source).join("\n")).toContain("RESEARCH_INSTINCTS_STORAGE_KEY");
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

  it("makes the same challenge discoverable from the static marketing site", async () => {
    const [home, product, challenge] = await Promise.all([
      readFile(path.join(process.cwd(), "site/app/page.tsx"), "utf8"),
      readFile(path.join(process.cwd(), "site/app/product/page.tsx"), "utf8"),
      readFile(path.join(process.cwd(), "site/app/challenge/page.tsx"), "utf8")
    ]);

    expect(home).toMatch(/href=["']\/challenge["']/);
    expect(product).toMatch(/href=["']\/challenge["']/);
    expect(product).toMatch(/primaryHref=\{site\.demoUrl\}/);
    expect(product).toMatch(/primaryLabel=["']Try Kin Resolve["']/);
    expect(product).toMatch(/secondaryHref=["']\/beta["']/);
    expect(challenge).toMatch(/ResearchInstinctsChallenge/);
    expect(challenge).toMatch(/@\/components\/research-instincts-challenge/);
    expect(challenge).toMatch(/robots[\s\S]*index:\s*false/);
    expect(challenge).toMatch(/fictional/i);
  });
});
