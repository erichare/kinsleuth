export type FamilyTreeMemberPlacement = {
  personId: string;
  column: number;
};

export type FamilyTreeGeneration = {
  id: string;
  label: string;
  members: readonly FamilyTreeMemberPlacement[];
};

export type FamilyUnit = {
  id: string;
  partnerIds: readonly [string, string];
  childIds: readonly string[];
};

export type FamilyTreeDefinition = {
  columnCount: number;
  nodeColumnSpan: number;
  generations: readonly FamilyTreeGeneration[];
  families: readonly FamilyUnit[];
};

export type FamilyTreeLayoutNode = FamilyTreeMemberPlacement & {
  generationId: string;
  generationLabel: string;
  generationIndex: number;
  x: number;
  y: number;
};

export type FamilyTreeConnector = {
  familyId: string;
  partnerPath: string;
  descendantPath: string;
};

export type FamilyTreeLayout = {
  width: number;
  height: number;
  nodeWidth: number;
  nodeHeight: number;
  nodes: FamilyTreeLayoutNode[];
  connectors: FamilyTreeConnector[];
};

type FamilyTreeLayoutOptions = {
  width?: number;
  horizontalPadding?: number;
  topPadding?: number;
  bottomPadding?: number;
  nodeWidth?: number;
  nodeHeight?: number;
  rowPitch?: number;
};

const defaultLayout = {
  width: 1280,
  horizontalPadding: 32,
  topPadding: 48,
  bottomPadding: 32,
  nodeWidth: 138,
  nodeHeight: 104,
  rowPitch: 176
} as const;

export function buildFamilyTreeLayout(
  tree: FamilyTreeDefinition,
  options: FamilyTreeLayoutOptions = {}
): FamilyTreeLayout {
  const settings: Required<FamilyTreeLayoutOptions> = {
    width: options.width ?? defaultLayout.width,
    horizontalPadding: options.horizontalPadding ?? defaultLayout.horizontalPadding,
    topPadding: options.topPadding ?? defaultLayout.topPadding,
    bottomPadding: options.bottomPadding ?? defaultLayout.bottomPadding,
    nodeWidth: options.nodeWidth ?? defaultLayout.nodeWidth,
    nodeHeight: options.nodeHeight ?? defaultLayout.nodeHeight,
    rowPitch: options.rowPitch ?? defaultLayout.rowPitch
  };
  validateDimensions(tree, settings);

  const slotWidth = (settings.width - settings.horizontalPadding * 2) / tree.columnCount;
  const nodes = tree.generations.flatMap((generation, generationIndex) =>
    generation.members.map((member) => ({
      ...member,
      generationId: generation.id,
      generationLabel: generation.label,
      generationIndex,
      x:
        settings.horizontalPadding
        + member.column * slotWidth
        + (tree.nodeColumnSpan * slotWidth - settings.nodeWidth) / 2,
      y: settings.topPadding + generationIndex * settings.rowPitch
    }))
  );
  const nodeByPersonId = new Map(nodes.map((node) => [node.personId, node]));
  if (nodeByPersonId.size !== nodes.length) {
    throw new Error("A family tree person can appear in only one generation.");
  }

  const connectors = tree.families.map((family) => {
    const firstPartner = requiredNode(nodeByPersonId, family.partnerIds[0], family.id);
    const secondPartner = requiredNode(nodeByPersonId, family.partnerIds[1], family.id);
    if (firstPartner.generationIndex !== secondPartner.generationIndex) {
      throw new Error(`Family ${family.id} places partners in different generations.`);
    }
    if (family.childIds.length === 0 || new Set(family.childIds).size !== family.childIds.length) {
      throw new Error(`Family ${family.id} must contain unique children.`);
    }

    const children = family.childIds.map((childId) => requiredNode(nodeByPersonId, childId, family.id));
    if (children.some((child) => child.generationIndex !== firstPartner.generationIndex + 1)) {
      throw new Error(`Family ${family.id} must place children in the next generation.`);
    }

    const [leftPartner, rightPartner] = [firstPartner, secondPartner].sort((a, b) => a.x - b.x);
    const partnerY = leftPartner.y + settings.nodeHeight / 2;
    const unionX = (centerX(leftPartner, settings.nodeWidth) + centerX(rightPartner, settings.nodeWidth)) / 2;
    const childTop = Math.min(...children.map((child) => child.y));
    const railY = (leftPartner.y + settings.nodeHeight + childTop) / 2;
    const childCenters = children.map((child) => centerX(child, settings.nodeWidth));
    const railStart = Math.min(unionX, ...childCenters);
    const railEnd = Math.max(unionX, ...childCenters);

    return {
      familyId: family.id,
      partnerPath: `M ${right(leftPartner, settings.nodeWidth)} ${partnerY} H ${rightPartner.x}`,
      descendantPath: [
        `M ${unionX} ${partnerY} V ${railY}`,
        `M ${railStart} ${railY} H ${railEnd}`,
        ...children.map((child) => `M ${centerX(child, settings.nodeWidth)} ${railY} V ${child.y}`)
      ].join(" ")
    };
  });

  return {
    width: settings.width,
    height:
      settings.topPadding
      + Math.max(0, tree.generations.length - 1) * settings.rowPitch
      + settings.nodeHeight
      + settings.bottomPadding,
    nodeWidth: settings.nodeWidth,
    nodeHeight: settings.nodeHeight,
    nodes,
    connectors
  };
}

function validateDimensions(
  tree: FamilyTreeDefinition,
  settings: Required<FamilyTreeLayoutOptions>
): void {
  if (!Number.isSafeInteger(tree.columnCount) || tree.columnCount < 2) {
    throw new Error("A family tree requires at least two layout columns.");
  }
  if (
    !Number.isSafeInteger(tree.nodeColumnSpan)
    || tree.nodeColumnSpan < 1
    || tree.nodeColumnSpan > tree.columnCount
  ) {
    throw new Error("The family tree node column span is invalid.");
  }
  if (tree.generations.length === 0) {
    throw new Error("A family tree requires at least one generation.");
  }
  if (settings.width <= settings.horizontalPadding * 2 || settings.rowPitch <= settings.nodeHeight) {
    throw new Error("The family tree layout dimensions are invalid.");
  }

  for (const generation of tree.generations) {
    for (const member of generation.members) {
      if (
        !Number.isSafeInteger(member.column)
        || member.column < 0
        || member.column + tree.nodeColumnSpan > tree.columnCount
      ) {
        throw new Error(`Family tree placement for ${member.personId} is outside the canvas.`);
      }
    }
  }
}

function requiredNode(
  nodes: Map<string, FamilyTreeLayoutNode>,
  personId: string,
  familyId: string
): FamilyTreeLayoutNode {
  const node = nodes.get(personId);
  if (!node) {
    throw new Error(`Family ${familyId} references missing person ${personId}.`);
  }
  return node;
}

function centerX(node: FamilyTreeLayoutNode, nodeWidth: number): number {
  return node.x + nodeWidth / 2;
}

function right(node: FamilyTreeLayoutNode, nodeWidth: number): number {
  return node.x + nodeWidth;
}
