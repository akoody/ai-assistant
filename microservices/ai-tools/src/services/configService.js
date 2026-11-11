import NodeCache from 'node-cache';
import { getCollection } from './database.js';
import { loadRootEnv, resolveInternalApiKey } from '../../../../shared/runtimeEnv.js';

loadRootEnv(import.meta.url);

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
    const config = await collection.findOne({ serviceName: 'ai-tools' });

    if (config) {
      configCache.set('config', config);
      console.log('Конфигурация ai-tools обновлена из БД');
    }
  } catch (error) {
    console.error('Ошибка обновления конфигурации:', error);
  }
}

function getConfigValue(key, defaultValue = null) {
  const config = configCache.get('config');
  if (!config) {
    return defaultValue;
  }
  return config[key] !== undefined ? config[key] : defaultValue;
}

export function getMaxConcurrentRequests() {
  return getConfigValue('maxConcurrentRequests', 5);
}

export function getTestApiKey() {
  return resolveInternalApiKey({
    serviceName: 'ai-tools',
    settingName: 'testApiKey',
    configuredValue: getConfigValue('testApiKey', null),
    envNames: ['AI_TOOLS_API_KEY'],
  });
}

export function getKassirApiToken() {
  return String(process.env.KASSIR_API_TOKEN || '').trim() || getConfigValue('kassirApiToken', '');
}

export function getKassirApiUrl() {
  return getConfigValue('kassirApiUrl', 'https://api.kassir.ru');
}

export function getAiGatewayUrl() {
  return getConfigValue('aiGatewayUrl', 'http://localhost:3001');
}

export function getAiGatewayApiKey() {
  return resolveInternalApiKey({
    serviceName: 'ai-tools',
    settingName: 'aiGatewayApiKey',
    configuredValue: getConfigValue('aiGatewayApiKey', null),
    envNames: ['AI_GATEWAY_API_KEY'],
  });
}

export function validateSecurityConfig() {
  getTestApiKey();
  getAiGatewayApiKey();
}
