/** Write the OpenAPI spec to apps/api/openapi.json (used for docs and future API Gateway import). */
import { writeFileSync } from 'node:fs';
import { createApp } from '../src/app';

const app = createApp({
  db: {
    asUser: async () => { throw new Error('no db'); },
    ping: async () => true,
    findProfileIdByEmail: async () => null,
    close: async () => {},
  },
  verifyToken: async () => { throw new Error('no auth'); },
});
const res = await app.request('/openapi.json');
writeFileSync(new URL('../openapi.json', import.meta.url), JSON.stringify(await res.json(), null, 2) + '\n');
console.log('Wrote apps/api/openapi.json');
