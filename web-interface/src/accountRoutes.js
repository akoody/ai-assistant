import { getDatabase } from './database.js';
import { adminAuth } from './accessAuth.js';
import bcrypt from 'bcryptjs';
import { ObjectId } from 'mongodb';

export function registerAccountRoutes(app) {
  app.get('/api/admin/accounts', adminAuth('admin'), async (req, res) => {
    try {
      const db = await getDatabase();
      const accounts = await db
        .collection('admin_accounts')
        .find({}, { projection: { passwordHash: 0 } })
        .sort({ createdAt: -1 })
        .toArray();
      return res.json({ success: true, accounts });
    } catch (err) {
      console.error('Ошибка получения аккаунтов:', err);
      return res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
    }
  });

  app.post('/api/admin/accounts/create', adminAuth('admin'), async (req, res) => {
    try {
      const { login, password } = req.body;
      if (!login || !password) {
        return res.status(400).json({ success: false, error: 'Укажите логин и пароль' });
      }
      if (login.length < 4 || password.length < 6) {
        return res
          .status(400)
          .json({ success: false, error: 'Логин минимум 4 символа, пароль — 6' });
      }
      const db = await getDatabase();
      const existing = await db.collection('admin_accounts').findOne({ login });
      if (existing) {
        return res
          .status(409)
          .json({ success: false, error: 'Аккаунт с таким логином уже существует' });
      }
      const passwordHash = await bcrypt.hash(password, 12);
      const result = await db.collection('admin_accounts').insertOne({
        login,
        passwordHash,
        role: 'viewer',
        createdAt: new Date(),
      });
      return res.json({ success: true, id: result.insertedId, login, role: 'viewer' });
    } catch (err) {
      console.error('Ошибка создания аккаунта:', err);
      return res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
    }
  });

  app.delete('/api/admin/accounts/:id', adminAuth('admin'), async (req, res) => {
    try {
      const { id } = req.params;
      if (!ObjectId.isValid(id)) {
        return res.status(400).json({ success: false, error: 'Неверный ID' });
      }
      const db = await getDatabase();
      const account = await db.collection('admin_accounts').findOne({ _id: new ObjectId(id) });
      if (!account) {
        return res.status(404).json({ success: false, error: 'Аккаунт не найден' });
      }
      if (account.role === 'admin') {
        return res.status(403).json({ success: false, error: 'Нельзя удалить администратора' });
      }
      await db.collection('admin_accounts').deleteOne({ _id: new ObjectId(id) });
      return res.json({ success: true });
    } catch (err) {
      console.error('Ошибка удаления аккаунта:', err);
      return res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
    }
  });

  app.post('/api/admin/accounts/verify-password', adminAuth(), async (req, res) => {
    try {
      const { login, password } = req.body || {};
      const normalizedLogin = String(login || '').trim();
      const normalizedPassword = String(password || '');
      if (!normalizedLogin || !normalizedPassword) {
        return res.status(400).json({ success: false, error: 'Укажите логин и текущий пароль' });
      }

      const actor = req.adminUser || {};
      const actorRole = String(actor.role || '');
      const actorLogin = String(actor.login || '');
      if (actorRole !== 'admin' && normalizedLogin !== actorLogin) {
        return res
          .status(403)
          .json({ success: false, error: 'Можно проверять пароль только своего аккаунта' });
      }

      const db = await getDatabase();
      const account = await db.collection('admin_accounts').findOne({ login: normalizedLogin });
      if (!account) {
        return res.status(404).json({ success: false, error: 'Аккаунт не найден' });
      }

      const valid = await bcrypt.compare(normalizedPassword, account.passwordHash);
      if (!valid) {
        return res.status(401).json({ success: false, error: 'Неверный текущий пароль' });
      }

      return res.json({ success: true });
    } catch (err) {
      console.error('Ошибка проверки пароля аккаунта:', err);
      return res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
    }
  });

  app.post('/api/admin/accounts/change-password', adminAuth(), async (req, res) => {
    try {
      const { login, oldPassword, newPassword } = req.body || {};
      const normalizedLogin = String(login || '').trim();
      const normalizedOldPassword = String(oldPassword || '');
      const normalizedNewPassword = String(newPassword || '');

      if (!normalizedLogin || !normalizedOldPassword || !normalizedNewPassword) {
        return res
          .status(400)
          .json({ success: false, error: 'Укажите логин, текущий и новый пароль' });
      }

      if (normalizedNewPassword.length < 6) {
        return res
          .status(400)
          .json({ success: false, error: 'Новый пароль должен быть не менее 6 символов' });
      }

      const actor = req.adminUser || {};
      const actorRole = String(actor.role || '');
      const actorLogin = String(actor.login || '');
      if (actorRole !== 'admin' && normalizedLogin !== actorLogin) {
        return res
          .status(403)
          .json({ success: false, error: 'Можно менять пароль только своего аккаунта' });
      }

      const db = await getDatabase();
      const account = await db.collection('admin_accounts').findOne({ login: normalizedLogin });
      if (!account) {
        return res.status(404).json({ success: false, error: 'Аккаунт не найден' });
      }

      const validOldPassword = await bcrypt.compare(normalizedOldPassword, account.passwordHash);
      if (!validOldPassword) {
        return res.status(401).json({ success: false, error: 'Неверный текущий пароль' });
      }

      const isSamePassword = await bcrypt.compare(normalizedNewPassword, account.passwordHash);
      if (isSamePassword) {
        return res
          .status(409)
          .json({ success: false, error: 'Новый пароль должен отличаться от текущего' });
      }

      const passwordHash = await bcrypt.hash(normalizedNewPassword, 12);
      await db.collection('admin_accounts').updateOne(
        { _id: account._id },
        {
          $set: {
            passwordHash,
            updatedAt: new Date(),
          },
        }
      );

      return res.json({ success: true, login: normalizedLogin });
    } catch (err) {
      console.error('Ошибка смены пароля аккаунта:', err);
      return res.status(500).json({ success: false, error: 'Внутренняя ошибка сервера' });
    }
  });
}
