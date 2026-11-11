import { getAiSlotsUrl, getAiSlotsApiKey } from './configService.js';
import { getCollection } from './database.js';
import { normalizeCityButton } from './offerService.js';
import { isMeaningfulPreferenceSlotValue } from './preferenceMemoryService.js';
import { coalesceDateSlotsIntoRange } from './dateParsingUtils.js';

const CROSS_SESSION_PERMANENT_SLOT_NAMES = ['город'];
const MULTI_VALUE_SESSION_SLOT_NAMES = new Set([
  'жанр',
  'жанр_музыки',
  'предпочтения_жанры',
  'исполнитель',
]);

export async function saveSlotToDatabase(userId, slot) {
  try {
    if (!userId || !slot || !slot.name) {
      console.error(
        `❌ [saveSlotToDatabase] Невалидные параметры: userId=${userId}, slot=${JSON.stringify(slot)}`
      );
      return null;
    }

    const collection = await getCollection('users');
    const extractedAt = new Date();
    const normalizedSlot = normalizeSlotForRuntime(slot, { userId, source: 'saveSlotToDatabase' });
    if (!normalizedSlot) {
      return null;
    }

    const slotData = {
      name: normalizedSlot.name,
      value: normalizedSlot.value,
      confidence: normalizedSlot.confidence || 0.9,
      extractedAt,
      createdAt: new Date(),
    };
    if (normalizedSlot.parsedDate) {
      slotData.parsedDate = normalizedSlot.parsedDate;
    }
    if (normalizedSlot.dateRange) {
      slotData.dateRange = normalizedSlot.dateRange;
    }
    if (normalizedSlot.timeRange) {
      slotData.timeRange = normalizedSlot.timeRange;
    }
    if (normalizedSlot.normalizedRange) {
      slotData.normalizedRange = normalizedSlot.normalizedRange;
    }
    if (normalizedSlot.source) {
      slotData.source = normalizedSlot.source;
    }

    console.log(
      `💾 [saveSlotToDatabase] Сохраняю слот "${slotData.name}": "${slotData.value}" для userId: ${userId}`
    );

    const result = await collection.updateOne(
      { userId },
      {
        $set: {
          updatedAt: new Date(),
        },
        $push: {
          slots: slotData,
        },
        $setOnInsert: {
          userId,
          createdAt: new Date(),
        },
      },
      { upsert: true }
    );

    console.log(
      `💾 [saveSlotToDatabase] Результат: modifiedCount=${result.modifiedCount}, matchedCount=${result.matchedCount}, upsertedCount=${result.upsertedCount}`
    );

    return result;
  } catch (error) {
    console.error(`❌ [saveSlotToDatabase] Ошибка сохранения слота:`, error);
    return null;
  }
}

export async function clearUserSlots(userId) {
  try {
    if (!userId) {
      return null;
    }

    const collection = await getCollection('users');
    const result = await collection.updateOne(
      { userId },
      {
        $set: {
          slots: [],
          updatedAt: new Date(),
        },
      }
    );

    console.log(
      `🧹 [clearUserSlots] Очищены рабочие слоты пользователя userId=${userId} ` +
        `(modifiedCount=${result.modifiedCount}, matchedCount=${result.matchedCount})`
    );

    return result;
  } catch (error) {
    console.error(
      `❌ [clearUserSlots] Ошибка очистки слотов пользователя userId=${userId}:`,
      error
    );
    throw error;
  }
}

