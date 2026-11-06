/** AWS Lambda entry point (future migration). Same app, different adapter. */
import { handle } from 'hono/aws-lambda';
import { createApp } from './app';
import { createTokenVerifier } from './auth';
import { loadConfig } from './config';
import { createDb } from './db';
import { createExpoPushSender } from './push';

const config = loadConfig();
const app = createApp({
  db: createDb(config.databaseUrl, { max: 1 }),
  verifyToken: createTokenVerifier(config),
  corsOrigins: config.corsOrigins,
  appUrl: config.appUrl,
  jobsSecret: config.jobsSecret,
  pushSender: createExpoPushSender({ accessToken: config.expoAccessToken }),
});

export const handler = handle(app);
