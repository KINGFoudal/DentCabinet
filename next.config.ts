import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

function origin(url: string | undefined) {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
}

const supabaseOrigin = origin(process.env.NEXT_PUBLIC_SUPABASE_URL);
const supabaseSources = supabaseOrigin ? [supabaseOrigin, supabaseOrigin.replace(/^http/, "ws")] : [];

/**
 * Politique de sécurité du contenu, sans nonce : les pages de /app sont prérendues
 * statiquement (cache du service worker), or un nonce exige un rendu dynamique à chaque
 * requête (voir node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md).
 * Les scripts en ligne de Next restent donc autorisés ('unsafe-inline') ; la politique limite
 * en revanche les origines des scripts, des connexions et des images, interdit les plugins,
 * le changement de <base>, l'envoi de formulaires ailleurs et l'affichage dans un cadre.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' blob: data: ${supabaseOrigin ?? ""}`.trim(),
  `media-src 'self' blob: ${supabaseOrigin ?? ""}`.trim(),
  "font-src 'self' data:",
  `connect-src 'self' ${supabaseSources.join(" ")}`.trim(),
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()" },
];

const nextConfig: NextConfig = {
  /* config options here */
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
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
