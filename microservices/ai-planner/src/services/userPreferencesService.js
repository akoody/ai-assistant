import { getCollection } from './database.js';
import {
  PREFERENCE_TYPES,
  SLOT_TO_PREFERENCE_MAP,
  buildEmptyUserPreferences,
  buildPreferenceClearDescriptor,
  buildPreferenceUpdateDescriptor,
  isBudgetPreferenceSlotName,
  mergePriceRangeWithSlot,
  normalizeStoredPreferencesDocument,
  normalizePreferenceToken,
  shouldSkipPreferenceSave,
} from '../../../../shared/preferenceRules.js';

export async function getUserPreferences(userId) {
  try {
    const collection = await getCollection('user_preferences');
    const preferences = await collection.findOne({ userId });

    if (!preferences) {
      return buildEmptyUserPreferences(userId);
    }

    return normalizeStoredPreferencesDocument(preferences, userId);
  } catch (error) {
    console.error(
      `[userPreferencesService] Ошибка получения предпочтений для userId ${userId}:`,
      error
    );
    throw error;
  }
}

export async function savePreference(userId, preferenceType, value, isNegative = false) {
  try {
    const collection = await getCollection('user_preferences');
    const now = new Date();

    console.log(
      `[userPreferencesService] Сохранение предпочтения для userId ${userId}: ${preferenceType} = ${JSON.stringify(value)}`
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

export async function saveDislikedPreference(userId, preferenceType, value) {
  try {
    const collection = await getCollection('user_preferences');
    const now = new Date();

    console.log(
      `[userPreferencesService] Сохранение НЕжелательного предпочтения для userId ${userId}: ${preferenceType} = ${JSON.stringify(value)}`
    );

    const descriptor = buildPreferenceUpdateDescriptor({
      userId,
      preferenceType,
      value,
      isNegative: true,
      now,
    });

    if (!descriptor) {
      console.warn(
        `[userPreferencesService] Неизвестный или пустой тип НЕжелательного предпочтения: ${preferenceType}`
      );
      return;
    }

    const result = await collection.updateOne({ userId }, descriptor.updateOperation, {
      upsert: true,
    });

    console.log(
      `[userPreferencesService] ✅ НЕжелательное предпочтение сохранено: ${preferenceType} = ${JSON.stringify(value)} (modified: ${result.modifiedCount}, upserted: ${result.upsertedCount})`
    );
  } catch (error) {
    console.error(
      `[userPreferencesService] Ошибка сохранения НЕжелательного предпочтения для userId ${userId}:`,
      error
    );
    throw error;
  }
}

export async function removeDislikedPreference(userId, preferenceType, value) {
  try {
    if (!userId || value === undefined || value === null) {
      return;
    }

    const collection = await getCollection('user_preferences');
    const now = new Date();
    let normalizedValue = null;
    let pullField = null;

    switch (preferenceType) {
      case PREFERENCE_TYPES.GENRE:
        normalizedValue = normalizePreferenceToken(value);
        pullField = 'dislikedGenres';
        break;
      case PREFERENCE_TYPES.EVENT_TYPE:
        normalizedValue = normalizePreferenceToken(value);
        pullField = 'dislikedEventTypes';
        break;
      case PREFERENCE_TYPES.ARTIST:
        normalizedValue = String(value || '').trim();
        pullField = 'dislikedArtists';
        break;
      default:
        return;
    }

    if (!normalizedValue || !pullField) {
      return;
    }

    const result = await collection.updateOne(
      { userId },
      {
        $pull: { [pullField]: normalizedValue },
        $set: { updatedAt: now },
      }
    );

    console.log(
      `[userPreferencesService] ✅ Удалено НЕжелательное предпочтение: ${preferenceType} = ${JSON.stringify(normalizedValue)} ` +
        `(modified: ${result.modifiedCount}, matched: ${result.matchedCount})`
    );
  } catch (error) {
    console.error(
      `[userPreferencesService] Ошибка удаления НЕжелательного предпочтения для userId ${userId}:`,
      error
    );
    throw error;
  }
}

export async function savePreferencesFromSlots(userId, slots, options = {}) {
  try {
    if (!Array.isArray(slots) || slots.length === 0) {
      return;
    }

    console.log(
      `[userPreferencesService] Анализ слотов для сохранения предпочтений userId ${userId}`
    );

    const sourceText = typeof options?.sourceText === 'string' ? options.sourceText : '';
    const intents = Array.isArray(options?.intents) ? options.intents : [];

    for (const slot of slots) {
      const preferenceType = SLOT_TO_PREFERENCE_MAP[slot.name];

      if (!preferenceType) {
        continue;
      }

      if (shouldSkipPreferenceSave({ slot, preferenceType, sourceText, intents })) {
        continue;
      }

      if (isBudgetPreferenceSlotName(slot.name)) {
        const preferences = await getUserPreferences(userId);
        const currentPriceRange = preferences.priceRange || {};
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
    throw error;
  }
}

export function arePreferencesFresh(preferences, daysThreshold = 30) {
  if (!preferences || !preferences.updatedAt) {
    return false;
  }

  const now = new Date();
  const lastUpdate = new Date(preferences.updatedAt);
  const daysDiff = (now - lastUpdate) / (1000 * 60 * 60 * 24);

  return daysDiff <= daysThreshold;
}

export async function clearPreference(userId, preferenceType) {
  try {
    const collection = await getCollection('user_preferences');
    const now = new Date();
    const descriptor = buildPreferenceClearDescriptor({
      preferenceType,
      now,
    });

    if (!descriptor) {
      console.warn(
        `[userPreferencesService] Неизвестный тип предпочтения для очистки: ${preferenceType}`
      );
      return;
    }

    await collection.updateOne({ userId }, descriptor.updateOperation);

    console.log(`[userPreferencesService] ✅ Предпочтение очищено: ${preferenceType}`);
  } catch (error) {
    console.error(
      `[userPreferencesService] Ошибка очистки предпочтения для userId ${userId}:`,
      error
    );
    throw error;
  }
}

export async function resetUserPreferences(userId) {
  try {
    if (!userId) {
      return;
    }

    const collection = await getCollection('user_preferences');
    const result = await collection.deleteOne({ userId });

    console.log(
      `[userPreferencesService] ✅ Все предпочтения пользователя сброшены для userId ${userId} ` +
        `(deleted: ${result.deletedCount})`
    );
  } catch (error) {
    console.error(
      `[userPreferencesService] Ошибка полного сброса предпочтений для userId ${userId}:`,
      error
    );
    throw error;
  }
}

export function formatPreferencesDescription(preferences) {
  const parts = [];

  if (preferences.genres && preferences.genres.length > 0) {
    parts.push(`жанры: ${preferences.genres.join(', ')}`);
  }

  if (preferences.artists && preferences.artists.length > 0) {
    parts.push(`исполнители: ${preferences.artists.join(', ')}`);
  }

  if (preferences.eventTypes && preferences.eventTypes.length > 0) {
    parts.push(`типы событий: ${preferences.eventTypes.join(', ')}`);
  }

  // Добавляем информацию о том, что НЕ нравится пользователю
  const dislikedParts = [];

  if (preferences.dislikedGenres && preferences.dislikedGenres.length > 0) {
    dislikedParts.push(`НЕ любит жанры: ${preferences.dislikedGenres.join(', ')}`);
  }

  if (preferences.dislikedArtists && preferences.dislikedArtists.length > 0) {
    dislikedParts.push(`НЕ любит исполнителей: ${preferences.dislikedArtists.join(', ')}`);
  }

  if (preferences.dislikedEventTypes && preferences.dislikedEventTypes.length > 0) {
    dislikedParts.push(`НЕ любит типы событий: ${preferences.dislikedEventTypes.join(', ')}`);
  }

  if (preferences.priceRange) {
    const { min, max } = preferences.priceRange;
    if (min && max) {
      parts.push(`бюджет: ${min}-${max} ₽`);
    } else if (max) {
      parts.push(`бюджет: до ${max} ₽`);
    } else if (min) {
      parts.push(`бюджет: от ${min} ₽`);
    }
  }

  if (preferences.city) {
    parts.push(`город: ${preferences.city}`);
  }

  // Объединяем позитивные и негативные предпочтения
  const allParts = [...parts, ...dislikedParts];

  return allParts.length > 0 ? allParts.join(', ') : 'нет сохраненных предпочтений';
}

export { PREFERENCE_TYPES };
