import type { FamilyTreeDefinition } from "./family-tree";

export const demoFamilyTree = {
  columnCount: 16,
  nodeColumnSpan: 2,
  generations: [
    {
      id: "great-grandparents",
      label: "Great-grandparents",
      members: [
        { personId: "p-orson-hartwell", column: 0 },
        { personId: "p-lydia-thorne", column: 2 },
        { personId: "p-luca-bellandi", column: 4 },
        { personId: "p-mira-solari", column: 6 },
        { personId: "p-micah-mercer", column: 8 },
        { personId: "p-eliza-fenwick", column: 10 },
        { personId: "p-declan-rowan", column: 12 },
        { personId: "p-eileen-pike", column: 14 }
      ]
    },
    {
      id: "grandparents",
      label: "Grandparents",
      members: [
        { personId: "p-elias-hartwell", column: 1 },
        { personId: "p-amalia-bellandi", column: 5 },
        { personId: "p-jonah-mercer", column: 9 },
        { personId: "p-maeve-mercer", column: 13 }
      ]
    },
    {
      id: "parents",
      label: "Parents",
      members: [
        { personId: "p-nora-hartwell", column: 3 },
        { personId: "p-samuel-mercer", column: 11 }
      ]
    },
    {
      id: "children",
      label: "Children",
      members: [
        { personId: "p-clara-mercer", column: 6 },
        { personId: "p-tobias-mercer", column: 8 }
      ]
    }
  ],
  families: [
    {
      id: "family-orson-lydia",
      partnerIds: ["p-orson-hartwell", "p-lydia-thorne"],
      childIds: ["p-elias-hartwell"]
    },
    {
      id: "family-luca-mira",
      partnerIds: ["p-luca-bellandi", "p-mira-solari"],
      childIds: ["p-amalia-bellandi"]
    },
    {
      id: "family-micah-eliza",
      partnerIds: ["p-micah-mercer", "p-eliza-fenwick"],
      childIds: ["p-jonah-mercer"]
    },
    {
      id: "family-declan-eileen",
      partnerIds: ["p-declan-rowan", "p-eileen-pike"],
      childIds: ["p-maeve-mercer"]
    },
    {
      id: "family-elias-amalia",
      partnerIds: ["p-elias-hartwell", "p-amalia-bellandi"],
      childIds: ["p-nora-hartwell"]
    },
    {
      id: "family-jonah-maeve",
      partnerIds: ["p-jonah-mercer", "p-maeve-mercer"],
      childIds: ["p-samuel-mercer"]
    },
    {
      id: "family-nora-samuel",
      partnerIds: ["p-nora-hartwell", "p-samuel-mercer"],
      childIds: ["p-clara-mercer", "p-tobias-mercer"]
    }
  ]
} as const satisfies FamilyTreeDefinition;
