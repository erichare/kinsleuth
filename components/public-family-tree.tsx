"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Icons } from "./icons";
import { PersonMonogram } from "./ui";
import { buildFamilyTreeLayout, type FamilyTreeDefinition } from "@/lib/family-tree";
import type { PublicFamilyPerson } from "@/lib/public-family";

const minimumScale = 0.9;
const maximumScale = 1.3;
const zoomStep = 0.1;
const viewportPadding = 28;

export function calculateTreeResetScale(viewportWidth: number, layoutWidth: number): number {
  return clamp((viewportWidth - viewportPadding) / layoutWidth, minimumScale, 1);
}

export function PublicFamilyTree({
  people,
  tree
}: {
  people: PublicFamilyPerson[];
  tree: FamilyTreeDefinition;
}) {
  const layout = useMemo(() => buildFamilyTreeLayout(tree), [tree]);
  const peopleById = useMemo(() => new Map(people.map((person) => [person.id, person])), [people]);
  const viewportRef = useRef<HTMLDivElement>(null);
  const resetFrameRef = useRef<number | null>(null);
  const [scale, setScale] = useState(minimumScale);

  const resetView = useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    setScale(calculateTreeResetScale(viewport.clientWidth, layout.width));
    if (resetFrameRef.current !== null) cancelAnimationFrame(resetFrameRef.current);
    resetFrameRef.current = requestAnimationFrame(() => {
      viewport.scrollTo({ left: 0, top: 0 });
      resetFrameRef.current = null;
    });
  }, [layout.width]);

  useEffect(() => {
    resetView();
    return () => {
      if (resetFrameRef.current !== null) cancelAnimationFrame(resetFrameRef.current);
    };
  }, [resetView]);

  const changeScale = useCallback((delta: number) => {
    setScale((current) => clamp(current + delta, minimumScale, maximumScale));
  }, []);

  const scalePercent = Math.round(scale * 100);
  const stageStyle = {
    width: layout.width * scale,
    height: layout.height * scale
  };
  const canvasStyle = {
    width: layout.width,
    height: layout.height,
    transform: `scale(${scale})`
  };

  return (
    <section aria-labelledby="public-family-tree-heading" className="section public-family-section public-family-tree-section">
      <div className="section-heading heading-row public-family-tree-heading">
        <div>
          <span className="card-kicker">Four connected generations</span>
          <h2 id="public-family-tree-heading">Complete family tree</h2>
          <p>Follow each branch from the great-grandparents to Clara and Tobias. Every profile in the archive appears below.</p>
        </div>
        <div aria-label="Family tree view controls" className="public-family-tree-controls" role="group">
          <button
            aria-label="Zoom out"
            disabled={scale <= minimumScale}
            onClick={() => changeScale(-zoomStep)}
            type="button"
          >
            <Icons.Minus aria-hidden size={16} />
          </button>
          <output aria-live="polite" aria-label={`Family tree zoom ${scalePercent}%`}>{scalePercent}%</output>
          <button
            aria-label="Zoom in"
            disabled={scale >= maximumScale}
            onClick={() => changeScale(zoomStep)}
            type="button"
          >
            <Icons.Plus aria-hidden size={16} />
          </button>
          <button aria-label="Reset family tree view" className="public-family-tree-fit" onClick={resetView} type="button">
            <Icons.Maximize2 aria-hidden size={15} />
            Reset view
          </button>
        </div>
      </div>

      <div
        aria-label={`Complete Hartwell–Mercer family tree with ${people.length} fictional people across ${tree.generations.length} generations`}
        className="public-family-tree-viewport"
        data-public-family-tree
        ref={viewportRef}
        role="region"
        tabIndex={0}
      >
        <div className="public-family-tree-stage" style={stageStyle}>
          <div className="public-family-tree-canvas" style={canvasStyle}>
            {tree.generations.map((generation, index) => {
              const firstNode = layout.nodes.find((node) => node.generationId === generation.id);
              if (!firstNode) return null;
              return (
                <span
                  aria-hidden
                  className="public-family-tree-generation"
                  key={generation.id}
                  style={{ top: firstNode.y - 31 }}
                >
                  {String(index + 1).padStart(2, "0")} · {generation.label}
                </span>
              );
            })}

            <svg
              aria-hidden
              className="public-family-tree-connectors"
              height={layout.height}
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              width={layout.width}
            >
              {layout.connectors.map((connector) => (
                <g data-family-unit={connector.familyId} key={connector.familyId}>
                  <path className="public-family-tree-partners" d={connector.partnerPath} />
                  <path className="public-family-tree-descendants" d={connector.descendantPath} />
                </g>
              ))}
            </svg>

            {layout.nodes.map((node) => {
              const person = peopleById.get(node.personId);
              if (!person) return null;
              return (
                <Link
                  aria-label={`Open ${person.displayName}, ${lifeSpan(person)}`}
                  className="public-family-tree-person"
                  data-tree-person={person.id}
                  href={`/people/${person.slug}`}
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
                    <strong title={person.displayName}>{compactName(person.displayName)}</strong>
                    <small>{lifeSpan(person)}</small>
                    <small>{shortPlace(person.birthPlace)}</small>
                  </span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      <p className="public-family-tree-instruction">
        Reset view returns to a readable overview. On smaller screens, swipe or use Shift + mouse wheel to move across the full tree.
      </p>
      <ol className="sr-only">
        {tree.families.map((family) => {
          const firstPartner = peopleById.get(family.partnerIds[0]);
          const secondPartner = peopleById.get(family.partnerIds[1]);
          const children = family.childIds.map((id) => peopleById.get(id)?.displayName).filter(Boolean);
          if (!firstPartner || !secondPartner || children.length === 0) return null;
          return (
            <li key={family.id}>
              {firstPartner.displayName} and {secondPartner.displayName}; children: {children.join(", ")}.
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function lifeSpan(person: Pick<PublicFamilyPerson, "birthDate" | "deathDate">): string {
  return `${year(person.birthDate)}–${year(person.deathDate)}`;
}

function compactName(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 3) return displayName;
  return `${parts[0]} ${parts.at(-1)}`;
}

function year(date?: string): string {
  return date?.match(/\b\d{4}\b/)?.[0] ?? "?";
}

function shortPlace(place?: string): string {
  if (!place) return "Place unknown";
  const [locality, region] = place.split(",").map((part) => part.trim());
  return region ? `${locality}, ${region}` : locality;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
