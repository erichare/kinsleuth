import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { resolveApiAccess, type ApiMethod } from "@/lib/api-access";

const dataSourceRoutes = [
  { method: "GET", path: "/api/integrations", file: "app/api/integrations/route.ts" },
  { method: "POST", path: "/api/integrations", file: "app/api/integrations/route.ts" },
  { method: "DELETE", path: "/api/integrations/source-1", file: "app/api/integrations/[id]/route.ts" },
  { method: "POST", path: "/api/integrations/source-1/artifacts", file: "app/api/integrations/[id]/artifacts/route.ts" },
  { method: "DELETE", path: "/api/integrations/source-1/artifacts", file: "app/api/integrations/[id]/artifacts/route.ts" },
  { method: "POST", path: "/api/integrations/source-1/sync-runs", file: "app/api/integrations/[id]/sync-runs/route.ts" },
  { method: "GET", path: "/api/integration-runs/run-1", file: "app/api/integration-runs/[id]/route.ts" },
  { method: "DELETE", path: "/api/integration-runs/run-1", file: "app/api/integration-runs/[id]/route.ts" },
  { method: "GET", path: "/api/integration-runs/run-1/changes", file: "app/api/integration-runs/[id]/changes/route.ts" },
  { method: "POST", path: "/api/integration-runs/run-1/apply", file: "app/api/integration-runs/[id]/apply/route.ts" },
  { method: "POST", path: "/api/integration-runs/run-1/rollback", file: "app/api/integration-runs/[id]/rollback/route.ts" }
] as const satisfies readonly { method: ApiMethod; path: string; file: string }[];

describe("Data Sources API access contract", () => {
  it.each(dataSourceRoutes)("registers $method $path as imports:manage", ({ method, path: routePath }) => {
    expect(resolveApiAccess(routePath, method)).toEqual({
      kind: "permission",
      permission: "imports:manage"
    });
  });

  it("wraps every Data Sources handler with imports:manage", async () => {
    for (const route of dataSourceRoutes) {
      const source = await readFile(path.join(process.cwd(), route.file), "utf8");

      expect(source, `${route.method} ${route.path}`).toContain(
        `export const ${route.method} = withPermission("imports:manage"`
      );
    }
  });
});
