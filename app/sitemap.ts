import type { MetadataRoute } from "next";

import { demoPeople } from "@/lib/demo-data";
import { publicDemoEnabled, resolvePublicDemoConfiguration } from "@/lib/public-demo-config";

export default function sitemap(): MetadataRoute.Sitemap {
  if (!publicDemoEnabled()) return [];
  const origin = resolvePublicDemoConfiguration().origin;
  if (!origin) return [];

  return [
    { url: `${origin}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${origin}/family`, changeFrequency: "weekly", priority: 0.9 },
    { url: `${origin}/people`, changeFrequency: "weekly", priority: 0.8 },
    ...demoPeople.map((person) => ({
      url: `${origin}/people/${person.slug}`,
      changeFrequency: "monthly" as const,
      priority: 0.7
    })),
    { url: `${origin}/places`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${origin}/stories`, changeFrequency: "monthly", priority: 0.6 }
  ];
}
