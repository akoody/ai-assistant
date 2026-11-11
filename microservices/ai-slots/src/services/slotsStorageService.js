import { getCollection } from './database.js';

function formatDateToISO(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString().split('T')[0];
}

/**
 * Сохраняет извлеченные слоты в модель пользователя
 * @param {string} userId - ID пользователя
 * @param {string} text - Исходный текст
 * @param {Array} slots - Массив извлеченных слотов [{name, value, confidence}]
 */
export async function saveExtractedSlots(userId, text, slots) {
  try {
    if (!userId) {
      throw new Error('userId обязателен для сохранения слотов');
    }

    const collection = await getCollection('users');
    const extractedAt = new Date();

    // Формируем слоты с timestamp и парсированными датами
    const slotsWithTimestamp = slots.map((slot) => {
      const slotData = {
        name: slot.name,
        value: slot.value,
        confidence: slot.confidence,
        extractedAt,
        createdAt: new Date(),
      };

      // Добавляем парсированную дату, если есть
      if (slot.parsedDate) {
        const parsedDate =
          slot.parsedDate instanceof Date ? slot.parsedDate : new Date(slot.parsedDate);
        slotData.parsedDate = parsedDate;
        slotData.normalizedValue = formatDateToISO(parsedDate);
        console.log(`Добавлен parsedDate для слота ${slot.name}: ${slotData.parsedDate}`);
      }

      // Добавляем диапазон дат, если есть
      if (slot.dateRange) {
        const startDate =
          slot.dateRange.startDate instanceof Date
            ? slot.dateRange.startDate
            : new Date(slot.dateRange.startDate);
        const endDate =
          slot.dateRange.endDate instanceof Date
            ? slot.dateRange.endDate
            : new Date(slot.dateRange.endDate);
        slotData.dateRange = {
          startDate,
          endDate,
        };
        slotData.normalizedRange = {
          startDate: formatDateToISO(startDate),
          endDate: formatDateToISO(endDate),
        };
        console.log(
          `Добавлен dateRange для слота ${slot.name}: ${slotData.dateRange.startDate} - ${slotData.dateRange.endDate}`
        );
      }

      // Добавляем диапазон времени, если есть
      if (slot.timeRange) {
        // Поддерживаем как старый формат (Date объекты), так и новый (простые числа)
        if (slot.timeRange.startHour !== undefined && slot.timeRange.startMinute !== undefined) {
          // Новый формат: простые числа (часы и минуты)
          slotData.timeRange = {
            startHour: slot.timeRange.startHour,
            startMinute: slot.timeRange.startMinute,
            endHour: slot.timeRange.endHour,
            endMinute: slot.timeRange.endMinute,
          };
          console.log(
            `Добавлен timeRange для слота ${slot.name}: ${slot.timeRange.startHour}:${String(slot.timeRange.startMinute).padStart(2, '0')} - ${slot.timeRange.endHour}:${String(slot.timeRange.endMinute).padStart(2, '0')}`
          );
        } else if (slot.timeRange.startTime) {
          // Старый формат: Date объекты (для обратной совместимости)
          const startTime =
            slot.timeRange.startTime instanceof Date
              ? slot.timeRange.startTime
              : new Date(slot.timeRange.startTime);
          const endTime =
            slot.timeRange.endTime instanceof Date
              ? slot.timeRange.endTime
              : new Date(slot.timeRange.endTime);
          slotData.timeRange = {
            startTime,
            endTime,
          };
          console.log(
            `Добавлен timeRange (старый формат) для слота ${slot.name}: ${slotData.timeRange.startTime} - ${slotData.timeRange.endTime}`
          );
        }
      }

      return slotData;
    });

    // Проверяем существующие слоты перед сохранением
    const existingUser = await collection.findOne({ userId });
    if (existingUser && existingUser.slots) {
      console.log(
        `[saveExtractedSlots] 🔍 До сохранения: в БД для userId ${userId} уже есть ${existingUser.slots.length} слотов`
      );
      console.log(
        `[saveExtractedSlots] Существующие слоты:`,
        existingUser.slots.map((s) => `${s.name}: "${s.value}"`)
      );
    } else {
      console.log(
        `[saveExtractedSlots] 🔍 До сохранения: пользователь ${userId} не найден в БД, будет создан новый`
      );
    }

    // Обновляем или создаем пользователя, добавляя слоты в массив
    console.log(
      `[saveExtractedSlots] Пытаемся сохранить ${slotsWithTimestamp.length} слотов для userId: ${userId}`
    );
    const result = await collection.updateOne(
      { userId },
      {
        $set: {
          updatedAt: new Date(),
        },
        $push: {
          slots: {
            $each: slotsWithTimestamp,
          },
        },
        $setOnInsert: {
          userId,
          createdAt: new Date(),
        },
      },
      { upsert: true }
    );

    console.log(
      `[saveExtractedSlots] Результат MongoDB: modifiedCount=${result.modifiedCount}, matchedCount=${result.matchedCount}, upsertedCount=${result.upsertedCount}`
    );
    console.log(`[saveExtractedSlots] Сохранено ${slots.length} слотов для пользователя ${userId}`);

    // Проверяем успешность операции
    if (result.modifiedCount === 0 && result.matchedCount === 0 && result.upsertedCount === 0) {
      console.error(`[saveExtractedSlots] КРИТИЧЕСКАЯ ОШИБКА: MongoDB операция не применилась!`);
      console.error(`[saveExtractedSlots] userId: ${userId}`);
      console.error(
        `[saveExtractedSlots] Слоты для сохранения:`,
        JSON.stringify(slotsWithTimestamp, null, 2)
      );
      throw new Error('MongoDB операция не применилась: нет изменений');
    }

    // Проверяем, что данные действительно сохранились
    const savedUser = await collection.findOne({ userId });
    if (savedUser && savedUser.slots) {
      console.log(
        `[saveExtractedSlots] ✅ Проверка успешна: в БД для userId ${userId} сейчас ${savedUser.slots.length} слотов`
      );
      console.log(
        `[saveExtractedSlots] Все слоты в БД:`,
        savedUser.slots.map((s) => `${s.name}: "${s.value}" (extractedAt: ${s.extractedAt})`)
      );
      console.log(
        `[saveExtractedSlots] Последние сохраненные слоты:`,
        savedUser.slots.slice(-slots.length).map((s) => s.name)
      );
    } else {
      console.error(
        `[saveExtractedSlots] ❌ КРИТИЧЕСКАЯ ОШИБКА: пользователь ${userId} не найден в БД после сохранения!`
      );
      console.error(
        `[saveExtractedSlots] Результат MongoDB указывал на успех, но данные не найдены!`
      );
      throw new Error(`Пользователь ${userId} не найден в БД после сохранения`);
    }

    return result;
  } catch (error) {
    console.error('Ошибка сохранения слотов:', error);
    throw error;
  }
}

