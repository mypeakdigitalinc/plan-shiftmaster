import { serve } from '@hono/node-server';
import { createApp } from './app';
import { createTokenVerifier } from './auth';
import { loadConfig } from './config';
import { createDb } from './db';
import { createExpoPushSender } from './push';

const config = loadConfig();
const db = createDb(config.databaseUrl);
const app = createApp({
  db,
  verifyToken: createTokenVerifier(config),
  corsOrigins: config.corsOrigins,
  appUrl: config.appUrl,
  jobsSecret: config.jobsSecret,
  pushSender: createExpoPushSender({ accessToken: config.expoAccessToken }),
  devLoginSecret: config.devLoginSecret,
});

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`ShiftHub API on http://localhost:${info.port}  (docs: /docs)`);
  if (config.devLoginSecret) console.warn('DEV LOGIN ENABLED — POST /dev/token issues tokens for any email');
});
