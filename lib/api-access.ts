import type { Permission } from "./rbac";

export const apiMethods = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"] as const;

export type ApiMethod = (typeof apiMethods)[number];
export type ApiAccess =
  | { kind: "public" }
  | { kind: "bootstrap" }
  | { kind: "service" }
  | { kind: "permission"; permission: Permission };
export type ApiRequestPolicy =
  | "read-only"
  | "same-origin-cookie"
  | "better-auth-managed"
  | "service-bearer";

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
const register = (access: ApiAccess, requestPolicy: ApiRequestPolicy): ApiMethodRegistration => ({
  access,
  requestPolicy
});

export const apiRouteAccessRegistry: readonly ApiRouteAccess[] = [
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
    path: "/api/exports/gedcom",
    methods: { GET: register(permission("archive:export"), "read-only") }
  },
  { path: "/api/health", methods: { GET: register(publicAccess, "read-only") } },
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
