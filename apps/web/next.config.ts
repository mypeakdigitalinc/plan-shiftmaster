import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@shifthub/api-client', '@shifthub/auth', '@shifthub/shared'],
};

export default config;
