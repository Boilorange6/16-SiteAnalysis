import type { NextConfig } from "next";

const reactInspectionEnabled =
  process.env.NODE_ENV === "development" &&
  process.env.NEXT_PUBLIC_ENABLE_REACT_INSPECTOR === "1";
const reactDevScriptOrigin = reactInspectionEnabled ? " https://unpkg.com" : "";
const reactDevStyleOrigin = reactInspectionEnabled ? " https://fonts.googleapis.com" : "";
const reactDevFontOrigin = reactInspectionEnabled ? " https://fonts.gstatic.com" : "";
const reactDevConnectOrigin = reactInspectionEnabled ? " https://www.react-grab.com" : "";
const reactDevWorkerSource = reactInspectionEnabled ? "worker-src 'self' blob:" : "worker-src 'self'";

const nextConfig: NextConfig = {
  // Webpack emits worker child chunks beside the server chunks. Keep them in
  // standalone output because nft cannot infer a dynamic worker URL, and use
  // the runtime chunk directory as the base instead of /site/_next/.
  outputFileTracingIncludes: {
    "/api/v2/analyses": ["./.next/server/chunks/**/*.js"],
    "/api/v2/analyses/[id]": ["./.next/server/chunks/**/*.js"],
  },
  webpack(config, { isServer }) {
    if (isServer && config.output?.path) {
      // Node worker_threads needs the emitted chunk on disk. Next's default
      // publicPath includes basePath (/site/_next/), which resolves to a
      // non-existent filesystem location when passed to new Worker(). A
      // relative worker path lets webpack's Node runtime resolve the emitted
      // chunk relative to its actual server chunks directory in both dev and
      // standalone output.
      config.output.workerPublicPath = "./";
    }
    return config;
  },
  async rewrites() {
    return [{ source: "/favicon.ico", destination: "/icon.svg" }];
  },
  output: "standalone",
  // 상위 디렉터리에 package.json이 있으면 Next가 워크스페이스 루트를 그쪽으로 추론해
  // standalone 산출물이 .next/standalone/<상대경로>/ 로 중첩된다(2026-08-01 운영 장애).
  outputFileTracingRoot: __dirname,
  basePath: "/site",
  serverExternalPackages: ["better-sqlite3", "rhino3dm", "shapefile"],
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
