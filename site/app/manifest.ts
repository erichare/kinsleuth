import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

export const dynamic = "force-static";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: site.name,
    short_name: site.compactName,
    description: site.description,
    start_url: "/",
    display: "browser",
    background_color: "#f4efe4",
    theme_color: "#173f35",
    icons: [{ src: "/icon.png", sizes: "512x512", type: "image/png" }]
  };
}
