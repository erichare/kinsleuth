import Link from "next/link";

import { PersonMonogram } from "./ui";
import { buildFamilyTreeLayout, type FamilyTreeDefinition } from "@/lib/family-tree";
import type { PersonMiniTree } from "@/lib/person-mini-tree";

const horizontalPadding = 26;
const slotWidth = 88;
const minimumWidth = 560;

export function miniTreeLayoutWidth(tree: Pick<FamilyTreeDefinition, "columnCount">): number {
  return Math.max(minimumWidth, horizontalPadding * 2 + tree.columnCount * slotWidth);
}

// Compact hourglass tree for the person profile Relationships tab. It shares
// the layout core (lib/family-tree.ts) with the public archive's
// five-generation browser but stays deliberately smaller: no zoom controls,
// two generations up and one down, scrollable when it overflows.
export function PersonMiniTreeView({
  miniTree,
  personName
}: {
  miniTree: PersonMiniTree;
  personName: string;
}) {
  const layout = buildFamilyTreeLayout(miniTree.tree, {
    width: miniTreeLayoutWidth(miniTree.tree),
    horizontalPadding,
    topPadding: 44,
    bottomPadding: 26,
    nodeHeight: 96,
    rowPitch: 158
  });
  const peopleById = new Map(miniTree.people.map((person) => [person.id, person]));

  return (
    <section aria-labelledby="person-mini-tree-heading" className="person-mini-tree-section">
      <div className="person-mini-tree-heading">
        <span className="card-kicker">Immediate family</span>
        <h2 id="person-mini-tree-heading">Family tree around {personName}</h2>
        <p className="muted">
          Grandparents, parents, spouses, and children placed around this profile. Open any relative to continue there.
        </p>
      </div>

      <div
        aria-label={`Immediate family tree centered on ${personName}`}
        className="person-mini-tree-viewport"
        role="region"
        tabIndex={0}
      >
        <div className="person-mini-tree-canvas" style={{ width: layout.width, height: layout.height }}>
          {miniTree.tree.generations.map((generation) => {
            const firstNode = layout.nodes.find((node) => node.generationId === generation.id);
            if (!firstNode) return null;
            return (
              <span aria-hidden className="person-mini-tree-generation" key={generation.id} style={{ top: firstNode.y - 27 }}>
                {generation.label}
              </span>
            );
          })}

          <svg
            aria-hidden
            className="person-mini-tree-connectors"
            height={layout.height}
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            width={layout.width}
          >
            {layout.connectors.map((connector) => (
              <g data-family-unit={connector.familyId} key={connector.familyId}>
                <path className="person-mini-tree-partners" d={connector.partnerPath} />
                <path className="person-mini-tree-descendants" d={connector.descendantPath} />
              </g>
            ))}
          </svg>

          {layout.nodes.map((node) => {
            const person = peopleById.get(node.personId);
            if (!person) return null;
            const isFocus = person.id === miniTree.focusPersonId;
            return (
              <Link
                aria-current={isFocus ? "true" : undefined}
                aria-label={`Open ${person.displayName}, ${person.lifespan}`}
                className={isFocus ? "person-mini-tree-person person-mini-tree-focus" : "person-mini-tree-person"}
                data-mini-tree-person={person.id}
                href={`/app/people/${encodeURIComponent(person.id)}`}
                key={person.id}
                style={{
                  height: layout.nodeHeight,
                  left: node.x,
                  top: node.y,
                  width: layout.nodeWidth
                }}
              >
                <PersonMonogram name={person.displayName} variant="small" />
                <span>
                  <strong title={person.displayName}>{person.displayName}</strong>
                  <small>{person.lifespan}</small>
                </span>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
