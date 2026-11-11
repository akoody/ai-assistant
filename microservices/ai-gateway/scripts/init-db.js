import { MongoClient } from 'mongodb';
import { loadRootEnv, resolveInternalApiKey } from '../../../shared/runtimeEnv.js';

loadRootEnv(import.meta.url);

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME;
const COLLECTION_NAME = 'microserviceSettings';
const POLZA_API_KEY = String(process.env.POLZA_API_KEY || '').trim();
// The Ollama host has no authentication, so its address is configuration, not code.
const OLLAMA_BASE_URL = String(process.env.OLLAMA_BASE_URL || 'http://localhost:11434').trim();

if (process.env.NODE_ENV === 'production' && !POLZA_API_KEY) {
  throw new Error('POLZA_API_KEY is required for ai-gateway DB initialization in production');
}

resolveInternalApiKey({
  serviceName: 'ai-gateway init-db',
  settingName: 'testApiKey',
  envNames: ['AI_GATEWAY_API_KEY'],
});

function redactConfig(config) {
  return JSON.parse(
    JSON.stringify(config, (key, value) => {
      if (key.toLowerCase().includes('apikey') && value) {
        return '***';
      }
      return value;
    })
  );
}

const defaultConfig = {
  serviceName: 'ai-gateway',
  maxConcurrentRequests: 5,
  testApiKey: null,
  llms: [
    {
      modelId: 'qwen2.5:7b-instruct-q6_K',
      enabled: true,
      types: ['generate', 'chat', 'planner', 'quick', 'final', 'slots-extraction'],
      name: 'Qwen 2.5 7B (Ollama)',
      provider: 'ollama',
      baseUrl: OLLAMA_BASE_URL,
      priority: 10,
      timeoutMs: 45000,
    },
    {
      modelId: 'qwen/qwen-2.5-7b-instruct',
      apiKeyEnv: 'POLZA_API_KEY',
      enabled: Boolean(POLZA_API_KEY),
      types: ['generate', 'chat', 'planner', 'quick', 'final', 'slots-extraction'],
      name: 'Qwen 2.5 7B Instruct',
      provider: 'polza',
      priority: 100,
    },
  ],
  createdAt: new Date(),
  updatedAt: new Date(),
};

async function initDatabase() {
  let client;

  try {
    console.log('🔌 Подключение к MongoDB...');
    client = new MongoClient(MONGODB_URI, {
      useUnifiedTopology: true,
      useNewUrlParser: true,
    });

    await client.connect();
    console.log('✅ Подключение установлено\n');

    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);

    const existingConfig = await collection.findOne({
      serviceName: 'ai-gateway',
    });

    if (existingConfig) {
      console.log('⚠️  Конфигурация для ai-gateway уже существует\n');
      const update = process.env.FORCE_UPDATE === 'true' || false;

      if (update) {
        console.log('🔄 Обновление существующей конфигурации...');
        await collection.updateOne(
          { serviceName: 'ai-gateway' },
          {
            $set: {
              ...defaultConfig,
              updatedAt: new Date(),
            },
          }
        );
        console.log('✅ Конфигурация обновлена\n');
      } else {
        console.log('ℹ️  Используйте FORCE_UPDATE=true для обновления конфигурации\n');
      }
    } else {
      console.log('📝 Создание новой конфигурации...');
      await collection.insertOne(defaultConfig);
      console.log('✅ Конфигурация создана\n');
    }

    const finalConfig = await collection.findOne({
      serviceName: 'ai-gateway',
    });

    console.log('📋 Финальная конфигурация:');
    console.log(JSON.stringify(redactConfig(finalConfig), null, 2));
    console.log('\n✅ Инициализация БД завершена успешно!');
  } catch (error) {
    console.error('❌ Ошибка при инициализации БД:', error);
    process.exit(1);
  } finally {
    if (client) {
      await client.close();
      console.log('\n🔌 Подключение закрыто');
    }
  }
}

initDatabase().catch((error) => {
  console.error('❌ Критическая ошибка:', error);
  process.exit(1);
});
