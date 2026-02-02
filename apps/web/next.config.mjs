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
