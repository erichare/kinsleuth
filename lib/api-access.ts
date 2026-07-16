import type { Permission } from "./rbac";
import { apiV1RouteDefinitions, type ApiV1Scope } from "./api-v1-contract";
import type { DemoGuestCapability } from "./public-demo-capabilities";

export const apiMethods = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"] as const;

export type ApiMethod = (typeof apiMethods)[number];
export type ApiAccess =
  | { kind: "public" }
  | { kind: "bootstrap" }
  | { kind: "service" }
  | { kind: "api-token"; scope: ApiV1Scope }
  | { kind: "demo-session"; capability: DemoGuestCapability }
  | { kind: "permission"; permission: Permission };
export type ApiRequestPolicy =
  | "read-only"
  | "same-origin-cookie"
  | "better-auth-managed"
  | "internal-probe"
  | "service-bearer"
  | "api-token"
  | "marketing-native-form"
  | "operator-signature"
  | "release-fence-control";

export type ApiMethodRegistration = {
  access: ApiAccess;
  requestPolicy: ApiRequestPolicy;
};

export type ApiRouteAccess = {
  path: string;
  methods: Partial<Record<ApiMethod, ApiMethodRegistration>>;
  requiresAuthSecret?: boolean;
};

const publicAccess = { kind: "public" } as const;
const bootstrapAccess = { kind: "bootstrap" } as const;
const serviceAccess = { kind: "service" } as const;
const permission = (value: Permission): ApiAccess => ({ kind: "permission", permission: value });
const apiToken = (scope: ApiV1Scope): ApiAccess => ({ kind: "api-token", scope });
const demoSession = (capability: DemoGuestCapability): ApiAccess => ({ kind: "demo-session", capability });
const register = (access: ApiAccess, requestPolicy: ApiRequestPolicy): ApiMethodRegistration => ({
  access,
  requestPolicy
});

