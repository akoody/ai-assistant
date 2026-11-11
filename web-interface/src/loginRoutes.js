import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { JWT_SECRET, SITE_LOGIN, SITE_PASSWORD, SITE_JWT_SECRET } from './config.js';
import { getDatabase } from './database.js';
import { adminLoginRateLimit, siteLoginRateLimit } from './loginRateLimit.js';
import { isSiteAuthConfigured, timingSafeStringEqual, siteAuth, adminAuth } from './accessAuth.js';

export function registerLoginRoutes(app) {
  app.post('/api/admin/login', adminLoginRateLimit, async (req, res) => {
    try {
      const { login, password } = req.body;
      if (!login || !password) {
        return res.status(400).json({ success: false, error: 'Укажите логин и пароль' });
      }
      const db = await getDatabase();
      const account = await db.collection('admin_accounts').findOne({ login });
      if (!account) {
        return res.status(401).json({ success: false, error: 'Неверный логин или пароль' });
      }
      const valid = await bcrypt.compare(password, account.passwordHash);
      if (!valid) {
        return res.status(401).json({ success: false, error: 'Неверный логин или пароль' });
      }
      const token = jwt.sign(
        { id: account._id.toString(), login: account.login, role: account.role },
        JWT_SECRET,
        { expiresIn: '24h' }
      );
      req.loginRateLimit?.reset?.();
      return res.json({ success: true, token, role: account.role, login: account.login });
    } catch (err) {
      console.error('Ошибка логина:', err);
      return res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
    }
  });

  app.post('/api/site/login', siteLoginRateLimit, async (req, res) => {
    try {
      if (!isSiteAuthConfigured()) {
        return res.status(503).json({
          success: false,
          error: 'Авторизация главной страницы не настроена',
        });
      }

      const login = String(req.body?.login || '').trim();
      const password = String(req.body?.password || '');
      if (!login || !password) {
        return res.status(400).json({ success: false, error: 'Укажите логин и пароль' });
      }

      const validLogin = timingSafeStringEqual(login, SITE_LOGIN);
      const validPassword = timingSafeStringEqual(password, SITE_PASSWORD);
      if (!validLogin || !validPassword) {
        return res.status(401).json({ success: false, error: 'Неверный логин или пароль' });
      }

      const token = jwt.sign(
        { login: String(SITE_LOGIN).trim(), role: 'widget', scope: 'site-widget' },
        SITE_JWT_SECRET,
        { expiresIn: '24h' }
      );
      req.loginRateLimit?.reset?.();
      return res.json({ success: true, token, login: String(SITE_LOGIN).trim(), role: 'widget' });
    } catch (err) {
      console.error('Ошибка логина главной страницы:', err);
      return res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
    }
  });

  app.get('/api/site/verify', siteAuth, (req, res) => {
    return res.json({ success: true, user: req.siteUser });
  });

  app.get('/api/admin/verify', adminAuth(), (req, res) => {
    return res.json({ success: true, user: req.adminUser });
  });
}