/**
 * Получает слоты пользователя с фильтрами
 * @param {string} userId - ID пользователя
 * @param {Object} filters - Фильтры {dateFrom, dateTo, slotName}
 */
export async function getUserSlots(userId, filters = {}) {
  try {
    if (!userId) {
      throw new Error('userId обязателен для получения слотов');
    }

    const collection = await getCollection('users');
    const user = await collection.findOne({ userId });

    if (!user || !user.slots || user.slots.length === 0) {
      return [];
    }

    let slots = user.slots;

    // Применяем фильтры
    if (filters.dateFrom) {
      slots = slots.filter((slot) => slot.extractedAt >= filters.dateFrom);
    }
    if (filters.dateTo) {
      slots = slots.filter((slot) => slot.extractedAt <= filters.dateTo);
    }
    if (filters.slotName) {
      slots = slots.filter((slot) => slot.name === filters.slotName);
    }

    // Сортируем по дате извлечения (новые сначала)
    slots.sort((a, b) => b.extractedAt - a.extractedAt);

    return slots;
  } catch (error) {
    console.error('Ошибка получения слотов пользователя:', error);
    throw error;
  }
}

/**
 * Получает пользователя со всеми данными
 * @param {string} userId - ID пользователя
 */
export async function getUser(userId) {
  try {
    if (!userId) {
      throw new Error('userId обязателен');
    }

    const collection = await getCollection('users');
    const user = await collection.findOne({ userId });

    return user;
  } catch (error) {
    console.error('Ошибка получения пользователя:', error);
    throw error;
  }
}
