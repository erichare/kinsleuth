import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = ["/", "/product/", "/method/", "/pricing/", "/roadmap/", "/developers/", "/privacy/", "/open-source/", "/about/", "/beta/"];
  return routes.map((route, index) => ({
    url: `${site.url}${route}`,
    changeFrequency: index === 0 ? "weekly" : "monthly",
    priority: index === 0 ? 1 : route === "/beta/" ? 0.9 : 0.7
  }));
}
