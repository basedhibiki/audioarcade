Set-Content -Path .\apps\web\next.config.mjs -Value @"
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  productionBrowserSourceMaps: false,
  experimental: {
    optimizePackageImports: ['livekit-client'],
  },
};

export default nextConfig;
"@
