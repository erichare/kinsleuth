import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  output: "standalone",
  outputFileTracingIncludes: {
    "/*": ["./certs/supabase-prod-ca-2021.crt", "./db/migrations/*.sql"]
  },
  typedRoutes: false,
  experimental: {
    proxyClientMaxBodySize: "64mb"
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders()
      }
    ];
  }
};

function securityHeaders(): Array<{ key: string; value: string }> {
  const development = process.env.NODE_ENV !== "production";
  const scriptSources = ["'self'", "'unsafe-inline'", ...(development ? ["'unsafe-eval'"] : [])];
  const connectSources = [
    "'self'",
    "https://vercel.com",
    "https://*.blob.vercel-storage.com",
    ...(development ? ["ws:"] : [])
  ];
  const storageOrigin = configuredStorageOrigin();
  if (storageOrigin) {
    connectSources.push(storageOrigin);
  }

  const contentSecurityPolicy = [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connectSources.join(" ")}`,
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join("; ");

  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy },
    ...(development || !hostedBuild()
      ? []
      : [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]),
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "no-referrer" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()"
    },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
    ...(privateHostedBuild()
      ? [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }]
      : [])
  ];
}

function configuredStorageOrigin(): string | undefined {
  const endpoint = process.env.S3_PUBLIC_ENDPOINT?.trim() || process.env.S3_ENDPOINT?.trim();
  if (!endpoint) return undefined;
  try {
    const url = new URL(endpoint);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

function privateHostedBuild(): boolean {
  return hostedBuild() && process.env.KINRESOLVE_PUBLIC_ARCHIVE_ENABLED?.trim().toLowerCase() !== "true";
}

function hostedBuild(): boolean {
  const deploymentMode = process.env.KINRESOLVE_DEPLOYMENT_MODE?.trim().toLowerCase();
  if (deploymentMode === "hosted") return true;
  if (deploymentMode === "self-hosted") return false;
  return process.env.VERCEL_ENV?.trim().toLowerCase() === "production"
    || (process.env.VERCEL?.trim() === "1" && process.env.NODE_ENV === "production");
}

export default nextConfig;
