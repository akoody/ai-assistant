import { fileURLToPath } from 'node:url';
import { registerUserRoutes } from './userRoutes.js';
import { registerChatRoutes } from './chatRoutes.js';
import { registerTrackingRoutes } from './trackingRoutes.js';
import { registerLoginRoutes } from './loginRoutes.js';
import { registerAccountRoutes } from './accountRoutes.js';
import { registerAnalyticsRoutes } from './analyticsRoutes.js';
import express from 'express';
import {
  buildFrameAncestorsValue,
  ensureFrameAncestorsHasSelf,
  isAdminPath,
  isAllowedAdminRequest,
} from './securityHeaders.js';

export function createApp() {
  const app = express();
  app.use(express.json());

  app.use((req, res, next) => {
    // Ограничиваем встраивание iframe только доверенными доменами (kassir).
    // Важно: применяется к документу, который встраивается во фрейм (`widget.html`).
    if (req.path === '/widget.html') {
      const host = String(req.hostname || '').toLowerCase();
      const isSferaStand = host === 'sferaai.ru' || host.endsWith('.sferaai.ru');
      const frameAncestorsValue = ensureFrameAncestorsHasSelf(
        buildFrameAncestorsValue({ forceDev: isSferaStand })
      );
      res.setHeader('Content-Security-Policy', `frame-ancestors ${frameAncestorsValue};`);
    }
    next();
  });

  app.use((req, res, next) => {
    if (!isAdminPath(req.path)) {
      return next();
    }

    if (isAllowedAdminRequest(req)) {
      return next();
    }

    if (req.path.startsWith('/api/admin/')) {
      return res.status(403).json({
        success: false,
        error: 'Админ-панель доступна только на https://sferaai.ru/admin/',
      });
    }

    return res.status(404).send('Not Found');
  });

  app.use(express.static(fileURLToPath(new URL('../public', import.meta.url))));

  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  registerUserRoutes(app);
  registerChatRoutes(app);
  registerTrackingRoutes(app);
  registerLoginRoutes(app);
  registerAccountRoutes(app);
  registerAnalyticsRoutes(app);
  return app;
}