export const apiRouteAccessRegistry: readonly ApiRouteAccess[] = [
  ...apiV1RouteDefinitions.map(({ path, scope }) => ({
    path,
    methods: { GET: register(apiToken(scope), "api-token") }
  })),
  {
    path: "/api/ai/analyze",
    methods: { POST: register(permission("ai:whole-tree"), "same-origin-cookie") }
  },
  {
    path: "/api/auth/[...all]",
    methods: {
      GET: register(publicAccess, "better-auth-managed"),
      POST: register(publicAccess, "better-auth-managed")
    },
    requiresAuthSecret: true
  },
  { path: "/api/auth/logout", methods: { POST: register(publicAccess, "same-origin-cookie") } },
  {
    path: "/api/auth/security/revoke-sessions",
    methods: { POST: register(publicAccess, "same-origin-cookie") },
    requiresAuthSecret: true
  },
  {
    path: "/api/beta/email-verification/reissue",
    methods: { POST: register(publicAccess, "same-origin-cookie") }
  },
  {
    path: "/api/beta/email-verification/verify",
    methods: { POST: register(publicAccess, "same-origin-cookie") }
  },
  {
    path: "/api/beta/invitations/accept",
    methods: { POST: register(publicAccess, "same-origin-cookie") }
  },
  {
    path: "/api/beta/invitations/inspect",
    methods: { POST: register(publicAccess, "same-origin-cookie") }
  },
  {
    path: "/api/beta/legal/[document]",
    methods: { GET: register(publicAccess, "read-only") }
  },
  {
    path: "/api/public/beta-applications",
    methods: { POST: register(publicAccess, "marketing-native-form") }
  },
  {
    path: "/api/demo/sessions",
    methods: { POST: register(publicAccess, "same-origin-cookie") }
  },
  {
    path: "/api/demo/session",
    methods: { GET: register(demoSession("demo:session-control"), "read-only") }
  },
  {
    path: "/api/demo/session/reset",
    methods: { POST: register(demoSession("demo:session-control"), "same-origin-cookie") }
  },
  {
    path: "/api/demo/session/end",
    methods: { POST: register(demoSession("demo:session-control"), "same-origin-cookie") }
  },
  {
    path: "/api/demo/cases/[caseId]/guide",
    methods: { POST: register(demoSession("demo:guide"), "same-origin-cookie") }
  },
  {
    path: "/api/demo/sample-import",
    methods: { POST: register(demoSession("demo:sample-import"), "same-origin-cookie") }
  },
  {
    path: "/api/demo/ai",
    methods: { POST: register(demoSession("demo:ai"), "same-origin-cookie") }
  },
  {
    path: "/api/demo/feedback",
    methods: { POST: register(demoSession("demo:feedback"), "same-origin-cookie") }
  },
  {
    path: "/api/demo/events",
    methods: { POST: register(demoSession("demo:analytics"), "same-origin-cookie") }
  },
  {
    path: "/api/demo/exports/gedcom",
    methods: { GET: register(demoSession("demo:export"), "read-only") }
  },
  {
    path: "/api/demo/exports/research-archive",
    methods: { GET: register(demoSession("demo:export"), "read-only") }
  },
  {
    path: "/api/cases",
    methods: {
      GET: register(permission("cases:read"), "read-only"),
      POST: register(permission("cases:write"), "same-origin-cookie")
    }
  },
  {
    path: "/api/cases/[id]/evidence",
    methods: { POST: register(permission("evidence:write"), "same-origin-cookie") }
  },
  {
    path: "/api/cases/[id]/guide/assignments",
    methods: { POST: register(permission("cases:write"), "same-origin-cookie") }
  },
  {
    path: "/api/cases/[id]/hypotheses",
    methods: { POST: register(permission("cases:write"), "same-origin-cookie") }
  },
  {
    path: "/api/cases/[id]/hypotheses/[hypothesisId]",
    methods: { PATCH: register(permission("cases:write"), "same-origin-cookie") }
  },
  {
    path: "/api/cases/[id]/tasks",
    methods: { POST: register(permission("cases:write"), "same-origin-cookie") }
  },
  {
    path: "/api/cases/[id]/tasks/[taskId]",
    methods: { PATCH: register(permission("cases:write"), "same-origin-cookie") }
  },
  {
    path: "/api/cases/[id]/tasks/[taskId]/outcome",
    methods: { POST: register(permission("cases:write"), "same-origin-cookie") }
  },
  {
    path: "/api/cron/integration-jobs",
    methods: { GET: register(serviceAccess, "service-bearer") }
  },
  {
    path: "/api/cron/import-uploads",
    methods: { GET: register(serviceAccess, "service-bearer") }
  },
  {
    path: "/api/dna/[id]",
    methods: {
      PATCH: register(permission("dna:write"), "same-origin-cookie"),
      DELETE: register(permission("dna:write"), "same-origin-cookie")
    }
  },
  {
    path: "/api/dna/analyze",
    methods: { POST: register(permission("dna:write"), "same-origin-cookie") }
  },
  {
    path: "/api/dna/import",
    methods: { POST: register(permission("dna:write"), "same-origin-cookie") }
  },
  {
    path: "/api/dna/matches",
    methods: { GET: register(permission("dna:read"), "read-only") }
  },
  {
    path: "/api/data-operations/deletion-request",
    methods: { POST: register(permission("archive:data-portability"), "same-origin-cookie") }
  },
  {
    path: "/api/exports/gedcom",
    methods: { GET: register(permission("archive:export"), "read-only") }
  },
  {
    path: "/api/exports/research-archive",
    methods: { POST: register(permission("archive:data-portability"), "same-origin-cookie") }
  },
  { path: "/api/health", methods: { GET: register(publicAccess, "read-only") } },
  {
    path: "/api/internal/health",
    methods: { GET: register(serviceAccess, "internal-probe") }
  },
  {
    path: "/api/release/fence/acquire",
    methods: { POST: register(serviceAccess, "release-fence-control") }
  },
  {
    path: "/api/release/fence/assert",
    methods: { POST: register(serviceAccess, "release-fence-control") }
  },
  {
    path: "/api/release/fence/reacquire",
    methods: { POST: register(serviceAccess, "release-fence-control") }
  },
  {
    path: "/api/release/fence/release",
    methods: { POST: register(serviceAccess, "release-fence-control") }
  },
  {
    path: "/api/integration-runs/[id]",
    methods: {
      GET: register(permission("imports:manage"), "read-only"),
      DELETE: register(permission("imports:manage"), "same-origin-cookie")
    }
  },
  {
    path: "/api/integration-runs/[id]/apply",
    methods: { POST: register(permission("imports:manage"), "same-origin-cookie") }
  },
  {
    path: "/api/integration-runs/[id]/changes",
    methods: { GET: register(permission("imports:manage"), "read-only") }
  },
  {
    path: "/api/integration-runs/[id]/rollback",
    methods: { POST: register(permission("imports:manage"), "same-origin-cookie") }
  },
  {
    path: "/api/integration-media",
    methods: { GET: register(permission("imports:manage"), "read-only") }
  },
  {
    path: "/api/integration-media/[id]",
    methods: { PATCH: register(permission("imports:manage"), "same-origin-cookie") }
  },
  {
    path: "/api/integration-media/[id]/download",
    methods: { GET: register(permission("imports:manage"), "read-only") }
  },
  {
    path: "/api/integrations",
    methods: {
      GET: register(permission("imports:manage"), "read-only"),
      POST: register(permission("imports:manage"), "same-origin-cookie")
    }
  },
  {
    path: "/api/integrations/[id]",
    methods: { DELETE: register(permission("imports:manage"), "same-origin-cookie") }
  },
  {
    path: "/api/integrations/[id]/artifacts",
    methods: {
      POST: register(permission("imports:manage"), "same-origin-cookie"),
      DELETE: register(permission("imports:manage"), "same-origin-cookie")
    }
  },
  {
    path: "/api/integrations/[id]/artifacts/[artifactId]/download",
    methods: { GET: register(permission("imports:manage"), "read-only") }
  },
  {
    path: "/api/integrations/[id]/artifacts/complete",
    methods: { POST: register(permission("imports:manage"), "same-origin-cookie") }
  },
  {
    path: "/api/integrations/[id]/artifacts/stage",
    methods: { POST: register(permission("imports:manage"), "same-origin-cookie") }
  },
  {
    path: "/api/integrations/[id]/sync-runs",
    methods: {
      GET: register(permission("imports:manage"), "read-only"),
      POST: register(permission("imports:manage"), "same-origin-cookie")
    }
  },
  {
    path: "/api/imports",
    methods: { POST: register(permission("imports:manage"), "same-origin-cookie") }
  },
  {
    path: "/api/imports/relationships",
    methods: { POST: register(permission("imports:manage"), "same-origin-cookie") }
  },
  {
    path: "/api/imports/uploads",
    methods: {
      GET: register(permission("imports:manage"), "read-only"),
      POST: register(permission("imports:manage"), "same-origin-cookie"),
      DELETE: register(permission("imports:manage"), "same-origin-cookie")
    }
  },
  {
    path: "/api/operator/invitations",
    methods: { POST: register(serviceAccess, "operator-signature") }
  },
  {
    path: "/api/operator/observability",
    methods: { POST: register(serviceAccess, "operator-signature") }
  },
  {
    path: "/api/observability/client-errors",
    methods: { POST: register(permission("archive:read-private"), "same-origin-cookie") }
  },
  {
    path: "/api/people",
    methods: { GET: register(permission("archive:read-private"), "read-only") }
  },
  {
    path: "/api/people/[id]/curation",
    methods: { PATCH: register(permission("archive:publish"), "same-origin-cookie") }
  },
  {
    path: "/api/publishing/readiness",
    methods: { GET: register(permission("archive:read-private"), "read-only") }
  },
  {
    path: "/api/reports/quality",
    methods: { GET: register(permission("archive:read-private"), "read-only") }
  },
  {
    path: "/api/settings/archive",
    methods: { PATCH: register(permission("settings:manage"), "same-origin-cookie") }
  },
  {
    path: "/api/settings/api-tokens",
    methods: {
      GET: register(permission("api-tokens:manage"), "read-only"),
      POST: register(permission("api-tokens:manage"), "same-origin-cookie")
    }
  },
  {
    path: "/api/settings/api-tokens/[id]",
    methods: { DELETE: register(permission("api-tokens:manage"), "same-origin-cookie") }
  },
  {
    path: "/api/setup/claim",
    methods: { POST: register(bootstrapAccess, "same-origin-cookie") },
    requiresAuthSecret: true
  },
  {
    path: "/api/sources",
    methods: { GET: register(permission("archive:read-private"), "read-only") }
  },
  {
    path: "/api/uploads",
    methods: {
      GET: register(permission("archive:read-private"), "read-only"),
      POST: register(permission("sources:write"), "same-origin-cookie")
    }
  }
];

