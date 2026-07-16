import { resolveHostedCapabilities } from "./hosted-capabilities";

type Environment = Record<string, string | undefined>;

const publicArchiveRoots = new Set(["/", "/family", "/people", "/places", "/stories", "/kinsleuth"]);
const publicArchivePrefixes = ["/family/", "/people/", "/places/", "/stories/", "/kinsleuth/"];

export const privateWorkspaceLoginPath = "/login?next=/app";

export function isPublicArchivePath(pathname: string): boolean {
  return publicArchiveRoots.has(pathname) || publicArchivePrefixes.some((prefix) => pathname.startsWith(prefix));
}

export function publicArchiveEnabled(environment: Environment = process.env): boolean {
  try {
    return resolveHostedCapabilities(environment).publicArchive;
  } catch {
    return false;
  }
}
