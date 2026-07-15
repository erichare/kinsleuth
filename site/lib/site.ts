import { betaStatus } from "@/lib/beta-status";

export const site = {
  name: "Kin Resolve",
  compactName: "KinResolve",
  url: "https://kinresolve.com",
  description: betaStatus.metadataDescription,
  github: "https://github.com/erichare/kinresolve",
  betaEmail: "beta@kinresolve.com",
  betaIntakeReady: true
} as const;

export const navigation = [
  { href: "/product", label: "Product" },
  { href: "/method", label: "Research method" },
  { href: "/privacy", label: "Privacy" },
  { href: "/open-source", label: "Open source" },
  { href: "/about", label: "About" }
] as const;