export function resolveApiAccess(pathname: string, method: string): ApiAccess | null {
  return resolveApiMethodRegistration(pathname, method)?.access ?? null;
}

export function resolveApiMethodPolicy(pathname: string, method: string): ApiRequestPolicy | null {
  return resolveApiMethodRegistration(pathname, method)?.requestPolicy ?? null;
}

export function isApiWriteBlockedByReleaseFence(pathname: string, method: string): boolean {
  const registration = resolveApiMethodRegistration(pathname, method);
  if (!registration) return false;
  if (
    registration.requestPolicy === "read-only"
    || registration.requestPolicy === "api-token"
    || registration.requestPolicy === "release-fence-control"
  ) {
    return false;
  }
  // Service-bearer handlers authenticate before checking the fence so an
  // unsigned request cannot discover release-control state.
  if (
    registration.requestPolicy === "internal-probe"
    || registration.requestPolicy === "service-bearer"
    || registration.requestPolicy === "operator-signature"
  ) {
    return false;
  }
  if (registration.requestPolicy === "better-auth-managed") {
    return method.toUpperCase() !== "GET";
  }
  return true;
}

function resolveApiMethodRegistration(pathname: string, method: string): ApiMethodRegistration | null {
  const normalizedMethod = method.toUpperCase();
  if (!apiMethods.includes(normalizedMethod as ApiMethod)) return null;

  const entry = resolveApiRoute(pathname);
  if (!entry) return null;

  const directRegistration = entry.methods[normalizedMethod as ApiMethod];
  if (directRegistration) return directRegistration;

  if (normalizedMethod !== "HEAD") return null;
  const getRegistration = entry.methods.GET;
  return getRegistration?.requestPolicy === "read-only" ? getRegistration : null;
}

