import type { DnaConnectionHypothesis, DnaMatch, PersonSummary } from "./models";

export type DnaRelationshipRange = {
  label: string;
  minCm: number;
  maxCm: number;
  generationHint: string;
};

export const relationshipRanges: DnaRelationshipRange[] = [
  { label: "Parent/Child", minCm: 3300, maxCm: 3720, generationHint: "direct parent-child" },
  { label: "Sibling", minCm: 2200, maxCm: 3400, generationHint: "same generation" },
  { label: "1C", minCm: 553, maxCm: 1225, generationHint: "grandparent/great-grandparent generation" },
  { label: "2C", minCm: 46, maxCm: 515, generationHint: "great-grandparent generation" },
  { label: "2C1R", minCm: 14, maxCm: 353, generationHint: "great-grandparent or 2x great-grandparent generation" },
  { label: "3C", minCm: 0, maxCm: 234, generationHint: "2x great-grandparent generation" },
  { label: "4C", minCm: 0, maxCm: 139, generationHint: "3x great-grandparent generation" }
];

export function plausibleRelationships(totalCm: number): DnaRelationshipRange[] {
  return relationshipRanges.filter((range) => totalCm >= range.minCm && totalCm <= range.maxCm);
}

export function scoreDnaMatch(match: DnaMatch): number {
  let score = 0;

  score += Math.min(match.totalCm / 5, 35);
  if (match.treeStatus === "public") score += 25;
  if (match.treeStatus === "partial") score += 18;
  if (match.treeStatus === "private") score += 5;
  score += Math.min(match.surnames.length * 4, 16);
  score += Math.min(match.places.length * 3, 12);
  score += Math.min(match.sharedMatches.length * 2, 10);
  if (match.side !== "unknown") score += 8;
  if (match.notes.trim().length > 0) score += 4;

  return Math.round(Math.min(score, 100));
}

export function createDnaConnectionHypothesis(match: DnaMatch, people: PersonSummary[]): DnaConnectionHypothesis {
  const ranges = plausibleRelationships(match.totalCm);
  // When no range matches, the shared cM exceeded every range's ceiling, so
  // fall back to the closest relationship rather than the most distant one.
  const bestRange = ranges[0] ?? (match.totalCm > relationshipRanges[0].maxCm ? relationshipRanges[0] : relationshipRanges[relationshipRanges.length - 1]);
  const matchSurnames = new Set(match.surnames.map((surname) => surname.trim().toLowerCase()).filter(Boolean));
  const matchPlaces = match.places.map((place) => place.trim().toLowerCase()).filter(Boolean);
  const surnameHits = people.filter((person) => person.surname && matchSurnames.has(person.surname.trim().toLowerCase()));
  const placeHits = people.filter((person) =>
    matchPlaces.some((place) => [person.birthPlace, person.deathPlace].filter(Boolean).some((personPlace) => personPlace?.toLowerCase().includes(place)))
  );
  const candidates = unique([...surnameHits, ...placeHits])
    .slice(0, 5)
    .map((person) => person.displayName);
  const geography = [...new Set(match.places.concat(placeHits.flatMap((person) => [person.birthPlace, person.deathPlace].filter(Boolean) as string[])))].slice(0, 5);
  const confidence = Math.min(
    0.9,
    0.28 +
      (match.treeStatus === "public" ? 0.2 : match.treeStatus === "partial" ? 0.14 : 0) +
      Math.min(surnameHits.length * 0.04, 0.16) +
      Math.min(placeHits.length * 0.03, 0.12) +
      (match.side !== "unknown" ? 0.08 : 0) +
      Math.min(match.sharedMatches.length * 0.02, 0.12)
  );

  const branch = match.side === "unknown" ? "Unknown side; prioritize shared-match clustering" : `${capitalize(match.side)} branch`;

  return {
    matchId: match.id,
    likelyBranch: branch,
    likelyGeneration: bestRange.generationHint,
    geography,
    candidateCommonAncestors: candidates.length > 0 ? candidates : ["No candidate ancestor yet"],
    confidence: Number(confidence.toFixed(2)),
    evidence: [
      `${match.totalCm} cM fits ${ranges.map((range) => range.label).join(", ") || "distant cousin"} ranges`,
      `${match.treeStatus} match tree status`,
      `${match.sharedMatches.length} shared matches available`,
      match.side !== "unknown" ? `Ancestry side hint: ${match.side}` : "No side hint yet",
      `${surnameHits.length} surname overlaps and ${placeHits.length} place overlaps`
    ],
    uncertainty: [
      "DNA ranges overlap across several cousin relationships",
      "Ancestry shared matches do not expose segment triangulation",
      candidates.length === 0 ? "No direct candidate common ancestor identified yet" : "Candidate path still needs documentary proof"
    ],
    explanation: `Most likely connection is through the ${branch.toLowerCase()} around the ${bestRange.generationHint}, with geography centered on ${geography.join(" / ") || "unknown places"}.`
  };
}

function unique<T extends { id: string }>(values: T[]): T[] {
  return [...new Map(values.map((value) => [value.id, value])).values()];
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

