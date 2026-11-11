import { loadRootEnv } from '../../../shared/runtimeEnv.js';
import { runService } from '../../../shared/serviceRuntime.js';
import { getClient, closeConnection } from './services/database.js';
import {
  initConfigService,
  stopConfigService,
  validateSecurityConfig,
} from './services/configService.js';
import { createApp } from './app.js';

loadRootEnv(import.meta.url);

await runService({
  name: 'AI Tools',
  port: process.env.PORT || 3003,
  app: createApp(),
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
