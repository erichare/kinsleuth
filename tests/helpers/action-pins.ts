/**
 * Single source of truth for the immutable GitHub Actions revisions that
 * workflow contract tests pin. Every workflow under .github/ must reference
 * these exact commit SHAs; bumping an action is a one-file edit here plus the
 * matching workflow updates in the same commit.
 */
export interface ActionPin {
  /** owner/repo slug of the action, e.g. "actions/checkout". */
  readonly action: string;
  /** Full 40-hex commit SHA the action is pinned to. */
  readonly sha: string;
  /** Human-readable release the SHA resolves to, recorded as a trailing comment. */
  readonly version: string;
}

export const ACTION_PINS = {
  checkout: {
    action: "actions/checkout",
    sha: "34e114876b0b11c390a56381ad16ebd13914f8d5",
    version: "v4"
  },
  setupNode: {
    action: "actions/setup-node",
    sha: "49933ea5288caeca8642d1e84afbd3f7d6820020",
    version: "v4"
  },
  uploadArtifact: {
    action: "actions/upload-artifact",
    sha: "ea165f8d65b6e75b540449e92b4886f43607fa02",
    version: "v4"
  },
  downloadArtifact: {
    action: "actions/download-artifact",
    sha: "d3f86a106a0bac45b974a628896c90dbdf5c8093",
    version: "v4"
  },
  attest: {
    action: "actions/attest",
    sha: "a1948c3f048ba23858d222213b7c278aabede763",
    version: "v4"
  }
} as const satisfies Record<string, ActionPin>;

export type ActionPinName = keyof typeof ACTION_PINS;

/** "actions/checkout@<sha>" — the exact pinned uses reference. */
export function pinnedAction(name: ActionPinName): string {
  const pin = ACTION_PINS[name];
  return `${pin.action}@${pin.sha}`;
}

/** "actions/checkout@<sha> # v4" — the pinned reference with its version comment. */
export function pinnedActionWithComment(name: ActionPinName): string {
  return `${pinnedAction(name)} # ${ACTION_PINS[name].version}`;
}
