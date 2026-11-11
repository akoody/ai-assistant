import { MongoClient } from 'mongodb';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { loadRootEnv, resolveInternalApiKey } from '../../../shared/runtimeEnv.js';

loadRootEnv(import.meta.url);
resolveInternalApiKey({
  serviceName: 'ai-planner init-db',
  settingName: 'testApiKey',
  envName: 'AI_PLANNER_API_KEY',
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME;
const FORCE_UPDATE = process.env.FORCE_UPDATE === 'true';

// Читаем базовый промпт из файла (используется как основа для всех промптов)
function getBasePrompt() {
  try {
    const promptPath = join(__dirname, '../../../docs/prompt.txt');
    return readFileSync(promptPath, 'utf-8');
  } catch (error) {
    console.warn('Не удалось прочитать промпт из файла, используется дефолтный');
    return 'Ты - помощник для планирования событий и поиска билетов. Помоги пользователю найти подходящие мероприятия.';
  }
}

// Промпт для общего диалога и опроса (начало и после быстрого предложения)
function getGeneralDialogPrompt() {
  const base = getBasePrompt();
  return `${base}

## Ключевые правила
- Отвечай ТОЛЬКО на русском языке
- Будь вежливым и позитивным
- Используй кнопки для упрощения взаимодействия
- Сохраняй контекст разговора

## Твоя задача
Вести диалог с пользователем, узнавать его предпочтения, помогать выбрать тип мероприятия (концерт, театр, выставка), уточнять жанры и другие детали.

## Критически важно
НИКОГДА не придумывай и не генерируй конкретные концерты, спектакли или выставки. НИКОГДА не выдумывай названия артистов, даты, места, цены. Ты можешь ТОЛЬКО задавать вопросы и вести диалог.

## Контекст о пользователе
{slotsInfo}`;
}

// Промпт для выявления обязательных недостающих данных
function getMissingDataPrompt() {
  const base = getBasePrompt();
  return `${base}

## 🔴 КРИТИЧЕСКИ ВАЖНО - ГЛАВНАЯ ЗАДАЧА

ТЫ ДОЛЖЕН НЕМЕДЛЕННО СОБРАТЬ СЛЕДУЮЩИЕ ОБЯЗАТЕЛЬНЫЕ ДАННЫЕ:
{missingSlotsInfo}

БЕЗ ЭТИХ ДАННЫХ НЕВОЗМОЖНО ИСКАТЬ МЕРОПРИЯТИЯ!

## Твоя задача ПРЯМО СЕЙЧАС
1. Задай вопрос о недостающих данных (начни с самого первого из списка)
2. Не отвлекайся на другие темы
3. Собери ВСЕ недостающие данные по очереди
4. Используй кнопки для упрощения ответов
5. Отвечай ТОЛЬКО на русском языке

## Что НЕ делать
- НЕ задавай вопросы о необязательных данных
- НЕ предлагай мероприятия (их пока нет)
- НЕ придумывай концерты или события

## Контекст о пользователе
{slotsInfo}`;
}

// Промпт для отправки предложения с мероприятиями
function getOfferDeliveryPrompt() {
  const base = getBasePrompt();
  return `${base}

## ✅ ГЛАВНАЯ ЗАДАЧА

ТЫ ДОЛЖЕН ПРЕДСТАВИТЬ ПОЛЬЗОВАТЕЛЮ ПОДБОРКУ МЕРОПРИЯТИЙ НА ОСНОВЕ ПРЕДОСТАВЛЕННЫХ ДАННЫХ:

{offerText}

## Что делать
1. Внимательно изучи данные о мероприятиях выше
2. Сформируй красивое и привлекательное предложение, представив каждое мероприятие с полной информацией:
   - Название мероприятия
   - Место проведения (если есть)
   - Дата и время (если есть)
   - Цена (если есть)
   - Ссылка для покупки билетов (если есть)
   - Краткое описание (если есть)
3. Используй ТОЛЬКО данные из предоставленного списка - не изменяй и не добавляй ничего
4. После представления подборки:
   - Задай уточняющие вопросы для дальнейшей персонализации (жанр, предпочтения, бюджет и т.д.)
   - Предложи посмотреть больше вариантов, если нужно
   - Помоги пользователю выбрать подходящее мероприятие
5. Отвечай ТОЛЬКО на русском языке, будь вежливым и дружелюбным

## Что НЕ делать
- НИКОГДА не придумывай дополнительные мероприятия, которых нет в предоставленных данных
- НИКОГДА не изменяй данные (даты, цены, названия, места)
- НИКОГДА не выдумывай информацию, которой нет в данных
- НИКОГДА не пропускай важную информацию о мероприятиях (даты, места, цены)

## Контекст о пользователе
{slotsInfo}`;
}

const defaultConfig = {
  serviceName: 'ai-planner',
  maxConcurrentRequests: 5,
  testApiKey: null,
  aiGatewayUrl: 'http://localhost:3001',
  aiSlotsUrl: 'http://localhost:3002',
  aiToolsUrl: 'http://localhost:3003',
  aiSlotsApiKey: null,
  aiToolsApiKey: null,
  generalDialogPrompt: getGeneralDialogPrompt(),
  missingDataPrompt: getMissingDataPrompt(),
  offerDeliveryPrompt: getOfferDeliveryPrompt(),
  createdAt: new Date(),
  updatedAt: new Date(),
};

// Требования к слотам для разных типов запросов
const slotRequirements = [
  {
    requestType: 'default',
    requiredSlots: ['город'],
    allSlots: ['город', 'дата_события', 'тип_события', 'жанр', 'бюджет', 'количество_билетов'],
  },
  {
    requestType: 'концерт',
    requiredSlots: ['город'],
    allSlots: [
      'город',
      'дата_события',
      'жанр',
      'артист',
      'площадка',
      'бюджет',
      'количество_билетов',
    ],
  },
  {
    requestType: 'спектакль',
    requiredSlots: ['город'],
    allSlots: [
      'город',
      'дата_события',
      'театр',
      'название_спектакля',
      'бюджет',
      'количество_билетов',
    ],
  },
  {
    requestType: 'выставка',
    requiredSlots: ['город'],
    allSlots: ['город', 'дата_события', 'музей', 'тема', 'бюджет', 'количество_билетов'],
  },
];

async function initDatabase() {
  let client;

  try {
    console.log('🔌 Подключение к MongoDB...');
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    console.log('✅ Подключение установлено');

    const db = client.db(DB_NAME);

    // Инициализация конфигурации
    const settingsCollection = db.collection('microserviceSettings');
    const existingConfig = await settingsCollection.findOne({ serviceName: 'ai-planner' });

    if (existingConfig && !FORCE_UPDATE) {
      console.log('ℹ️  Конфигурация ai-planner уже существует');
      console.log('   Используйте FORCE_UPDATE=true для обновления');
    } else {
      if (existingConfig && FORCE_UPDATE) {
        console.log('🔄 Обновление конфигурации ai-planner...');
        const updateConfig = {
          ...defaultConfig,
          generalDialogPrompt: defaultConfig.generalDialogPrompt,
          missingDataPrompt: defaultConfig.missingDataPrompt,
          offerDeliveryPrompt: defaultConfig.offerDeliveryPrompt,
          updatedAt: new Date(),
        };
        await settingsCollection.updateOne({ serviceName: 'ai-planner' }, { $set: updateConfig });
        console.log('✅ Конфигурация обновлена');
      } else {
        console.log('📝 Создание конфигурации ai-planner...');
        await settingsCollection.insertOne(defaultConfig);
        console.log('✅ Конфигурация создана');
      }
    }

    // Инициализация требований к слотам
    const requirementsCollection = db.collection('slotRequirements');
    console.log('\n📝 Инициализация требований к слотам...');

    for (const requirement of slotRequirements) {
      const existing = await requirementsCollection.findOne({
        requestType: requirement.requestType,
      });

      if (existing && FORCE_UPDATE) {
        await requirementsCollection.updateOne(
          { requestType: requirement.requestType },
          { $set: requirement }
        );
        console.log(`   ✅ Обновлены требования для типа: ${requirement.requestType}`);
      } else if (!existing) {
        await requirementsCollection.insertOne(requirement);
        console.log(`   ✅ Созданы требования для типа: ${requirement.requestType}`);
      } else {
        console.log(`   ℹ️  Требования для типа ${requirement.requestType} уже существуют`);
      }
    }

    // Выводим текущую конфигурацию
    const config = await settingsCollection.findOne({ serviceName: 'ai-planner' });
    console.log('\n📋 Текущая конфигурация:');
    console.log(`   serviceName: ${config.serviceName}`);
    console.log(`   maxConcurrentRequests: ${config.maxConcurrentRequests}`);
    console.log('   testApiKey: configured through environment');
    console.log(`   aiGatewayUrl: ${config.aiGatewayUrl}`);
    console.log(`   aiSlotsUrl: ${config.aiSlotsUrl}`);
    console.log(`   aiToolsUrl: ${config.aiToolsUrl}`);

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
