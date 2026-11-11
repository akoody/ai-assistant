import NodeCache from 'node-cache';
import { getCollection } from './database.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { buildEventTaxonomyPrompt } from '../../../../shared/eventTaxonomy.js';
import { loadRootEnv, resolveInternalApiKey } from '../../../../shared/runtimeEnv.js';

loadRootEnv(import.meta.url);

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const configCache = new NodeCache({ stdTTL: 60 }); // Обновление каждую минуту
let updateInterval = null;

export async function initConfigService() {
  await updateConfigCache();

  // Обновляем каждую минуту
  updateInterval = setInterval(async () => {
    await updateConfigCache();
  }, 60000);

  console.log('Сервис конфигурации инициализирован');
}

export function stopConfigService() {
  if (updateInterval) {
    clearInterval(updateInterval);
    updateInterval = null;
  }
}

async function updateConfigCache() {
  try {
    const collection = await getCollection('microserviceSettings');
    const config = await collection.findOne({ serviceName: 'ai-slots' });

    if (config) {
      configCache.set('config', config);
    }
  } catch (error) {
    console.error('Ошибка обновления конфигурации:', error);
  }
}

export function getServiceConfig() {
  return configCache.get('config') || null;
}

export function getConfigValue(key, defaultValue = null) {
  const config = getServiceConfig();
  return config?.[key] ?? defaultValue;
}

export function getMaxConcurrentRequests() {
  return getConfigValue('maxConcurrentRequests', 5);
}

export function getTestApiKey() {
  return resolveInternalApiKey({
    serviceName: 'ai-slots',
    settingName: 'testApiKey',
    configuredValue: getConfigValue('testApiKey', null),
    envNames: ['AI_SLOTS_API_KEY'],
  });
}

export function getConfidenceThreshold() {
  const threshold = getConfigValue('confidenceThreshold', 0.6);
  // Валидация: порог должен быть в диапазоне 0.3-0.9
  if (threshold < 0.3) {
    return 0.3;
  }
  if (threshold > 0.9) {
    return 0.9;
  }
  return threshold;
}

export function getAiGatewayUrl() {
  return getConfigValue('aiGatewayUrl', 'http://localhost:3001');
}

export function getAiGatewayApiKey() {
  return resolveInternalApiKey({
    serviceName: 'ai-slots',
    settingName: 'aiGatewayApiKey',
    configuredValue: getConfigValue('aiGatewayApiKey', null),
    envNames: ['AI_GATEWAY_API_KEY'],
  });
}

export function validateSecurityConfig() {
  getTestApiKey();
  getAiGatewayApiKey();
}

// Читаем промпт из файла
function readPromptFile(filename) {
  try {
    const promptPath = join(__dirname, '../../prompts', filename);
    return readFileSync(promptPath, 'utf-8');
  } catch (error) {
    console.warn(`Не удалось прочитать промпт из файла ${filename}, используется дефолтный`);
    return null;
  }
}

// Дефолтный промпт (используется если файл не найден)
function getDefaultSlotExtractionPrompt() {
  return `Ты - система извлечения слотов из текста пользователя. 
Проанализируй текст и определи, какие слоты из списка могут содержаться в сообщении.

Доступные слоты:
{SLOTS_DESCRIPTIONS}

ВАЖНО:
1. Используй только слоты из списка выше
2. Не используй ключевые слова или простые совпадения
3. Анализируй семантический смысл текста
4. Верни JSON массив объектов с полями: name (имя слота), value (извлеченное значение), confidence (0.0-1.0)
5. Если слот не найден в тексте, не включай его в результат
6. Никогда не извлекай слот "исполнитель" из бюджетных/ценовых фраз ("за 1000", "до 3000", "от 1500"), жанров ("рок", "рэп", "джаз"), категорий ("концерты", "театры", "выставки") или дат/времени/периодов ("через неделю", "через месяц", "через год", "на следующей неделе", "в выходные", "вечером").
7. Если в сообщении одновременно есть жанр/категория и дата ("реп концерт через месяц", "рок концерт через 2 недели"), верни профильные слоты: жанр + тип_мероприятия + дата_события, но НЕ "исполнитель".
8. Если пользователь ищет детские мероприятия и указывает возраст в любой форме ("6+", "6 лет", "от 6 лет", "до 6 лет", "шестилетний"), верни "возрастное_ограничение=дети" и дополнительный слот "возраст_ребенка" со значением только числом, например "6".

Формат ответа (только JSON, без дополнительного текста):
[
  {"name": "название_слота", "value": "извлеченное значение", "confidence": 0.85},
  ...
]`;
}

function getDefaultDateNormalizationPrompt() {
  return [
    'Ты нормализуешь уже извлеченный слот даты для поиска мероприятий.',
    'Верни строго JSON-объект без пояснений и markdown.',
    'Формат ответа:',
    '{"resolved":true,"confidence":0.9,"parsedDate":"YYYY-MM-DD"|null,"dateRange":{"startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD"}|null,"reason":"short"}',
    'Если нормализовать дату нельзя без догадок, верни {"resolved":false,"confidence":0.0,"parsedDate":null,"dateRange":null,"reason":"unresolved"}.',
    'Правила:',
    '- Используй referenceDate как текущую календарную дату.',
    '- Для периодов вида "в следующем месяце", "через месяц", "в мае" возвращай полный календарный месяц в dateRange.',
    '- Для периодов вида "через неделю", "через две недели", "на следующей неделе" возвращай календарную неделю с понедельника по воскресенье.',
    '- Для "выходных" возвращай диапазон суббота-воскресенье.',
    '- Для точной даты возвращай parsedDate. dateRange добавляй только если в фразе явно указан диапазон.',
    '- Можешь использовать sourceText только для снятия неоднозначности. Нельзя выдумывать дату, которой нет в слоте или sourceText.',
    '- Все даты возвращай в ISO формате YYYY-MM-DD.',
  ].join('\n');
}

export function getSlotExtractionPrompt() {
  // Сначала пытаемся прочитать из файла
  const filePrompt = readPromptFile('slotExtractionPrompt.txt');
  const resolvedPrompt =
    filePrompt || getConfigValue('slotExtractionPrompt', null) || getDefaultSlotExtractionPrompt();

  return `${resolvedPrompt}\n\n${buildEventTaxonomyPrompt()}`;
}

export function getDateNormalizationPrompt() {
  const filePrompt = readPromptFile('dateNormalizationPrompt.txt');
  return (
    filePrompt ||
    getConfigValue('dateNormalizationPrompt', null) ||
    getDefaultDateNormalizationPrompt()
  );
}
