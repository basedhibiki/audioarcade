export default { reactStrictMode: true };
/** @type {import('next').NextConfig} */
const base = {
  swcMinify: true,
  productionBrowserSourceMaps: false,
  experimental: {
    // better tree-shaking for deps
    optimizePackageImports: ['livekit-client'],
  },
};

if (process.env.ANALYZE === 'true') {
  const withAnalyzer = require('@next/bundle-analyzer')({
    enabled: true,
  });
  module.exports = withAnalyzer(base);
} else {
  module.exports = base;
}
