import type { Permission } from "./rbac";

export const demoGuestCommandCapabilities = [
  "demo:guide",
  "demo:sample-import",
  "demo:ai",
  "demo:export",
  "demo:feedback",
  "demo:analytics",
  "demo:session-control"
] as const;

export type DemoGuestCommandCapability = (typeof demoGuestCommandCapabilities)[number];
export type DemoGuestCapability = Permission | DemoGuestCommandCapability;

const allowedDemoGuestCapabilities = new Set<DemoGuestCapability>([
  "archive:read-private",
  "cases:read",
  "dna:read",
  ...demoGuestCommandCapabilities
]);

export function demoGuestCan(capability: DemoGuestCapability): boolean {
  return allowedDemoGuestCapabilities.has(capability);
}

export function getDemoGuestCapabilities(): DemoGuestCapability[] {
  return [...allowedDemoGuestCapabilities];
}
