import type { NextConfig } from "next";

const reactDevScriptOrigin = process.env.NODE_ENV === "development" ? " https://unpkg.com" : "";
const reactDevStyleOrigin = process.env.NODE_ENV === "development" ? " https://fonts.googleapis.com" : "";
const reactDevFontOrigin = process.env.NODE_ENV === "development" ? " https://fonts.gstatic.com" : "";
const reactDevConnectOrigin = process.env.NODE_ENV === "development" ? " https://www.react-grab.com" : "";
const reactDevWorkerSource = process.env.NODE_ENV === "development" ? "worker-src 'self' blob:" : "worker-src 'self'";

const nextConfig: NextConfig = {
  output: "standalone",
  basePath: "/site",
  serverExternalPackages: ["better-sqlite3"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              `script-src 'self' 'unsafe-inline' 'unsafe-eval'${reactDevScriptOrigin}`,
              `style-src 'self' 'unsafe-inline'${reactDevStyleOrigin}`,
              "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://tile.openstreetmap.org https://server.arcgisonline.com https://*.basemaps.cartocdn.com https://*.tile.opentopomap.org",
              `connect-src 'self' https://overpass-api.de https://lz4.overpass-api.de https://maps.apigw.ntruss.com https://apis.data.go.kr https://openapi.naver.com https://server.arcgisonline.com https://*.basemaps.cartocdn.com https://*.tile.openstreetmap.org https://*.tile.opentopomap.org${reactDevConnectOrigin}`,
              `font-src 'self' data:${reactDevFontOrigin}`,
              reactDevWorkerSource,
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
