import { createApp } from './src/app.js';
import {
  PORT,
  WEB_SERVER_REQUEST_TIMEOUT_MS,
  WEB_SERVER_HEADERS_TIMEOUT_MS,
  WEB_SERVER_KEEP_ALIVE_TIMEOUT_MS,
  LONG_TIMEOUT_AGENT,
  validateStartupConfig,
} from './src/config.js';
import { closeDatabase } from './src/database.js';
import { seedAdminAccount } from './src/adminAccounts.js';
import { ensureClientLinksIndexes } from './src/widgetUsers.js';

let server;
let shutdownPromise;

function shutdown() {
  shutdownPromise ??= (async () => {
    const deadline = setTimeout(() => process.exit(1), 10000);
    deadline.unref();
    try {
      if (server) {
        await new Promise((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        );
      }
      await Promise.all([closeDatabase(), LONG_TIMEOUT_AGENT.close()]);
    } finally {
      clearTimeout(deadline);
    }
  })();
  return shutdownPromise;
}

async function start() {
  validateStartupConfig();
  await seedAdminAccount();
  await ensureClientLinksIndexes();
  const app = createApp();
  server = app.listen(PORT, () => {
    console.log(`Веб-интерфейс запущен на http://localhost:${PORT}`);
  });
  server.requestTimeout = WEB_SERVER_REQUEST_TIMEOUT_MS;
  server.headersTimeout = WEB_SERVER_HEADERS_TIMEOUT_MS;
  server.keepAliveTimeout = WEB_SERVER_KEEP_ALIVE_TIMEOUT_MS;
  server.on('error', (error) => {
    console.error('Ошибка HTTP-сервера:', error);
    process.exitCode = 1;
    shutdown().catch((shutdownError) => console.error('Ошибка остановки:', shutdownError));
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    shutdown().catch((error) => {
      console.error('Ошибка остановки:', error);
      process.exitCode = 1;
    });
  });
}

start().catch(async (error) => {
  console.error('Ошибка запуска:', error);
  process.exitCode = 1;
  await shutdown();
});
