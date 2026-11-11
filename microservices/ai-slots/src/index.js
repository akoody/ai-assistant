import { loadRootEnv } from '../../../shared/runtimeEnv.js';
import { runService } from '../../../shared/serviceRuntime.js';
import { getClient, closeConnection } from './services/database.js';
import {
  initConfigService,
  stopConfigService,
  validateSecurityConfig,
} from './services/configService.js';
import { initSlotsService, stopSlotsService } from './services/slotsService.js';
import { createApp } from './app.js';

loadRootEnv(import.meta.url);

await runService({
  name: 'AI Slots',
  port: process.env.PORT || 3002,
  app: createApp(),
  async start() {
    await getClient();
    await initConfigService();
    validateSecurityConfig();
    await initSlotsService();
  },
  async stop() {
    stopConfigService();
    stopSlotsService();
    await closeConnection();
  },
});
