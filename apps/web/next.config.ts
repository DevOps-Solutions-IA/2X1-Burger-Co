import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: __dirname,
  generateBuildId: async () => process.env.RELEASE_BUILD_ID ?? 'development-untracked',
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  async rewrites() {
    return [
      // Nginx is the canonical public proxy. This fallback also keeps the
      // exposed local Web port same-origin, so browsers never need CORS access
      // to the API container on :4300.
      {
        source: '/api/:path*',
        destination: 'http://api:3000/:path*',
      },
    ];
  },
};

export default nextConfig;
