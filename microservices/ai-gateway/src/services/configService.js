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
    const config = await collection.findOne({ serviceName: 'ai-gateway' });

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
    serviceName: 'ai-gateway',
    settingName: 'testApiKey',
    configuredValue: getConfigValue('testApiKey', null),
    envNames: ['AI_GATEWAY_API_KEY'],
  });
}

export function getLLMs() {
  return getConfigValue('llms', []).map((llm) => {
    const envName =
      llm.apiKeyEnv ||
      ((llm.provider || 'polza').toLowerCase() === 'polza' ? 'POLZA_API_KEY' : null);
    const apiKey = envName ? String(process.env[envName] || '').trim() : '';
    return apiKey ? { ...llm, apiKey } : llm;
  });
}

export function validateSecurityConfig() {
  getTestApiKey();
}
