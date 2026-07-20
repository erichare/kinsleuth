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
    sha: "3d3c42e5aac5ba805825da76410c181273ba90b1",
    version: "v7.0.1"
  },
  setupNode: {
    action: "actions/setup-node",
    sha: "820762786026740c76f36085b0efc47a31fe5020",
    version: "v7.0.0"
  },
  uploadArtifact: {
    action: "actions/upload-artifact",
    sha: "043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
    version: "v7.0.1"
  },
  downloadArtifact: {
    action: "actions/download-artifact",
    sha: "3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
    version: "v8.0.1"
  },
  attest: {
    action: "actions/attest",
    sha: "f7c74d28b9d84cb8768d0b8ca14a4bac6ef463e6",
    version: "v4.2.0"
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
