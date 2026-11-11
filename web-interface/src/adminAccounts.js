import bcrypt from 'bcryptjs';
import { ADMIN_LOGIN, ADMIN_PASSWORD } from './config.js';
import { getDatabase } from './database.js';

async function seedAdminAccount() {
  try {
    const db = await getDatabase();
    const col = db.collection('admin_accounts');
    const existing = await col.findOne({ login: ADMIN_LOGIN });
    if (!existing) {
      const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
      await col.insertOne({
        login: ADMIN_LOGIN,
        passwordHash,
        role: 'admin',
        createdAt: new Date(),
      });
      console.log('Администратор создан:', ADMIN_LOGIN);
    } else {
      console.log('Администратор уже существует:', ADMIN_LOGIN);
    }
  } catch (err) {
    throw new Error('Ошибка seed администратора', { cause: err });
  }
}

export { seedAdminAccount };
