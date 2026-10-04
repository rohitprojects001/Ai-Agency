export function getPublicSiteUrl() {
  const configuredUrl = process.env.NEXT_PUBLIC_SITE_URL
    ?? process.env.VERCEL_PROJECT_PRODUCTION_URL
    ?? process.env.VERCEL_URL;
  if (!configuredUrl) return undefined;

  const url = new URL(configuredUrl.includes("://") ? configuredUrl : `https://${configuredUrl}`);
  if (url.protocol !== "https:" && url.hostname !== "localhost") return undefined;
  return url.origin;
}
