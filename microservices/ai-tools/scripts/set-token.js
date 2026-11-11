import { loadRootEnv } from '../../../shared/runtimeEnv.js';
loadRootEnv(import.meta.url);
import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME;
const TOKEN = process.argv[2] || '';

if (!TOKEN) {
  console.error('❌ Ошибка: Токен не указан');
  console.log('\nИспользование:');
  console.log('  node scripts/set-token.js <YOUR_TOKEN>');
  console.log('\nПример:');
  console.log('  node scripts/set-token.js eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...');
  process.exit(1);
}

async function setToken() {
  let client;

  try {
    console.log('🔌 Подключение к MongoDB...');
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    console.log('✅ Подключение установлено');

    const db = client.db(DB_NAME);
    const collection = db.collection('microserviceSettings');

    const result = await collection.updateOne(
      { serviceName: 'ai-tools' },
      {
        $set: {
          kassirApiToken: TOKEN,
          updatedAt: new Date(),
        },
      }
    );

    if (result.matchedCount === 0) {
      console.error('❌ Ошибка: Конфигурация ai-tools не найдена');
      console.log('   Сначала выполните: npm run db:init');
      process.exit(1);
    }

    console.log('✅ Токен успешно установлен');
    console.log('\n⚠️  ВНИМАНИЕ: Перезапустите микросервис для применения изменений');
  } catch (error) {
    console.error('❌ Ошибка установки токена:', error);
    process.exit(1);
  } finally {
    if (client) {
      await client.close();
      console.log('🔌 Подключение закрыто');
    }
  }
}

setToken();