export function resolveApiRoute(pathname: string): ApiRouteAccess | null {
  return apiRouteAccessRegistry
    .filter((candidate) => routeMatches(candidate.path, pathname))
    .sort(compareRouteSpecificity)[0] ?? null;
}

export function allowedApiMethods(route: ApiRouteAccess): ApiMethod[] {
  const allowed = new Set(Object.keys(route.methods) as ApiMethod[]);
  if (route.methods.GET?.requestPolicy === "read-only") allowed.add("HEAD");
  return apiMethods.filter((method) => allowed.has(method));
}

function compareRouteSpecificity(left: ApiRouteAccess, right: ApiRouteAccess): number {
  const leftSegments = segments(left.path);
  const rightSegments = segments(right.path);
  const segmentCount = Math.max(leftSegments.length, rightSegments.length);

  for (let index = 0; index < segmentCount; index += 1) {
    const difference = segmentSpecificity(rightSegments[index]) - segmentSpecificity(leftSegments[index]);
    if (difference !== 0) return difference;
  }

  return left.path.localeCompare(right.path);
}

function segmentSpecificity(segment: string | undefined): number {
  if (segment === undefined) return 0;
  if (/^\[\.\.\.[^\]]+\]$/.test(segment)) return 1;
  if (/^\[[^\]]+\]$/.test(segment)) return 2;
  return 3;
}

function routeMatches(template: string, pathname: string): boolean {
  const templateSegments = segments(template);
  const pathSegments = segments(pathname);

  for (let index = 0; index < templateSegments.length; index += 1) {
    const expected = templateSegments[index];
    const actual = pathSegments[index];

    if (/^\[\.\.\.[^\]]+\]$/.test(expected)) {
      return index < pathSegments.length;
    }
    if (actual === undefined) return false;
    if (/^\[[^\]]+\]$/.test(expected)) continue;
    if (expected !== actual) return false;
  }

  return templateSegments.length === pathSegments.length;
}

function segments(value: string): string[] {
  return value.split("/").filter(Boolean);
}
