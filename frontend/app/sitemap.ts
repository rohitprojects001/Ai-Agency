import type { MetadataRoute } from "next";
import { getPublicSiteUrl } from "../lib/site-url";

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = getPublicSiteUrl();
  if (!siteUrl) return [];

  return [
    {
      url: `${siteUrl}/workshop`,
      changeFrequency: "monthly",
      priority: 1,
    },
  ];
}