export async function removeSlotsFromDatabase(userId, slotsToRemove = []) {
  try {
    if (!userId || !Array.isArray(slotsToRemove) || slotsToRemove.length === 0) {
      return null;
    }

    const pullConditions = slotsToRemove
      .filter((slot) => slot && slot.name && slot.value !== undefined && slot.value !== null)
      .map((slot) => ({
        name: String(slot.name).trim(),
        value: String(slot.value).trim(),
      }))
      .filter((slot) => slot.name && slot.value);

    if (pullConditions.length === 0) {
      return null;
    }

    const collection = await getCollection('users');
    const result = await collection.updateOne(
      { userId },
      {
        $pull: {
          slots: {
            $or: pullConditions,
          },
        },
        $set: {
          updatedAt: new Date(),
        },
      }
    );

    console.log(
      `🧹 [removeSlotsFromDatabase] Удалены слоты пользователя userId=${userId}: ` +
        pullConditions.map((slot) => `${slot.name}="${slot.value}"`).join(', ') +
        ` (modifiedCount=${result.modifiedCount}, matchedCount=${result.matchedCount})`
    );

    return result;
  } catch (error) {
    console.error(
      `❌ [removeSlotsFromDatabase] Ошибка удаления слотов пользователя userId=${userId}:`,
      error
    );
    throw error;
  }
}

/**
 * Маппинг названий слотов к стандартным названиям
 * Приводит все варианты названий к единому стандарту
 */
const slotNameNormalization = {
  // Варианты даты события -> стандартное название
  концерт_дата: 'дата_события',
  спектакль_дата: 'дата_события',
  выставка_дата: 'дата_события',
  дата: 'дата_события',
  event_date: 'дата_события',
  // Варианты города -> стандартное название
  city: 'город',
  // Варианты исполнителя
  артист: 'исполнитель',
  исполнители: 'исполнитель',
  исполнитель: 'исполнитель',
  artist: 'исполнитель',
  performer: 'исполнитель',
  группа: 'исполнитель',
  персона: 'исполнитель',
};

/**
 * Нормализует название слота к стандартному
 * @param {string} slotName - Исходное название слота
 * @returns {string} - Нормализованное название
 */
export function normalizeSlotName(slotName) {
  return slotNameNormalization[slotName] || slotName;
}

