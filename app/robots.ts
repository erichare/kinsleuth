import type { MetadataRoute } from "next";

import { publicDemoEnabled } from "@/lib/public-demo-config";
import { publicArchiveEnabled } from "@/lib/public-surface";

export default function robots(): MetadataRoute.Robots {
  if (!publicArchiveEnabled()) {
    return {
      rules: { userAgent: "*", disallow: "/" }
    };
  }

  if (publicDemoEnabled()) {
    return {
      rules: [
        {
          userAgent: "*",
          allow: ["/", "/family", "/people", "/places", "/stories"],
          disallow: [
            "/app",
            "/api",
            "/challenge",
            "/login",
            "/setup",
            "/invite",
            "/forgot-password",
            "/reset-password",
            "/verify-email",
            "/resend-verification",
            "/kinsleuth"
          ]
        }
      ],
      sitemap: "https://demo.kinresolve.com/sitemap.xml"
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
