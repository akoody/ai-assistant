import { loadRootEnv } from '../../../shared/runtimeEnv.js';
import { positiveIntegerFromEnv, runService } from '../../../shared/serviceRuntime.js';
import { getClient, closeConnection } from './services/database.js';
import {
  initConfigService,
  stopConfigService,
  validateSecurityConfig,
} from './services/configService.js';
import { createApp } from './app.js';

loadRootEnv(import.meta.url);

const requestTimeout = positiveIntegerFromEnv('PLANNER_SERVER_REQUEST_TIMEOUT_MS', 190000);
const timeouts = {
  requestTimeout,
  headersTimeout: positiveIntegerFromEnv(
    'PLANNER_SERVER_HEADERS_TIMEOUT_MS',
    requestTimeout + 5000
  ),
  keepAliveTimeout: positiveIntegerFromEnv('PLANNER_SERVER_KEEP_ALIVE_TIMEOUT_MS', 70000),
};

await runService({
  name: 'AI Planner',
  port: process.env.PORT || 3004,
  app: createApp(),
  timeouts,
  async start() {
    await getClient();
    await initConfigService();
    validateSecurityConfig();
  },
  async stop() {
    stopConfigService();
    await closeConnection();
  },
});