function normalizeSlotValue(slotName, value) {
  if (value === undefined || value === null) {
    return value;
  }

  let normalized = String(value).trim();
  if (!normalized) {
    return normalized;
  }

  if (!isMeaningfulPreferenceSlotValue(slotName, normalized)) {
    return '';
  }

  if (slotName === 'исполнитель') {
    normalized = normalized.replace(/^(?:а|и|ну|а ну|а и)\s+/iu, '').trim();
    normalized = normalized
      .replace(/^["'«]+/u, '')
      .replace(/["'»]+$/u, '')
      .trim();
    normalized = normalized.replace(/[?!.]+$/u, '').trim();
  }

  if (slotName === 'жанр' || slotName === 'жанр_музыки' || slotName === 'предпочтения_жанры') {
    const lowered = normalized.toLowerCase().replace(/ё/g, 'е').trim();
    if (
      /^(концерт|концерты|театр|театры|выставка|выставки|музей|музеи|шоу|стендап|стэндап|спорт|кино|экскурсия|экскурсии|фестиваль|фестивали)$/u.test(
        lowered
      )
    ) {
      return '';
    }
  }

  if (slotName === 'возрастное_ограничение') {
    const lowered = normalized.toLowerCase();
    // КРИТИЧЕСКИ ВАЖНО: "семейное" без упоминания детей/ребёнка = взрослая категория
    // Проверяем сначала явные признаки детской категории
    if (
      /(дет|kid|реб|малыш)\w*/u.test(lowered) &&
      !/(бабушк|бабк|бабул|дедушк|дедул|(?<![A-Za-zА-Яа-яЁё0-9_])дед(?:а|у|ом|е)?(?:(?<=[A-Za-zА-Яа-яЁё0-9_])(?![A-Za-zА-Яа-яЁё0-9_])|(?<![A-Za-zА-Яа-яЁё0-9_])(?=[A-Za-zА-Яа-яЁё0-9_]))|родител|взросл)/u.test(
        lowered
      )
    ) {
      normalized = 'дети';
    } else if (
      /(взросл|18\+|only adults|adult|бабушк|бабк|бабул|дедушк|дедул|(?<![A-Za-zА-Яа-яЁё0-9_])дед(?:а|у|ом|е)?(?:(?<=[A-Za-zА-Яа-яЁё0-9_])(?![A-Za-zА-Яа-яЁё0-9_])|(?<![A-Za-zА-Яа-яЁё0-9_])(?=[A-Za-zА-Яа-яЁё0-9_]))|пожил)/u.test(
        lowered
      )
    ) {
      // Взрослая категория: явные признаки взрослого контента или упоминание пожилых людей
      normalized = 'взрослые';
    } else if (/(молод|youth|teen|подрост)/u.test(lowered)) {
      normalized = 'молодёжь';
    } else if (/(семейн|family)/u.test(lowered)) {
      // "Семейное" без контекста - по умолчанию считаем взрослой категорией
      // (так как "с бабушкой" = семейное, но для взрослых)
      normalized = 'взрослые';
    }
  }

  return normalized;
}

function normalizeSlotForRuntime(slot, { userId = '', source = 'runtime' } = {}) {
  if (!slot || !slot.name) {
    return null;
  }

  const rawName = String(slot.name).trim();
  const normalizedName = normalizeSlotName(rawName);
  if (!normalizedName) {
    return null;
  }

  const normalizedValue = normalizeSlotValue(normalizedName, slot.value);
  if (normalizedValue === undefined || normalizedValue === null) {
    return null;
  }

  if (typeof normalizedValue === 'string' && normalizedValue.trim().length === 0) {
    console.log(
      `🧹 [${userId || 'unknown'}] Отбрасываю слот после planner-нормализации (${source}): ` +
        `${rawName}="${slot.value}"`
    );
    return null;
  }

  return {
    ...slot,
    name: normalizedName,
    value: normalizedValue,
  };
}

/**
 * Асинхронно отправляет запрос на извлечение слотов в AI Slots
 * Теперь ждем ответа для корректной работы проверки предложений
 * @param {string} text - Текст для анализа
 * @param {string} userId - ID пользователя
 */
export async function extractSlotsAsync(text, userId) {
  try {
    const aiSlotsUrl = getAiSlotsUrl();
    const apiKey = getAiSlotsApiKey();

    // Пользователи пишут на русском языке, нормализуем только "Другой город"
    const normalizedText = normalizeCityButton(text);
    if (normalizedText !== text) {
      console.log(
        `🔄 [${userId}] Нормализован текст перед извлечением слотов: "${text}" -> "${normalizedText}"`
      );
    }

    console.log(
      `🔍 [${userId}] Отправка запроса в AI Slots для извлечения слотов из текста: "${normalizedText}"`
    );

    // Отправляем запрос и ждем ответа
    const response = await fetch(`${aiSlotsUrl}/api/slots/extract`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: normalizedText,
        userId,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error(`❌ [${userId}] Ошибка запроса к AI Slots:`, response.status, errorData);
      return;
    }

    const data = await response.json();
    console.log(`📨 [${userId}] Ответ от AI Slots:`, JSON.stringify(data, null, 2));
    const rawExtractedSlots = Array.isArray(data.slots)
      ? data.slots
      : Array.isArray(data.extractedSlots)
        ? data.extractedSlots
        : [];
    const extractedSlots = rawExtractedSlots
      .map((slot) => normalizeSlotForRuntime(slot, { userId, source: 'extractSlotsAsync' }))
      .filter(Boolean);
    const detectedIntents = Array.isArray(data.intents) ? data.intents : [];

    if (rawExtractedSlots.length !== extractedSlots.length) {
      console.log(
        `🧹 [${userId}] Planner отбросил ${rawExtractedSlots.length - extractedSlots.length} слотов ` +
          `после нормализации ответа AI Slots`
      );
    }

    console.log(`✅ [${userId}] AI Slots вернул ${extractedSlots.length} слотов:`);
    extractedSlots.forEach((slot, index) => {
      console.log(
        `   ${index + 1}. ${slot.name}: "${slot.value}" (normalized: ${normalizeSlotName(slot.name)})`
      );
    });

    // Проверяем, был ли извлечен город
    const citySlot = extractedSlots.find((s) => normalizeSlotName(s.name) === 'город');
    if (
      !citySlot &&
      (text.toLowerCase().includes('москв') || text.toLowerCase().includes('город'))
    ) {
      console.warn(
        `⚠️ [${userId}] В тексте есть упоминание города, но AI Slots не извлек слот "город"`
      );
      console.warn(`   Текст: "${text}"`);
      console.warn(
        `   Извлеченные слоты:`,
        extractedSlots.map((s) => `${s.name}: "${s.value}"`).join(', ')
      );
    }
    if (detectedIntents.length > 0) {
      console.log(`✅ [${userId}] Обнаружены намерения: ${JSON.stringify(detectedIntents)}`);
    }

    return {
      slots: extractedSlots,
      intents: detectedIntents,
    };
  } catch (error) {
    console.error(`❌ [${userId}] Ошибка отправки запроса на извлечение слотов:`, error);
    return null;
  }
}

/**
 * Получает актуальные слоты пользователя из текущей сессии.
 * Между сессиями сохраняем только действительно контекстные слоты.
 * Долгосрочные предпочтения живут в user_preferences и не должны автоматически
 * превращаться в рабочие фильтры для каждого нового запроса.
 * @param {string} userId - ID пользователя
 * @param {string} sessionId - ID сессии
 */
export async function getCurrentSessionSlots(userId, sessionId) {
  try {
    const collection = await getCollection('users');
    const user = await collection.findOne({ userId });

    if (!user || !user.slots || user.slots.length === 0) {
      console.log(`📊 [${userId}][${sessionId}] Пользователь не найден или нет слотов`);
      return [];
    }

    // Получаем время начала сессии
    const sessionsCollection = await getCollection('sessions');
    const session = await sessionsCollection.findOne({ userId, sessionId });

    if (!session) {
      console.log(
        `📊 [${userId}][${sessionId}] Сессия не найдена, возвращаем только межсессионные контекстные слоты`
      );
      // Если сессии нет, возвращаем только безопасные межсессионные слоты.
      const permanentSlots = user.slots
        .filter((slot) => {
          const normalizedName = normalizeSlotName(slot.name);
          return CROSS_SESSION_PERMANENT_SLOT_NAMES.includes(normalizedName);
        })
        .map((slot) => {
          const normalizedName = normalizeSlotName(slot.name);
          return {
            ...slot,
            name: normalizedName,
            value: normalizeSlotValue(normalizedName, slot.value),
          };
        });
      console.log(`📊 [${userId}][${sessionId}] Постоянные слоты:`, permanentSlots.length);
      return permanentSlots;
    }

    // Фильтруем слоты: только те, что были извлечены после начала сессии
    // и межсессионные контекстные слоты
    const sessionStartTime = session.createdAt;
    const permanentSlots = CROSS_SESSION_PERMANENT_SLOT_NAMES;

    console.log(
      `📊 [${userId}][${sessionId}] Всего слотов у пользователя: ${user.slots.length}, начало сессии: ${sessionStartTime}`
    );

    // Логируем все слоты пользователя для отладки
    console.log(`📊 [${userId}][${sessionId}] Все слоты пользователя:`);
    user.slots.forEach((slot, index) => {
      const normalizedName = normalizeSlotName(slot.name);
      const extractedAt = slot.extractedAt || slot.createdAt;
      const isInSession = extractedAt && extractedAt >= sessionStartTime;
      const isPermanent = permanentSlots.includes(normalizedName);
      console.log(
        `   ${index + 1}. ${slot.name} -> ${normalizedName}: "${slot.value}" (extractedAt: ${extractedAt}, isPermanent: ${isPermanent}, isInSession: ${isInSession})`
      );
    });

    // Дополнительное логирование для отладки проблемы с потерей слотов
    const citySlots = user.slots.filter((s) => normalizeSlotName(s.name) === 'город');
    if (citySlots.length > 0) {
      console.log(`🏙️ [${userId}][${sessionId}] Найдено слотов города в БД: ${citySlots.length}`);
      citySlots.forEach((slot, index) => {
        const extractedAt = slot.extractedAt || slot.createdAt;
        const isInSession = extractedAt && extractedAt >= sessionStartTime;
        const isPermanent = permanentSlots.includes('город');
        console.log(
          `   ${index + 1}. город: "${slot.value}" (extractedAt: ${extractedAt}, isPermanent: ${isPermanent}, isInSession: ${isInSession})`
        );
      });
    } else {
      console.log(`⚠️ [${userId}][${sessionId}] ВНИМАНИЕ: Слот города НЕ найден в БД!`);
    }

    let sessionSlots = user.slots
      .filter((slot) => {
        const normalizedName = normalizeSlotName(slot.name);

        // Постоянные слоты всегда включаем
        if (permanentSlots.includes(normalizedName)) {
          return true;
        }

        // Остальные слоты только из текущей сессии
        const extractedAt = slot.extractedAt || slot.createdAt;
        if (!extractedAt) {
          console.log(
            `📊 [${userId}][${sessionId}] Слот ${slot.name} без даты извлечения, пропускаем`
          );
          return false;
        }

        const isInSession = extractedAt >= sessionStartTime;
        if (!isInSession) {
          console.log(
            `📊 [${userId}][${sessionId}] Слот ${slot.name} создан до начала сессии (${extractedAt} < ${sessionStartTime}), пропускаем`
          );
        }
        return isInSession;
      })
      .map((slot) => {
        const normalizedName = normalizeSlotName(slot.name);
        const mappedSlot = {
          ...slot,
          name: normalizedName,
          value: normalizeSlotValue(normalizedName, slot.value),
        };

        // Восстанавливаем parsedDate, если есть
        if (slot.parsedDate) {
          mappedSlot.parsedDate =
            slot.parsedDate instanceof Date ? slot.parsedDate : new Date(slot.parsedDate);
        }

        // Восстанавливаем dateRange, если есть
        if (slot.dateRange) {
          const { startDate, endDate } = slot.dateRange;
          mappedSlot.dateRange = {
            startDate:
              startDate instanceof Date ? startDate : startDate ? new Date(startDate) : undefined,
            endDate: endDate instanceof Date ? endDate : endDate ? new Date(endDate) : undefined,
          };
        }

        // Также проверяем normalizedRange (может быть сохранен в БД)
        if (slot.normalizedRange && !mappedSlot.dateRange) {
          const { startDate, endDate } = slot.normalizedRange;
          if (startDate && endDate) {
            mappedSlot.dateRange = {
              startDate: new Date(startDate),
              endDate: new Date(endDate),
            };
            console.log(
              `📊 [${userId}][${sessionId}] Восстановлен dateRange из normalizedRange для слота ${normalizedName}: ${startDate} - ${endDate}`
            );
          }
        }

        // Восстанавливаем timeRange, если есть
        if (slot.timeRange) {
          // Поддерживаем как новый формат (простые числа), так и старый (Date объекты)
          if (slot.timeRange.startHour !== undefined && slot.timeRange.startMinute !== undefined) {
            // Новый формат: простые числа (часы и минуты)
            mappedSlot.timeRange = {
              startHour: slot.timeRange.startHour,
              startMinute: slot.timeRange.startMinute,
              endHour: slot.timeRange.endHour,
              endMinute: slot.timeRange.endMinute,
            };
          } else if (slot.timeRange.startTime) {
            // Старый формат: Date объекты (для обратной совместимости)
            const { startTime, endTime } = slot.timeRange;
            mappedSlot.timeRange = {
              startTime:
                startTime instanceof Date ? startTime : startTime ? new Date(startTime) : undefined,
              endTime: endTime instanceof Date ? endTime : endTime ? new Date(endTime) : undefined,
            };
          }
        }

        // Логируем восстановленные поля даты и времени
        if (mappedSlot.parsedDate || mappedSlot.dateRange || mappedSlot.timeRange) {
          const timeRangeInfo = mappedSlot.timeRange
            ? mappedSlot.timeRange.startHour !== undefined
              ? {
                  startHour: mappedSlot.timeRange.startHour,
                  startMinute: mappedSlot.timeRange.startMinute,
                  endHour: mappedSlot.timeRange.endHour,
                  endMinute: mappedSlot.timeRange.endMinute,
                }
              : {
                  startTime: mappedSlot.timeRange.startTime?.toISOString(),
                  endTime: mappedSlot.timeRange.endTime?.toISOString(),
                }
            : null;

          console.log(
            `📊 [${userId}][${sessionId}] Слот ${normalizedName}="${mappedSlot.value}":`,
            {
              hasParsedDate: !!mappedSlot.parsedDate,
              hasDateRange: !!mappedSlot.dateRange,
              hasTimeRange: !!mappedSlot.timeRange,
              dateRange: mappedSlot.dateRange
                ? {
                    startDate: mappedSlot.dateRange.startDate?.toISOString(),
                    endDate: mappedSlot.dateRange.endDate?.toISOString(),
                  }
                : null,
              timeRange: timeRangeInfo,
            }
          );
        }

        return mappedSlot;
      })
      .filter((slot) => {
        if (!slot || !slot.name) {
          return false;
        }
        if (slot.value === undefined || slot.value === null) {
          return false;
        }
        if (typeof slot.value === 'string' && slot.value.trim().length === 0) {
          console.log(
            `📊 [${userId}][${sessionId}] Слот ${slot.name} пуст после нормализации, пропускаем`
          );
          return false;
        }
        return true;
      });

    const coalescedSessionSlots = coalesceDateSlotsIntoRange(sessionSlots);
    if (coalescedSessionSlots.length !== sessionSlots.length) {
      const dateSlot = coalescedSessionSlots.find((slot) => slot && slot.name === 'дата_события');
      console.log(
        `📅 [${userId}][${sessionId}] Схлопываю множественные дата_события в диапазон: ` +
          `${dateSlot?.value || 'диапазон без текстового представления'}`
      );
    }
    sessionSlots = coalescedSessionSlots;

    // ВАЖНО: sessions.slotsSnapshot — это "истина" в рамках сессии (пишется ai-planner),
    // поэтому используем её, чтобы не терять/не портить контекст между сообщениями
    // (например, после нажатия "Покажи все").
    const snapshotSlots = Array.isArray(session.slotsSnapshot) ? session.slotsSnapshot : [];

    console.log(`📊 [${userId}][${sessionId}] Слотов в сессии: ${sessionSlots.length}`);
    sessionSlots.forEach((slot, index) => {
      console.log(`   ${index + 1}. ${slot.name}: "${slot.value}"`);
    });

    // КРИТИЧЕСКИ ВАЖНО:
    // для одиночных слотов оставляем последнее значение,
    // а для multi-value слотов (жанры, исполнители) сохраняем несколько уникальных значений.
    const slotIndexByKey = new Map();
    const dedupedSlots = [];
    sessionSlots.forEach((slot) => {
      const slotName = String(slot?.name || '').trim();
      if (!slotName) return;
      const slotValue = typeof slot?.value === 'string' ? slot.value.trim() : (slot?.value ?? '');
      const slotKey = MULTI_VALUE_SESSION_SLOT_NAMES.has(slotName)
        ? `${slotName}::${String(slotValue)}`
        : slotName;
      if (slotIndexByKey.has(slotKey)) {
        dedupedSlots[slotIndexByKey.get(slotKey)] = slot;
      } else {
        slotIndexByKey.set(slotKey, dedupedSlots.length);
        dedupedSlots.push(slot);
      }
    });

    console.log(`📊 [${userId}][${sessionId}] Слотов после дедупликации: ${dedupedSlots.length}`);
    dedupedSlots.forEach((slot, index) => {
      console.log(`   ${index + 1}. ${slot.name}: "${slot.value}"`);
    });

    const snapshotUpdatedAtRaw = session.updatedAt || null;
    const snapshotUpdatedAt = snapshotUpdatedAtRaw ? new Date(snapshotUpdatedAtRaw) : null;
    const snapshotGovernedSlots = new Set([
      'жанр',
      'жанр_музыки',
      'предпочтения_жанры',
      'исполнитель',
      'artist',
      'название_мероприятия',
      'поисковый_запрос',
      'настроение',
      'контекст_события',
      'тип_события',
      'тип_мероприятия',
      'категория',
      'category',
      'event_type',
      'предпочтения_типы_событий',
      'дата_события',
      'концерт_дата',
      'время',
      'время_события',
      'концерт_время',
      'бюджет',
      'цена_от',
      'цена_до',
      'цена',
      'возрастное_ограничение',
      'возраст_ребенка',
      'аудитория_спутник',
    ]);

    let finalSlots = dedupedSlots;
    if (snapshotUpdatedAt) {
      const snapshotNames = new Set(
        snapshotSlots.map((s) => normalizeSlotName(String(s?.name || '').trim())).filter(Boolean)
      );

      const before = finalSlots.length;
      finalSlots = finalSlots.filter((slot) => {
        if (!slot || !slot.name) return false;
        if (permanentSlots.includes(slot.name)) return true;
        if (!snapshotGovernedSlots.has(slot.name)) return true;

        const extractedAt = slot.extractedAt || slot.createdAt;
        if (!extractedAt) return true;

        if (extractedAt > snapshotUpdatedAt) return true;

        return snapshotNames.has(slot.name);
      });

      const removed = before - finalSlots.length;
      if (removed > 0) {
        console.log(
          `🧹 [${userId}][${sessionId}] slotsSnapshot отфильтровал ${removed} устаревших слотов (governed)`
        );
      }
    }

    const existingSlotKeys = new Set(
      finalSlots
        .map((slot) => {
          const slotName = String(slot?.name || '').trim();
          if (!slotName) return null;
          const slotValue =
            typeof slot?.value === 'string' ? slot.value.trim() : (slot?.value ?? '');
          return MULTI_VALUE_SESSION_SLOT_NAMES.has(slotName)
            ? `${slotName}::${String(slotValue)}`
            : slotName;
        })
        .filter(Boolean)
    );
    const restoredSnapshotSlots = snapshotSlots
      .map((slot) => {
        if (!slot || !slot.name) {
          return null;
        }

        const normalizedName = normalizeSlotName(String(slot.name).trim());
        if (!snapshotGovernedSlots.has(normalizedName)) {
          return null;
        }

        const normalizedValue = normalizeSlotValue(normalizedName, slot.value);
        if (normalizedValue === undefined || normalizedValue === null) {
          return null;
        }
        if (typeof normalizedValue === 'string' && normalizedValue.trim().length === 0) {
          return null;
        }

        return {
          ...slot,
          name: normalizedName,
          value: normalizedValue,
        };
      })
      .filter((slot) => {
        if (!slot) return false;
        const slotName = String(slot.name || '').trim();
        const slotValue = typeof slot.value === 'string' ? slot.value.trim() : (slot.value ?? '');
        const slotKey = MULTI_VALUE_SESSION_SLOT_NAMES.has(slotName)
          ? `${slotName}::${String(slotValue)}`
          : slotName;
        return !existingSlotKeys.has(slotKey);
      });

    if (restoredSnapshotSlots.length > 0) {
      finalSlots = [...finalSlots, ...restoredSnapshotSlots];
      console.log(
        `📌 [${userId}][${sessionId}] Восстанавливаю из slotsSnapshot отсутствующие слоты: ${restoredSnapshotSlots.map((slot) => `${slot.name}="${slot.value}"`).join(', ')}`
      );
    }

    return finalSlots;
  } catch (error) {
    console.error('Ошибка получения слотов сессии:', error);
    return [];
  }
}
