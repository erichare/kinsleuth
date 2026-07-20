import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PersonProfileTabs, personProfileTabAfterKey } from "@/components/person-profile-tabs";
import { demoPeople } from "@/lib/demo-data";
import type { PersonSummary } from "@/lib/models";
import { buildPersonMiniTree } from "@/lib/person-mini-tree";
import { buildPersonProfile } from "@/lib/person-profile";
import { demoFamilyTreeEdges, familyEdgesFromGedcomRecords } from "@/lib/person-relationships";
import { parseGedcom } from "@/lib/gedcom/parser";
import { createDemoWorkspace } from "@/lib/workspace-store";

const now = new Date("2026-07-16T00:00:00.000Z");

describe("person profile tabs", () => {
  it("populates all six sections for every fictional demo person", () => {
    const workspace = createDemoWorkspace(now);

    for (const person of workspace.people) {
      const profile = buildPersonProfile(person, workspace);

      expect(profile.facts.length, `${person.displayName} facts`).toBeGreaterThan(0);
      expect(profile.sources.length, `${person.displayName} sources`).toBeGreaterThan(0);
      expect(profile.timeline.length, `${person.displayName} timeline`).toBeGreaterThan(0);
      expect(profile.notes.length, `${person.displayName} notes`).toBeGreaterThan(0);
      expect(profile.relationships.length, `${person.displayName} relationships`).toBeGreaterThan(0);
      expect(profile.insights.length, `${person.displayName} insights`).toBeGreaterThanOrEqual(3);
      expect(profile.isFictionalDemo, person.displayName).toBe(true);
    }
  });

  it("derives typed relationships from the fictional family definition", () => {
    const workspace = createDemoWorkspace(now);
    const nora = requiredPerson("p-nora-hartwell");
    const relationships = new Map(
      buildPersonProfile(nora, workspace).relationships.map((relationship) => [relationship.id, relationship.relationship])
    );

    expect(Object.fromEntries(relationships)).toMatchObject({
      "p-elias-hartwell": "Father",
      "p-amalia-bellandi": "Mother",
      "p-ada-hartwell": "Sister",
      "p-vincent-hartwell": "Brother",
      "p-samuel-mercer": "Spouse",
      "p-clara-mercer": "Daughter",
      "p-tobias-mercer": "Son",
      "p-iris-mercer": "Daughter",
      "p-peter-mercer": "Son"
    });
  });

  it("derives typed relationships from imported GEDCOM FAM structures", () => {
    // Synthetic Hartwell–Mercer style fictional GEDCOM fixture.
    const parsed = parseGedcom([
      "0 @F1@ FAM",
      "1 HUSB @I1@",
      "1 WIFE @I2@",
      "1 CHIL @I3@",
      "1 CHIL @I4@"
    ].join("\n"));
    const families = familyEdgesFromGedcomRecords(parsed.records);
    const people: PersonSummary[] = [
      importedPerson("@I1@", "Fictional Alder Wexbrook", "M", ["@I2@", "@I3@", "@I4@"]),
      importedPerson("@I2@", "Fictional Sylvie Wexbrook", "F", ["@I1@", "@I3@", "@I4@"]),
      importedPerson("@I3@", "Fictional Colm Wexbrook", "M", ["@I1@", "@I2@", "@I4@"]),
      importedPerson("@I4@", "Fictional Petra Wexbrook", "F", ["@I1@", "@I2@", "@I3@"]),
      importedPerson("@I9@", "Fictional Unlinked Cousin", "U", [])
    ];
    const wife = people[1];
    const profile = buildPersonProfile(
      { ...wife, relatives: [...wife.relatives, "@I9@"] },
      { people, families }
    );
    const labels = Object.fromEntries(
      profile.relationships.map((relationship) => [relationship.id, relationship.relationship])
    );

    expect(labels).toEqual({
      "@I1@": "Husband",
      "@I3@": "Son",
      "@I4@": "Daughter",
      "@I9@": "Linked relative"
    });

    const childLabels = Object.fromEntries(
      buildPersonProfile(people[2], { people, families }).relationships
        .map((relationship) => [relationship.id, relationship.relationship])
    );
    expect(childLabels).toEqual({
      "@I1@": "Father",
      "@I2@": "Mother",
      "@I4@": "Sister"
    });
  });

  it("uses neutral case wording when a profile spans active and planning research", () => {
    const workspace = createDemoWorkspace(now);
    const amalia = requiredPerson("p-amalia-bellandi");
    const insights = buildPersonProfile(amalia, workspace).insights
      .filter((candidate) => candidate.id.startsWith("case-connection:"));

    expect(insights).toHaveLength(2);
    expect(insights.map((insight) => insight.href)).toEqual([
      "/app/cases/case-blue-tin",
      "/app/cases/case-bellandi-ceraluna-alta"
    ]);
    expect(insights.every((insight) => !insight.summary.includes("active research case"))).toBe(true);
  });

  it("preserves canonical names and every conflicting record occurrence in identity trails", () => {
    const workspace = createDemoWorkspace(now);
    const samuelProfile = buildPersonProfile(requiredPerson("p-samuel-mercer"), workspace);
    const amaliaProfile = buildPersonProfile(requiredPerson("p-amalia-bellandi"), workspace);
    const maeveProfile = buildPersonProfile(requiredPerson("p-maeve-mercer"), workspace);

    expect(samuelProfile.identityTrail.map((entry) => entry.name)).toEqual([
      "Samuel Rowan Mercer",
      "Samuel March"
    ]);
    expect(amaliaProfile.identityTrail.map((entry) => [entry.name, entry.date])).toEqual([
      ["Amalia Rose Bellandi", undefined],
      ["Malia Bellandi", "18 Mar 1868"],
      ["Malia Bellandi", "2 Apr 1883"],
      ["Malia Bellandi", "22 Sep 1885"]
    ]);
    expect(amaliaProfile.insights.map((insight) => insight.id)).toEqual(
      expect.arrayContaining(["amalia-age-conflict", "amalia-namesake-conflict"])
    );
    expect(maeveProfile.identityTrail[0]).toMatchObject({
      name: "Maeve Lenora Rowan Mercer",
      kind: "profile"
    });
    expect(maeveProfile.identityTrail[0]?.date).toBeUndefined();
    expect(maeveProfile.identityTrail[0]?.source).toBeUndefined();
  });

  it("deduplicates scan-backed source cards while retaining their claim count", () => {
    const workspace = createDemoWorkspace(now);
    const profile = buildPersonProfile(requiredPerson("p-samuel-mercer"), workspace);
    const recordIds = profile.sources.flatMap((source) => source.media ? [source.media.recordId] : []);

    expect(new Set(recordIds).size).toBe(recordIds.length);
    expect(profile.sources.find((source) => source.media?.recordId === "lantern-passenger-declaration-1907")?.supportCount).toBe(3);
  });

  it("uses canonical scan metadata and preserves every linked claim summary", () => {
    const workspace = createDemoWorkspace(now);
    const profile = buildPersonProfile(requiredPerson("p-amalia-bellandi"), workspace);
    const marriageApplication = profile.sources.find(
      (source) => source.media?.recordId === "amalia-marriage-application-1885"
    );

    expect(marriageApplication).toMatchObject({
      title: "Lantern Bay marriage application",
      sourceType: "Signed civil marriage application",
      repository: "KR-DEMO-C10-R6",
      citationDate: "22 Sep 1885",
      supportCount: 2
    });
    expect(marriageApplication?.summary).toContain("Cited for marriage.");
    expect(marriageApplication?.summary).toContain("Cited for recorded name.");
  });

  it("supports arrow, Home, and End navigation with wraparound", () => {
    expect(personProfileTabAfterKey("facts", "ArrowRight")).toBe("sources");
    expect(personProfileTabAfterKey("facts", "ArrowLeft")).toBe("ai-insights");
    expect(personProfileTabAfterKey("ai-insights", "ArrowRight")).toBe("facts");
    expect(personProfileTabAfterKey("notes", "Home")).toBe("facts");
    expect(personProfileTabAfterKey("notes", "End")).toBe("ai-insights");
    expect(personProfileTabAfterKey("notes", "Enter")).toBeUndefined();
  });

  it("renders accessible interactive tabs and the complete server fallback content", () => {
    const workspace = createDemoWorkspace(now);
    const samuel = requiredPerson("p-samuel-mercer");
    const profile = buildPersonProfile(samuel, workspace);
    const html = renderToStaticMarkup(createElement(PersonProfileTabs, {
      personName: samuel.displayName,
      profile
    }));

    expect(html.match(/role="tab"/g)).toHaveLength(6);
    expect(html.match(/role="tabpanel"/g)).toHaveLength(6);
    expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(html).toMatch(/Facts, 5 items/);
    expect(html).toMatch(/Sources, [1-9][0-9]* items/);
    expect(html).toMatch(/Relationships, 7 items/);
    expect(html).toMatch(/Lantern Packet passenger declaration/);
    expect(html).toMatch(/kr-demo-c07-r4-passenger-declaration\.webp/);
    expect(html).toMatch(/Identity trail/);
    expect(html).toMatch(/Samuel March/);
    expect(html).toMatch(/Accessible transcript/);
    expect(html).toMatch(/Supports 3 linked claims/);
    expect(html).toMatch(/Family lore/);
    expect(html).toMatch(/Research observation/);
    expect(html).toMatch(/Open question/);
    expect(html).toMatch(/Evidence coverage/);
    expect(html).toMatch(/Suggested next check/);
    expect(html).toMatch(/Two names at one address/);
    expect(html).toMatch(/Open connected case/);
    expect(html).toMatch(/Seeded demo analysis/);
    expect(html).toMatch(/prewritten fictional examples/);
  });

  it("renders the interactive mini tree inside the relationships panel", () => {
    const workspace = createDemoWorkspace(now);
    const nora = requiredPerson("p-nora-hartwell");
    const profile = buildPersonProfile(nora, workspace);
    const miniTree = buildPersonMiniTree(nora, workspace.people, demoFamilyTreeEdges);
    const html = renderToStaticMarkup(createElement(PersonProfileTabs, {
      personName: nora.displayName,
      profile,
      miniTree
    }));

    expect(miniTree).toBeDefined();
    expect(html).toContain("Immediate family tree centered on");
    expect(html).toContain(`data-mini-tree-person="p-samuel-mercer"`);
    expect(html).toContain(`href="/app/people/p-samuel-mercer"`);
    expect(html).toContain(`aria-current="true"`);
    expect(html).toContain("Grandparents");
    expect(html.match(/data-mini-tree-person=/g)?.length).toBe(miniTree?.people.length);
    expect(html).toMatch(/person-mini-tree-partners/);
  });

  it("renders no mini tree section without tree data or without linked relatives", () => {
    const workspace = createDemoWorkspace(now);
    const nora = requiredPerson("p-nora-hartwell");
    const withoutTree = renderToStaticMarkup(createElement(PersonProfileTabs, {
      personName: nora.displayName,
      profile: buildPersonProfile(nora, workspace)
    }));
    expect(withoutTree).not.toContain("person-mini-tree-viewport");

    const isolated = { ...nora, relatives: [] };
    const miniTree = buildPersonMiniTree(isolated, workspace.people, demoFamilyTreeEdges);
    const withoutRelatives = renderToStaticMarkup(createElement(PersonProfileTabs, {
      personName: isolated.displayName,
      profile: buildPersonProfile(isolated, workspace),
      miniTree
    }));
    expect(withoutRelatives).not.toContain("person-mini-tree-viewport");
    expect(withoutRelatives).toContain("No linked relatives yet");
  });

  it("shows only analyses scoped to the person or one of their linked cases", () => {
    const workspace = createDemoWorkspace(now);
    const nora = requiredPerson("p-nora-hartwell");
    workspace.aiRuns = [];
    workspace.aiRuns.push(
      {
        id: "run-nora",
        question: "What should we verify for Nora?",
        answer: "Review the journal against the marriage ledger.",
        status: "ready",
        evidenceUsed: [],
        uncertainty: ["The journal is retrospective."],
        anomalyCount: 0,
        suggestions: [],
        contextReferences: [{ id: nora.id, type: "person", label: nora.displayName }],
        providerStatus: "completed",
        createdAt: "2026-07-16T12:00:00.000Z"
      },
      {
        id: "run-unrelated",
        question: "What should we verify for another person?",
        answer: "This analysis should not appear.",
        status: "ready",
        evidenceUsed: [],
        uncertainty: [],
        anomalyCount: 0,
        suggestions: [],
        contextReferences: [{ id: "p-unrelated", type: "person", label: "Unrelated" }],
        providerStatus: "completed",
        createdAt: "2026-07-16T12:05:00.000Z"
      }
    );

    const profile = buildPersonProfile(nora, workspace);

    expect(profile.savedAnalyses.map((analysis) => analysis.id)).toEqual(["run-nora"]);
  });

  it("sorts exact same-year dates by month and day", () => {
    const workspace = createDemoWorkspace(now);
    const samuel = requiredPerson("p-samuel-mercer");
    const profile = buildPersonProfile({
      ...samuel,
      facts: [
        { id: "october", type: "RESI", date: "19 Oct 1909", confidence: 0.8 },
        { id: "march", type: "RESI", date: "3 Mar 1909", confidence: 0.8 },
        { id: "iso", type: "RESI", date: "1909-01-12", confidence: 0.8 }
      ]
    }, workspace);

    expect(profile.timeline.map((event) => event.id)).toEqual(["iso", "march", "october"]);
  });

  it("describes a single dated fact without inventing a recorded place", () => {
    const workspace = createDemoWorkspace(now);
    const samuel = requiredPerson("p-samuel-mercer");
    const profile = buildPersonProfile({
      ...samuel,
      birthPlace: undefined,
      facts: [
        { id: "undisclosed-place", type: "BIRT", date: "1901", confidence: 0.8 },
        { id: "undated-london", type: "RESI", place: "London", confidence: 0.8 }
      ]
    }, {
      ...workspace,
      cases: [],
      sources: [],
      aiRuns: []
    });
    const timelineInsight = profile.insights.find((insight) => insight.id === "timeline-pattern");

    expect(timelineInsight?.summary).toBe("1 dated event is recorded in 1901, with no recorded place.");
    expect(timelineInsight?.summary).not.toMatch(/1 dated events|1 recorded place/);
  });

  it("redacts provider metadata when external AI is disabled", () => {
    const workspace = createDemoWorkspace(now);
    const samuel = requiredPerson("p-samuel-mercer");
    const profile = buildPersonProfile(samuel, {
      ...workspace,
      aiRuns: [{
        id: "run-provider-metadata",
        question: "What should we verify?",
        answer: "Keep the saved, reviewable conclusion.",
        status: "ready",
        evidenceUsed: [],
        uncertainty: [],
        anomalyCount: 0,
        suggestions: [],
        contextReferences: [{ id: samuel.id, type: "person", label: samuel.displayName }],
        provider: "SECRET_PROVIDER",
        model: "SECRET_MODEL",
        providerStatus: "completed",
        createdAt: now.toISOString()
      }],
      includeProviderMetadata: false
    });

    expect(profile.savedAnalyses).toMatchObject([{
      answer: "Keep the saved, reviewable conclusion.",
      provider: undefined,
      model: undefined
    }]);
  });

  it("does not attach synthetic demo scans to a non-demo profile with colliding IDs", () => {
    const workspace = createDemoWorkspace(now);
    const samuel = requiredPerson("p-samuel-mercer");
    const profile = buildPersonProfile({
      ...samuel,
      notes: "Private imported profile"
    }, {
      ...workspace,
      sources: [{
        id: "src-fictional-nora-tin-journal",
        title: "User source with a colliding ID",
        sourceType: "Imported source",
        linkedPersonId: samuel.id,
        privacy: "private",
        confidence: 0.8,
        createdAt: now.toISOString()
      }]
    });

    expect(profile.isFictionalDemo).toBe(false);
    expect(profile.sources.some((source) => source.media)).toBe(false);
    expect(profile.notes.map((note) => note.title)).not.toContain("Open question");
    expect(profile.insights.map((insight) => insight.id)).not.toContain("samuel-directory-conflict");
    expect(profile.insights.find((insight) => insight.id === "research-priority")?.detail)
      .toMatch(/profile suggestion/);

    const html = renderToStaticMarkup(createElement(PersonProfileTabs, {
      personName: samuel.displayName,
      profile
    }));
    expect(html).toContain("recorded in the linked sources");
    expect(html).not.toContain("appear in the fictional records");
  });

  it("bounds source previews and the number serialized into the client tab", () => {
    const workspace = createDemoWorkspace(now);
    const samuel = requiredPerson("p-samuel-mercer");
    const sources = Array.from({ length: 30 }, (_, index) => ({
      id: `source-${index}`,
      title: `Source ${index}`,
      sourceType: "Record",
      linkedPersonId: samuel.id,
      transcript: "x".repeat(2_000),
      privacy: "private" as const,
      confidence: 0.8,
      createdAt: now.toISOString()
    }));
    const profile = buildPersonProfile(samuel, {
      ...workspace,
      cases: [],
      aiRuns: [],
      sources
    });

    expect(profile.sourceTotal).toBeGreaterThan(24);
    expect(profile.sources).toHaveLength(24);
    expect(profile.sources.every((source) => (source.summary?.length ?? 0) <= 520)).toBe(true);
  });
});

function requiredPerson(id: string) {
  const person = demoPeople.find((candidate) => candidate.id === id);
  if (!person) throw new Error(`Missing demo person ${id}`);
  return person;
}

function importedPerson(
  id: string,
  displayName: string,
  sex: PersonSummary["sex"],
  relatives: string[]
): PersonSummary {
  return {
    id,
    slug: displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    displayName,
    sex,
    livingStatus: "deceased",
    privacy: "private",
    published: false,
    facts: [],
    relatives,
    notes: "Private imported profile"
  };
}
