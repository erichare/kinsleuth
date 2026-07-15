import type { SyncChangeClassification, SyncProposedAction } from "./types";

export type RefreshHashState = {
  baseHash: string | null;
  localHash: string | null;
  incomingHash: string | null;
};

export type RefreshClassification = {
  classification: SyncChangeClassification;
  proposedAction: SyncProposedAction;
};

export function classifyRefreshChange(state: RefreshHashState): RefreshClassification {
  const { baseHash, localHash, incomingHash } = state;

  if (baseHash !== null && incomingHash === null) {
    return { classification: "deletion", proposedAction: "keep_local" };
  }
  if (localHash === incomingHash) {
    return { classification: "same", proposedAction: "no_op" };
  }
  if (localHash === baseHash) {
    return { classification: "remote_only", proposedAction: "accept_incoming" };
  }
  if (incomingHash === baseHash) {
    return { classification: "local_only", proposedAction: "keep_local" };
  }
  return { classification: "conflict", proposedAction: "review" };
}
