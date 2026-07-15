import type { MetadataRoute } from "next";

import { publicArchiveEnabled } from "@/lib/public-surface";

export default function robots(): MetadataRoute.Robots {
  if (!publicArchiveEnabled()) {
    return {
      rules: { userAgent: "*", disallow: "/" }
    };
  }

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/app", "/api", "/login", "/setup"]
      }
    ]
  };
}
