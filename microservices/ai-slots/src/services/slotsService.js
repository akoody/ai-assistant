import NodeCache from 'node-cache';
import { getCollection } from './database.js';

const slotsCache = new NodeCache({ stdTTL: 60 }); // Обновление каждую минуту
let updateInterval = null;

export async function initSlotsService() {
  await updateSlotsCache();

  // Обновляем каждую минуту
  updateInterval = setInterval(async () => {
    await updateSlotsCache();
  }, 60000);

  console.log('Сервис слотов инициализирован');
}

export function stopSlotsService() {
  if (updateInterval) {
    clearInterval(updateInterval);
    updateInterval = null;
  }
}

async function updateSlotsCache() {
  try {
    const collection = await getCollection('slots');
    const slots = await collection.find({}).toArray();

    if (slots && slots.length > 0) {
      slotsCache.set('slots', slots);
      console.log(`Загружено ${slots.length} слотов в кеш`);
    }
  } catch (error) {
    console.error('Ошибка обновления слотов:', error);
  }
}

export function getSlots() {
  return slotsCache.get('slots') || [];
}

export function getSlotsWithDescriptions() {
  const slots = getSlots();
  return slots.map((slot) => ({
    name: slot.name,
    description: slot.description,
    type: slot.type,
  }));
}
