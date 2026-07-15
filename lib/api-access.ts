import type { Permission } from "./rbac";

export const apiMethods = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"] as const;

export type ApiMethod = (typeof apiMethods)[number];
export type ApiAccess =
  | { kind: "public" }
  | { kind: "bootstrap" }
  | { kind: "service" }
  | { kind: "permission"; permission: Permission };

export type ApiRouteAccess = {
  path: string;
  methods: Partial<Record<ApiMethod, ApiAccess>>;
  requiresAuthSecret?: boolean;
};

const publicAccess = { kind: "public" } as const;
const bootstrapAccess = { kind: "bootstrap" } as const;
const serviceAccess = { kind: "service" } as const;
const permission = (value: Permission): ApiAccess => ({ kind: "permission", permission: value });

export const apiRouteAccessRegistry: readonly ApiRouteAccess[] = [
  { path: "/api/ai/analyze", methods: { POST: permission("ai:whole-tree") } },
  {
    path: "/api/auth/[...all]",
    methods: { GET: publicAccess, POST: publicAccess },
    requiresAuthSecret: true
  },
  { path: "/api/auth/logout", methods: { POST: publicAccess } },
  { path: "/api/cases", methods: { GET: permission("cases:read"), POST: permission("cases:write") } },
  { path: "/api/cases/[id]/evidence", methods: { POST: permission("evidence:write") } },
  { path: "/api/cases/[id]/guide/assignments", methods: { POST: permission("cases:write") } },
  { path: "/api/cases/[id]/hypotheses", methods: { POST: permission("cases:write") } },
  {
    path: "/api/cases/[id]/hypotheses/[hypothesisId]",
    methods: { PATCH: permission("cases:write") }
  },
  { path: "/api/cases/[id]/tasks", methods: { POST: permission("cases:write") } },
  { path: "/api/cases/[id]/tasks/[taskId]", methods: { PATCH: permission("cases:write") } },
  {
    path: "/api/cases/[id]/tasks/[taskId]/outcome",
    methods: { POST: permission("cases:write") }
  },
  { path: "/api/cron/integration-jobs", methods: { GET: serviceAccess } },
  { path: "/api/cron/import-uploads", methods: { GET: serviceAccess } },
  {
    path: "/api/dna/[id]",
    methods: { PATCH: permission("dna:write"), DELETE: permission("dna:write") }
  },
  { path: "/api/dna/analyze", methods: { POST: permission("dna:write") } },
  { path: "/api/dna/import", methods: { POST: permission("dna:write") } },
  { path: "/api/dna/matches", methods: { GET: permission("dna:read") } },
  { path: "/api/exports/gedcom", methods: { GET: permission("archive:export") } },
  { path: "/api/health", methods: { GET: publicAccess } },
  {
    path: "/api/integration-runs/[id]",
    methods: { GET: permission("imports:manage"), DELETE: permission("imports:manage") }
  },
  {
    path: "/api/integration-runs/[id]/apply",
    methods: { POST: permission("imports:manage") }
  },
  {
    path: "/api/integration-runs/[id]/changes",
    methods: { GET: permission("imports:manage") }
  },
  {
    path: "/api/integration-runs/[id]/rollback",
    methods: { POST: permission("imports:manage") }
  },
  {
    path: "/api/integration-media",
    methods: { GET: permission("imports:manage") }
  },
  {
    path: "/api/integration-media/[id]",
    methods: { PATCH: permission("imports:manage") }
  },
  {
    path: "/api/integration-media/[id]/download",
    methods: { GET: permission("imports:manage") }
  },
  {
    path: "/api/integrations",
    methods: { GET: permission("imports:manage"), POST: permission("imports:manage") }
  },
  {
    path: "/api/integrations/[id]",
    methods: { DELETE: permission("imports:manage") }
  },
  {
    path: "/api/integrations/[id]/artifacts",
    methods: { POST: permission("imports:manage"), DELETE: permission("imports:manage") }
  },
  {
    path: "/api/integrations/[id]/artifacts/[artifactId]/download",
    methods: { GET: permission("imports:manage") }
  },
  {
    path: "/api/integrations/[id]/artifacts/complete",
    methods: { POST: permission("imports:manage") }
  },
  {
    path: "/api/integrations/[id]/artifacts/stage",
    methods: { POST: permission("imports:manage") }
  },
  {
    path: "/api/integrations/[id]/sync-runs",
    methods: { GET: permission("imports:manage"), POST: permission("imports:manage") }
  },
  { path: "/api/imports", methods: { POST: permission("imports:manage") } },
  { path: "/api/imports/relationships", methods: { POST: permission("imports:manage") } },
  {
    path: "/api/imports/uploads",
    methods: {
      GET: permission("imports:manage"),
      POST: permission("imports:manage"),
      DELETE: permission("imports:manage")
    }
  },
  { path: "/api/people", methods: { GET: permission("archive:read-private") } },
  { path: "/api/people/[id]/curation", methods: { PATCH: permission("archive:publish") } },
  { path: "/api/publishing/readiness", methods: { GET: permission("archive:read-private") } },
  { path: "/api/reports/quality", methods: { GET: permission("archive:read-private") } },
  { path: "/api/settings/archive", methods: { PATCH: permission("settings:manage") } },
  { path: "/api/setup/claim", methods: { POST: bootstrapAccess }, requiresAuthSecret: true },
  { path: "/api/sources", methods: { GET: permission("archive:read-private") } },
  {
    path: "/api/uploads",
    methods: { GET: permission("archive:read-private"), POST: permission("sources:write") }
  }
];

export function resolveApiAccess(pathname: string, method: string): ApiAccess | null {
  const normalizedMethod = method.toUpperCase();
  if (!apiMethods.includes(normalizedMethod as ApiMethod)) return null;
  const registryMethod = normalizedMethod === "HEAD" ? "GET" : normalizedMethod;

  const entry = resolveApiRoute(pathname);
  return entry?.methods[registryMethod as ApiMethod] ?? null;
}

export function resolveApiRoute(pathname: string): ApiRouteAccess | null {
  return apiRouteAccessRegistry
    .filter((candidate) => routeMatches(candidate.path, pathname))
    .sort(compareRouteSpecificity)[0] ?? null;
}

export function allowedApiMethods(route: ApiRouteAccess): ApiMethod[] {
  const allowed = new Set(Object.keys(route.methods) as ApiMethod[]);
  if (allowed.has("GET")) allowed.add("HEAD");
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
