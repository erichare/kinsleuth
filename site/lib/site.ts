export const site = {
  name: "Kin Resolve",
  compactName: "KinResolve",
  url: "https://kinresolve.com",
  description:
    "A private genealogy research workspace for source-backed cases, GEDCOM records, DNA match triage, AI-assisted analysis, and deliberate publishing.",
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
