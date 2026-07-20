import { betaApplicationMode } from "@/lib/beta-application-mode";
import { betaStatus } from "@/lib/beta-status";

const sourceCommit = process.env.NEXT_PUBLIC_KINRESOLVE_SOURCE_COMMIT_SHA;
if (!sourceCommit || !/^[a-f0-9]{40}$/.test(sourceCommit)) {
  throw new Error("NEXT_PUBLIC_KINRESOLVE_SOURCE_COMMIT_SHA must be one full lowercase Git SHA.");
}

const github = "https://github.com/erichare/kinresolve";

export const site = {
  name: "Kin Resolve",
  compactName: "KinResolve",
  url: "https://kinresolve.com",
  demoUrl: "https://demo.kinresolve.com",
  description: betaStatus.metadataDescription,
  github,
  sourceCommit,
  sourceUrl: `${github}/tree/${sourceCommit}`,
  betaEmail: "beta@kinresolve.com",
  betaApplicationMode
} as const;

export const navigation = [
  { href: "/product", label: "Product" },
  { href: "/method", label: "Method" },
  { href: "/pricing", label: "Pricing" },
  { href: "/developers", label: "Developers" },
  { href: "/open-source", label: "Open source" },
  { href: "/roadmap", label: "Roadmap" },
  { href: "/about", label: "About" },
  { href: "/privacy", label: "Privacy" }
] as const;
