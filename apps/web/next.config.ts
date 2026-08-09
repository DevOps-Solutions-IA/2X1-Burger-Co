import type { NextConfig } from 'next';
import path from 'node:path';

const internalApiUrl = process.env.INTERNAL_API_URL ?? 'http://api:3000';

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname, '../..'),
  generateBuildId: async () => process.env.RELEASE_BUILD_ID ?? 'development-untracked',
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  webpack(config, { dev, webpack }) {
    if (!dev) {
      config.optimization ??= {};
      config.optimization.moduleIds = false;
      config.plugins ??= [];
      config.plugins.push(
        new webpack.ids.DeterministicModuleIdsPlugin({
          maxLength: 8,
          failOnConflict: true,
        }),
      );
    }
    return config;
  },
  async rewrites() {
    return [
      // Nginx is the canonical public proxy. This fallback also keeps the
      // exposed local Web port same-origin, so browsers never need CORS access
      // to the API container on :4300.
      {
        source: '/api/:path*',
        destination: `${internalApiUrl}/:path*`,
      },
    ];
  },
};

export default nextConfig;
