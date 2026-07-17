import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { calculateTreeResetScale, PublicFamilyTree } from "@/components/public-family-tree";
import { buildFamilyTreeLayout } from "@/lib/family-tree";
import { readPublicFamilyProjection } from "@/lib/public-family";

describe("public family tree", () => {
  it("builds deterministic connectors for every typed family unit", async () => {
    const family = await readPublicFamilyProjection();
    const layout = buildFamilyTreeLayout(family.tree);

    expect(layout.nodes).toHaveLength(16);
    expect(layout.connectors).toHaveLength(7);
    expect(new Set(layout.nodes.map((node) => node.personId)).size).toBe(16);
    expect(layout.nodes.find((node) => node.personId === "p-orson-hartwell")?.generationLabel).toBe("Great-grandparents");
    expect(layout.nodes.find((node) => node.personId === "p-clara-mercer")?.generationLabel).toBe("Children");
    expect(layout.connectors.find((connector) => connector.familyId === "family-nora-samuel")?.descendantPath).toContain(" V ");
  });

  it("renders all profiles as linked nodes in a labelled, keyboard-scrollable tree region", async () => {
    const family = await readPublicFamilyProjection();
    const html = renderToStaticMarkup(createElement(PublicFamilyTree, {
      people: family.people,
      tree: family.tree
    }));
    const renderedPeople = [...html.matchAll(/data-tree-person="([^"]+)"/g)].map((match) => match[1]);

    expect(renderedPeople).toHaveLength(16);
    expect(new Set(renderedPeople).size).toBe(16);
    expect(html).toContain("data-public-family-tree");
    expect(html).toMatch(/role="region"[^>]*tabindex="0"/);
    expect(html).toContain("Complete family tree");
    expect(html).toContain("Reset view");
    expect(html).toContain('href="/people/nora-elise-hartwell"');
    expect(html).toContain('href="/people/eileen-grace-pike"');
    expect(html.match(/data-family-unit=/g)).toHaveLength(7);
  });

  it("keeps reset views readable when the whole canvas cannot fit", () => {
    expect(calculateTreeResetScale(1_180, 1_280)).toBe(0.9);
    expect(calculateTreeResetScale(390, 1_280)).toBe(0.9);
    expect(calculateTreeResetScale(1_400, 1_280)).toBe(1);
  });
});
