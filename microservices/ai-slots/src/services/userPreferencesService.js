import { getCollection } from './database.js';
import {
  PREFERENCE_TYPES,
  SLOT_TO_PREFERENCE_MAP,
  buildPreferenceRemoveDescriptor,
  buildPreferenceUpdateDescriptor,
  isBudgetPreferenceSlotName,
  mergePriceRangeWithSlot,
  shouldSkipPreferenceSave,
} from '../../../../shared/preferenceRules.js';

export async function savePreference(userId, preferenceType, value, isNegative = false) {
  try {
    const collection = await getCollection('user_preferences');
    const now = new Date();

    console.log(
      `[userPreferencesService] Сохранение предпочтения для userId ${userId}: ${preferenceType} = ${JSON.stringify(value)} (negative: ${isNegative})`
    );
    const descriptor = buildPreferenceUpdateDescriptor({
      userId,
      preferenceType,
      value,
      isNegative,
      now,
    });

    if (!descriptor) {
      console.warn(
        `[userPreferencesService] Неизвестный или пустой тип предпочтения: ${preferenceType}`
      );
      return;
    }

    const result = await collection.updateOne({ userId }, descriptor.updateOperation, {
      upsert: true,
    });

    console.log(
      `[userPreferencesService] ✅ Предпочтение сохранено: ${preferenceType} = ${JSON.stringify(value)} (modified: ${result.modifiedCount}, upserted: ${result.upsertedCount})`
    );
  } catch (error) {
    console.error(
      `[userPreferencesService] Ошибка сохранения предпочтения для userId ${userId}:`,
      error
    );
    throw error;
  }
}

/**
 * Удаляет предпочтение пользователя
 */
export async function removePreference(userId, preferenceType, value) {
  try {
    const collection = await getCollection('user_preferences');
    const now = new Date();

    console.log(
      `[userPreferencesService] Удаление предпочтения для userId ${userId}: ${preferenceType} = ${JSON.stringify(value)}`
    );
    const descriptor = buildPreferenceRemoveDescriptor({
      preferenceType,
      value,
      now,
    });

    if (!descriptor) {
      console.warn(
        `[userPreferencesService] Неизвестный или пустой тип предпочтения для удаления: ${preferenceType}`
      );
      return;
    }

    const result = await collection.updateOne({ userId }, descriptor.updateOperation);

    console.log(
      `[userPreferencesService] ✅ Предпочтение удалено: ${preferenceType} = ${JSON.stringify(value)} (modified: ${result.modifiedCount})`
    );
  } catch (error) {
    console.error(
      `[userPreferencesService] Ошибка удаления предпочтения для userId ${userId}:`,
      error
    );
    throw error;
  }
}

async function getCurrentPriceRange(userId) {
  try {
    const collection = await getCollection('user_preferences');
    const preferences = await collection.findOne({ userId });
    return preferences?.priceRange || {};
  } catch (error) {
    console.error(
      `[userPreferencesService] Ошибка получения ценового диапазона для userId ${userId}:`,
      error
    );
    return {};
  }
}

export async function savePreferencesFromSlots(userId, slots, options = {}) {
  try {
    if (!Array.isArray(slots) || slots.length === 0) {
      return;
    }

    const sourceText = typeof options?.sourceText === 'string' ? options.sourceText : '';
    const intents = Array.isArray(options?.intents) ? options.intents : [];

    console.log(
      `[userPreferencesService] Анализ ${slots.length} слотов для сохранения предпочтений userId ${userId}`
    );

    for (const slot of slots) {
      const preferenceType = SLOT_TO_PREFERENCE_MAP[slot.name];

      if (!preferenceType) {
        continue;
      }

      if (shouldSkipPreferenceSave({ slot, preferenceType, sourceText, intents })) {
        continue;
      }

      if (isBudgetPreferenceSlotName(slot.name)) {
        const currentPriceRange = await getCurrentPriceRange(userId);
        const priceRange = mergePriceRangeWithSlot(currentPriceRange, slot);

        await savePreference(userId, PREFERENCE_TYPES.PRICE_RANGE, priceRange);
      } else {
        await savePreference(userId, preferenceType, slot.value, slot.isNegative || false);
      }
    }
  } catch (error) {
    console.error(
      `[userPreferencesService] Ошибка сохранения предпочтений из слотов для userId ${userId}:`,
      error
    );
  }
}

export { PREFERENCE_TYPES };
