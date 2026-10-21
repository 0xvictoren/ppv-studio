/** @type {import('next').NextConfig} */
const nextConfig = {
  // Separate build output for the mock-mode test build (NEXT_DIST_DIR=.next-mock).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  experimental: { instrumentationHook: true },
  async headers() {
    return [
      // The app itself must not be framed (clickjacking)…
      { source: "/((?!embed|embed\\.js|media).*)", headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'self'" }] },
      // …but embeds are meant to be dropped into any site.
      { source: "/embed/:path*", headers: [{ key: "Content-Security-Policy", value: "frame-ancestors *" }] },
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }, { key: "Service-Worker-Allowed", value: "/" }] },
      {
        source: "/embed.js",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Cache-Control", value: "public, max-age=300" },
        ],
      },
    ];
  },
  webpack: (config) => {
    // Optional deps pulled in by wallet connectors (Base Account -> CDP SDK x402 helpers,
    // WalletConnect logger). PayPerWatch never uses them, so stub them out.
    config.resolve.alias = {
      ...config.resolve.alias,
      "@x402/core/client": false,
      "@x402/evm": false,
      "@x402/evm/exact/client": false,
      "@x402/evm/upto/client": false,
      "@x402/svm/exact/client": false,
    };
    config.externals.push("pino-pretty", "lokijs", "encoding");
    return config;
  },
};

export default nextConfig;
