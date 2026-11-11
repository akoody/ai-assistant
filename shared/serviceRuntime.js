// Common HTTP skeleton of the microservices. Express is passed in because shared/ has no
// dependencies of its own (the same approach as createMongoConnection).

export function positiveIntegerFromEnv(name, fallback) {
  const value = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Builds the service application: JSON body parsing, a request log line, the routes,
 * JSON error responses and a JSON 404. Creating it opens no port and no connection.
 */
export function createServiceApp({ express, routes, jsonLimit = '100kb', log = console }) {
  const app = express();
  app.use(express.json({ limit: jsonLimit }));
  app.use((req, res, next) => {
    log.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
    next();
  });
  for (const [mountPath, router] of routes) app.use(mountPath, router);

  // Express recognises error handlers by their four parameters.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err?.type === 'entity.too.large') {
      log.error('Ошибка: payload too large');
      return res.status(413).json({ error: 'Payload too large' });
    }
    log.error('Ошибка:', err);
    return res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  });
  app.use((req, res) => {
    res.status(404).json({ error: 'Маршрут не найден' });
  });
  return app;
}

/**
 * Starts a service: runs `start` (connections, configuration), listens on `port`, and on
 * SIGINT/SIGTERM stops accepting requests, finishes open ones and runs `stop`.
 * The process exits when shutdown completes, with code 1 after a failed start or stop;
 * a hung shutdown is cut off after `shutdownTimeoutMs`.
 */
export async function runService({
  name,
  port,
  app,
  start = async () => {},
  stop = async () => {},
  timeouts = {},
  shutdownTimeoutMs = 10000,
  processRef = process,
  log = console,
}) {
  let server = null;
  let shutdownPromise = null;

  function shutdown() {
    shutdownPromise ??= (async () => {
      log.log('\nОстановка сервера...');
      const deadline = setTimeout(() => processRef.exit(1), shutdownTimeoutMs);
      deadline.unref?.();
      try {
        if (server?.listening) {
          await new Promise((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve()))
          );
        }
        await stop();
      } catch (error) {
        log.error('Ошибка остановки:', error);
        processRef.exitCode = 1;
      } finally {
        clearTimeout(deadline);
      }
      // Caches and keep-alive sockets may still hold the event loop; leave explicitly.
      processRef.exit(processRef.exitCode ?? 0);
    })();
    return shutdownPromise;
  }

  for (const signal of ['SIGINT', 'SIGTERM']) processRef.once(signal, () => shutdown());

  try {
    await start();
    server = await new Promise((resolve, reject) => {
      const listening = app.listen(port, () => resolve(listening));
      listening.once('error', reject);
    });
    Object.assign(server, timeouts);
    log.log(`${name} запущен на порту ${port}`);
  } catch (error) {
    log.error('Ошибка запуска сервера:', error);
    processRef.exitCode = 1;
    await shutdown();
  }
  return { server, shutdown };
}
