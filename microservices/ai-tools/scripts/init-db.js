import { MongoClient } from 'mongodb';
import { loadRootEnv, resolveInternalApiKey } from '../../../shared/runtimeEnv.js';

loadRootEnv(import.meta.url);
resolveInternalApiKey({
  serviceName: 'ai-tools init-db',
  settingName: 'testApiKey',
  envName: 'AI_TOOLS_API_KEY',
});

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME;
const FORCE_UPDATE = process.env.FORCE_UPDATE === 'true';

const defaultConfig = {
  serviceName: 'ai-tools',
  maxConcurrentRequests: 5,
  testApiKey: null,
  kassirApiToken: '', // Токен нужно будет добавить вручную
  kassirApiUrl: 'https://api.kassirdev.ru',
  createdAt: new Date(),
  updatedAt: new Date(),
};

async function initDatabase() {
  let client;

  try {
    console.log('🔌 Подключение к MongoDB...');
    client = new MongoClient(MONGODB_URI);

    await client.connect();
    console.log('✅ Подключение установлено');

    const db = client.db(DB_NAME);
    const collection = db.collection('microserviceSettings');

    // Проверяем существование конфигурации
    const existingConfig = await collection.findOne({ serviceName: 'ai-tools' });

    if (existingConfig && !FORCE_UPDATE) {
      console.log('ℹ️  Конфигурация ai-tools уже существует');
      console.log('   Используйте FORCE_UPDATE=true для обновления');
      return;
    }

    if (existingConfig && FORCE_UPDATE) {
      console.log('🔄 Обновление конфигурации ai-tools...');

      // Сохраняем существующие значения, если они есть
      const updateConfig = {
        ...defaultConfig,
        kassirApiToken: existingConfig.kassirApiToken || defaultConfig.kassirApiToken,
        updatedAt: new Date(),
      };

      await collection.updateOne({ serviceName: 'ai-tools' }, { $set: updateConfig });

      console.log('✅ Конфигурация обновлена');
    } else {
      console.log('📝 Создание конфигурации ai-tools...');
      await collection.insertOne(defaultConfig);
      console.log('✅ Конфигурация создана');
    }

    // Выводим текущую конфигурацию
    const config = await collection.findOne({ serviceName: 'ai-tools' });
    console.log('\n📋 Текущая конфигурация:');
    console.log(`   serviceName: ${config.serviceName}`);
    console.log(`   maxConcurrentRequests: ${config.maxConcurrentRequests}`);
    console.log('   testApiKey: configured through environment');
    console.log(
      `   kassirApiToken: ${config.kassirApiToken ? '***настроен***' : '⚠️  НЕ НАСТРОЕН'}`
    );
    console.log(`   kassirApiUrl: ${config.kassirApiUrl}`);

    if (!config.kassirApiToken) {
      console.log('\n⚠️  ВНИМАНИЕ: Токен API Кассир.ру не настроен!');
      console.log('   Для работы инструментов необходимо добавить токен в настройки БД.');
    }

    console.log('\n✅ Инициализация БД завершена');
  } catch (error) {
    console.error('❌ Ошибка инициализации БД:', error);
    process.exit(1);
  } finally {
    if (client) {
      await client.close();
      console.log('🔌 Подключение закрыто');
    }
  }
}

initDatabase();
