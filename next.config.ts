import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/**
 * Security headers (SECURITY_AND_PRIVACY.md §7, DEPLOYMENT_PROXY.md §11). The CSP has no nonces:
 * nonces need every page rendered dynamically, which Cache Components / Partial Prerendering
 * rule out, so inline scripts are allowed (Next.js "Without Nonces" pattern). React needs
 * `unsafe-eval` in development only. `blob:` media lets the recording panel read a chosen file's
 * duration before upload. Not sent on `/api/`: config headers replace a route's own header, and the
 * file routes set a stricter sandbox CSP that must stay (API responses are JSON or files).
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Browsers ignore HSTS over plain HTTP, so this only takes effect behind TLS. No includeSubDomains
  // or preload: those bind the client's whole domain and need their decision.
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/((?!api/).*)", headers: [{ key: "Content-Security-Policy", value: contentSecurityPolicy }] },
    ];
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // The app has no landing page; the root opens the dashboard.
  async redirects() {
    return [{ source: "/", destination: "/dashboard", permanent: false }];
  },
};

export default nextConfig;
