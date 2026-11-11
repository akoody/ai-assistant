import crypto from 'node:crypto';
import {
  getMaxConcurrentRequests,
  getConfidenceThreshold,
  getSlotExtractionPrompt,
} from '../configService.js';
import { getSlots } from '../slotsService.js';
import { extractSlotsFromText } from '../aiGatewayService.js';
import { saveExtractedSlots } from '../slotsStorageService.js';
import { getCache, setCache } from '../cacheService.js';
import { enrichSlotWithDate } from '../dateParsingService.js';
import {
  enrichSlotWithDateLlmFallback,
  enrichSlotsWithDateLlmFallback,
} from '../dateLlmNormalizationService.js';
import { extractDateHintFromText, extractTimeHintFromText } from '../naturalLanguageHints.js';
import { savePreferencesFromSlots } from '../userPreferencesService.js';
import { applyIntentHeuristics } from '../intentHeuristics.js';
import { appendHeuristicGenreSlot } from '../genreHeuristics.js';
import {
  appendHeuristicArtistSlot,
  dropUngroundedGenreSlotsWhenArtistDetected,
  reconcileArtistSlotsWithText,
} from '../artistHeuristics.js';
import { MOOD_SLOT_NAME, SLOT_EXTRACTION_PIPELINE_VERSION, hasOffTopicIntent } from './policy.js';
import { sanitizeSlotsForPersistence } from './persistence.js';
import { shouldKeepSlotAfterConfidenceFilter } from './cityGrounding.js';
import { annotatePreferenceSlotsWithSentiment } from './sentiment.js';
import { sanitizeSlotsByIntent } from './intentGuards.js';
import {
  looksLikeTouristRequest,
  looksLikeMuseumRequest,
  appendHeuristicSearchQuerySlot,
  appendHeuristicMoodSlot,
} from './queryHints.js';
import { hasDateSlot, hasTimeSlot } from './timeGrounding.js';
import {
  appendHeuristicChildAgeSlot,
  appendHeuristicSeniorAudienceSlots,
} from './audienceHints.js';
import { normalizeBudgetSlots, normalizeFreeBudgetSlots } from './budget.js';

class RequestQueue {
  constructor() {
    this.queue = [];
    this.processing = 0;
    this.maxConcurrent = 5;
  }

  async enqueue(requestData) {
    return new Promise((resolve, reject) => {
      this.queue.push({ requestData, resolve, reject });
      this.process();
    });
  }

  async process() {
    if (this.processing >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    const { requestData, resolve, reject } = this.queue.shift();
    this.processing++;

    // Обновляем лимит из конфигурации
    this.maxConcurrent = getMaxConcurrentRequests();

    try {
      const isChangeRequest = /изменить|сменить|выбрать другой|выбрать (город|дату)/i.test(
        requestData.text || ''
      );

      const cacheKey = this.generateCacheKey(requestData.text);

      if (!isChangeRequest) {
        const cached = getCache(cacheKey);

        if (cached) {
          // ВАЖНО: Даже при cache hit нужно сохранить слоты в БД для текущего пользователя,
          // т.к. кеш общий по тексту, а слоты привязаны к userId
          const cachedSlots = await enrichSlotsWithDateLlmFallback(cached.slots || [], {
            sourceText: requestData.text,
          });
          reconcileArtistSlotsWithText(cachedSlots, requestData.text);
          const sanitizedCachedSlots = appendHeuristicChildAgeSlot(
            sanitizeSlotsForPersistence(cachedSlots, requestData.text),
            requestData.text
          );
          const cachedIntents = applyIntentHeuristics(
            requestData.text,
            cached.intents || [],
            sanitizedCachedSlots
          );
          const finalCachedSlots = sanitizeSlotsByIntent(
            sanitizedCachedSlots,
            cachedIntents,
            requestData.text
          );
          const responseCachedSlots = hasOffTopicIntent(cachedIntents) ? [] : finalCachedSlots;

          if (responseCachedSlots.length > 0 && requestData.userId) {
            console.log(
              `[queueService] Cache hit для "${requestData.text}", но сохраняем слоты для userId: ${requestData.userId}`
            );
            try {
              await saveExtractedSlots(requestData.userId, requestData.text, responseCachedSlots);
              console.log(
                `[queueService] Слоты из кеша успешно сохранены в БД для userId: ${requestData.userId}`
              );

              // Автоматически сохраняем долгосрочные предпочтения из кешированных слотов
              await savePreferencesFromSlots(requestData.userId, responseCachedSlots, {
                sourceText: requestData.text,
                intents: cachedIntents,
              });
              console.log(
                `[queueService] Предпочтения из кеша проанализированы и сохранены для userId: ${requestData.userId}`
              );
            } catch (saveError) {
              console.error(`[queueService] Ошибка при сохранении слотов из кеша:`, saveError);
              // Не прерываем выполнение, просто логируем ошибку
            }
          }
          this.processing--;
          resolve({
            ...cached,
            slots: responseCachedSlots,
            extractedSlots: responseCachedSlots,
            filtered: responseCachedSlots.length,
            intents: cachedIntents,
          });
          this.process();
          return;
        }
      } else {
        console.log(
          `[queueService] Пропускаю кэш для запроса на изменение параметров: "${requestData.text}"`
        );
      }

      // Получаем слоты из кеша
      const slots = getSlots();

      if (slots.length === 0) {
        throw new Error('Нет доступных слотов для извлечения');
      }

      // Извлекаем слоты и намерения через LLM (промпт формируется внутри функции)
      const extractionResult = await extractSlotsFromText(requestData.text);
      const extractedSlots = extractionResult.slots || [];
      const extractedIntents = extractionResult.intents || [];
      console.log(`[queueService] Извлечено слотов из LLM: ${extractedSlots.length}`);

      // Обогащаем слоты парсированными датами (если применимо)
      const enrichedSlots = await enrichSlotsWithDateLlmFallback(extractedSlots, {
        sourceText: requestData.text,
      });
      console.log(`[queueService] Обогащено слотов: ${enrichedSlots.length}`);

      // Если ллм не выделил дату, пробуем восстановить ее по частым временным маркерам, типо "эту субботу", "в пятницу", "на выходных", "сегодня/завтра".
      if (!hasDateSlot(enrichedSlots)) {
        const dateHint = extractDateHintFromText(requestData.text);
        if (dateHint) {
          const heuristicDateSlot = await enrichSlotWithDateLlmFallback(
            {
              name: 'дата_события',
              value: dateHint,
              confidence: 0.9,
              source: 'heuristic_date',
            },
            {
              sourceText: requestData.text,
            }
          );
          enrichedSlots.push(heuristicDateSlot);
          console.log(`[queueService] Добавлен эвристический слот даты: "${dateHint}"`);
        }
      }

      if (!hasTimeSlot(enrichedSlots)) {
        const timeHint = extractTimeHintFromText(requestData.text);
        if (timeHint) {
          const heuristicTimeSlot = enrichSlotWithDate({
            name: 'время_события',
            value: timeHint,
            confidence: 0.9,
            source: 'heuristic_time',
          });
          enrichedSlots.push(heuristicTimeSlot);
          console.log(`[queueService] Добавлен эвристический слот времени: "${timeHint}"`);
        }
      }

      appendHeuristicChildAgeSlot(enrichedSlots, requestData.text);
      appendHeuristicSeniorAudienceSlots(enrichedSlots, requestData.text);
      appendHeuristicGenreSlot(enrichedSlots, requestData.text);
      const heuristicArtistSlot = appendHeuristicArtistSlot(enrichedSlots, requestData.text);
      let normalizedSlots = heuristicArtistSlot
        ? dropUngroundedGenreSlotsWhenArtistDetected(
            enrichedSlots,
            requestData.text,
            heuristicArtistSlot
          )
        : enrichedSlots;
      const artistValuesBeforeReconcile = normalizedSlots
        .filter((slot) => slot && slot.name === 'исполнитель')
        .map((slot) => String(slot.value || '').trim())
        .filter(Boolean);
      reconcileArtistSlotsWithText(normalizedSlots, requestData.text);
      const artistValuesAfterReconcile = normalizedSlots
        .filter((slot) => slot && slot.name === 'исполнитель')
        .map((slot) => String(slot.value || '').trim())
        .filter(Boolean);
      if (artistValuesBeforeReconcile.join(' | ') !== artistValuesAfterReconcile.join(' | ')) {
        console.log(
          `[queueService] Нормализован слот исполнителя по тексту: ` +
            `"${artistValuesBeforeReconcile.join(', ') || '∅'}" -> "${artistValuesAfterReconcile.join(', ') || '∅'}"`
        );
      }

      // Эвристика для распознавания наиболее частых упоминаний города,
      // если LLM не вернул слот "город" с высоким доверием.
      const hasCitySlot = normalizedSlots.some((slot) => slot.name === 'город');
      if (!hasCitySlot) {
        const lowerText = requestData.text.toLowerCase();
        if (lowerText.includes('москв')) {
          normalizedSlots.push({
            name: 'город',
            value: 'Москва',
            confidence: 0.95,
            source: 'heuristic',
          });
          console.log('[queueService] Добавлен эвристический слот города: Москва');
        } else if (
          lowerText.includes('санкт-петер') ||
          lowerText.includes('санкт петер') ||
          lowerText.includes('питер') ||
          lowerText.includes('спб') ||
          lowerText.includes('с-пб')
        ) {
          normalizedSlots.push({
            name: 'город',
            value: 'Санкт-Петербург',
            confidence: 0.95,
            source: 'heuristic',
          });
          console.log('[queueService] Добавлен эвристический слот города: Санкт-Петербург');
        }
      }

      let hasEventTypeSlot = normalizedSlots.some(
        (slot) => slot && (slot.name === 'тип_мероприятия' || slot.name === 'тип_события')
      );
      if (!hasEventTypeSlot && looksLikeTouristRequest(requestData.text)) {
        normalizedSlots.push({
          name: 'тип_мероприятия',
          value: 'туристам',
          confidence: 0.92,
          source: 'heuristic',
        });
        hasEventTypeSlot = true;
        console.log('[queueService] Добавлен эвристический слот категории: туристам');
      }

      if (!hasEventTypeSlot && looksLikeMuseumRequest(requestData.text)) {
        normalizedSlots.push({
          name: 'тип_мероприятия',
          value: 'музеи',
          confidence: 0.92,
          source: 'heuristic',
        });
        hasEventTypeSlot = true;
        console.log('[queueService] Добавлен эвристический слот категории: музеи');
      }

      appendHeuristicMoodSlot(normalizedSlots, requestData.text);

      // Если пользователь упоминает "настроение" / "настрой", но НЕ указывает конкретный тип —
      // удаляем mood-слот (в т.ч. от LLM), чтобы планировщик спросил уточнение.
      {
        const normalizedMsgForMood = String(requestData.text || '')
          .toLowerCase()
          .replace(/ё/g, 'е');
        const mentionsMood = /настроени|настрой(?!к)/u.test(normalizedMsgForMood);
        if (mentionsMood) {
          const hasSpecificMoodMarker =
            // прилагательные перед/после "настроение"
            /(хорош|отличн|прекрасн|замечат|чудесн|позитив|весел|велик|романтич|спокойн|энергичн|грустн|плох|ужасн|тоскл|печальн|бодр)\S*\s+настроени/u.test(
              normalizedMsgForMood
            ) ||
            /настроени\S*\s+\S*\s{0,5}(хорош|отличн|прекрасн|замечат|чудесн|позитив|весел|велик|романтич|спокойн|энергичн|грустн|плох|ужасн|тоскл|печальн|бодр)/u.test(
              normalizedMsgForMood
            ) ||
            // глаголы-действия с "настроение"
            /(поднят|улучш|поддерж|сохран|продолж|испорт|потеря)\S*\s+(?:\S+\s+){0,3}настроени/u.test(
              normalizedMsgForMood
            ) ||
            /настроени\S*\s+(?:\S+\s+){0,3}(поднят|улучш|поддерж|сохран|продолж|не\s+потеря)/u.test(
              normalizedMsgForMood
            ) ||
            // косвенные маркеры конкретного mood в том же сообщении
            /(скучн|тоск|хандр|грустн|устал|выгорел|развея|отвлеч|взбодр|повесел|посмея|рассмеш|развлеч|расслаб|романт|свидан|влюблен|энерг|драйв|актив|интеллект|вдохнов|необыч|эксперимент)/u.test(
              normalizedMsgForMood
            );
          if (!hasSpecificMoodMarker) {
            const moodSlotsCount = normalizedSlots.filter(
              (s) => s && s.name === MOOD_SLOT_NAME
            ).length;
            if (moodSlotsCount > 0) {
              normalizedSlots = normalizedSlots.filter((s) => !(s && s.name === MOOD_SLOT_NAME));
              console.log(
                `[queueService] 🎭 Настроение упомянуто но тип не указан — убираю ${moodSlotsCount} mood-слот(а/ов), ` +
                  `планировщик запросит уточнение настроения`
              );
            }
          }
        }
      }

      appendHeuristicSearchQuerySlot(normalizedSlots, requestData.text);
      normalizeFreeBudgetSlots(normalizedSlots, requestData.text);
      normalizeBudgetSlots(normalizedSlots, requestData.text);

      // Фильтруем по порогу уверенности
      const confidenceThreshold = getConfidenceThreshold();
      console.log(`[queueService] Порог уверенности: ${confidenceThreshold}`);
      console.log(
        `[queueService] 🔍 Слотов перед фильтром по confidence (${normalizedSlots.length}): ${normalizedSlots.map((s) => `${s.name}=${s.value}(conf:${s.confidence})`).join(', ')}`
      );
      let filteredSlots = normalizedSlots.filter((slot) =>
        shouldKeepSlotAfterConfidenceFilter(slot, confidenceThreshold, requestData.text)
      );
      console.log(
        `[queueService] 🔍 Слотов после фильтра confidence (${filteredSlots.length}): ${filteredSlots.map((s) => `${s.name}=${s.value}`).join(', ')}`
      );

      // КРИТИЧЕСКИ ВАЖНО: Фильтруем слоты города, чтобы "Другой город" и его варианты не сохранялись как город
      // Пользователи пишут на русском языке, поэтому проверяем только русские варианты
      filteredSlots = sanitizeSlotsForPersistence(filteredSlots, requestData.text);
      console.log(
        `[queueService] 🔍 Слотов после sanitize (${filteredSlots.length}): ${filteredSlots.map((s) => `${s.name}=${s.value}`).join(', ')}`
      );

      const detectedIntents = applyIntentHeuristics(
        requestData.text,
        extractedIntents,
        filteredSlots
      );
      if (detectedIntents.length > 0) {
        console.log(`[queueService] Обнаружены намерения: ${JSON.stringify(detectedIntents)}`);
      }

      filteredSlots = sanitizeSlotsByIntent(filteredSlots, detectedIntents, requestData.text);
      console.log(
        `[queueService] 🔍 Слотов после sanitizeByIntent (${filteredSlots.length}): ${filteredSlots.map((s) => `${s.name}=${s.value}`).join(', ')}`
      );

      const preferenceAwareSlots = annotatePreferenceSlotsWithSentiment(
        filteredSlots,
        requestData.text
      );
      if (preferenceAwareSlots.some((slot) => slot?.isNegative)) {
        console.log(
          `[queueService] 🧠 Негативные вкусовые слоты вынесены только в память предпочтений: ` +
            preferenceAwareSlots
              .filter((slot) => slot?.isNegative)
              .map((slot) => `${slot.name}=${slot.value}`)
              .join(', ')
        );
      }
      const responseSlots = hasOffTopicIntent(detectedIntents)
        ? []
        : preferenceAwareSlots.filter((slot) => !slot?.isNegative);
      console.log(
        `[queueService] 🔍 Слотов после sentiment-фильтра (${responseSlots.length}): ${responseSlots.map((s) => `${s.name}=${s.value}`).join(', ')}`
      );

      // Сохраняем в БД (userId обязателен, сохраняем только если есть слоты)
      console.log(`[queueService] Отфильтровано слотов: ${responseSlots.length}`);
      if (responseSlots.length > 0) {
        console.log(`[queueService] Сохраняем слоты для userId: ${requestData.userId}`);
        try {
          await saveExtractedSlots(requestData.userId, requestData.text, responseSlots);
          console.log(`[queueService] Слоты успешно сохранены в БД`);
        } catch (saveError) {
          console.error(`[queueService] Ошибка при сохранении слотов:`, saveError);
          throw saveError;
        }
      } else {
        console.log(`[queueService] Нет слотов для сохранения (все отфильтрованы)`);
      }

      if (responseSlots.length > 0) {
        await savePreferencesFromSlots(requestData.userId, responseSlots, {
          sourceText: requestData.text,
          intents: detectedIntents,
        });
        console.log(
          `[queueService] Предпочтения проанализированы и сохранены для userId: ${requestData.userId}`
        );
      }

      const result = {
        text: requestData.text,
        slots: responseSlots,
        extractedSlots: responseSlots,
        totalFound: extractedSlots.length,
        filtered: responseSlots.length,
        confidenceThreshold,
        intents: detectedIntents,
      };

      // Сохраняем в кеш только если это не запрос на изменение
      if (!isChangeRequest) {
        setCache(cacheKey, result);
      }

      resolve(result);
    } catch (error) {
      reject(error);
    } finally {
      this.processing--;
      this.process();
    }
  }

  generateCacheKey(text) {
    const normalizedText = text.toLowerCase().trim();
    // ВАЖНО: привязываем кеш к версии slotExtractionPrompt, чтобы изменения промпта
    // (например, добавление новых intents вроде off_topic) не ломались старым кешем.
    let promptHash = '';
    try {
      const prompt = getSlotExtractionPrompt() || '';
      promptHash = crypto.createHash('md5').update(String(prompt)).digest('hex');
    } catch (e) {
      promptHash = 'no-prompt';
    }
    return crypto
      .createHash('md5')
      .update(`${normalizedText}|${promptHash}|${SLOT_EXTRACTION_PIPELINE_VERSION}`)
      .digest('hex');
  }

  getStats() {
    return {
      queueLength: this.queue.length,
      processing: this.processing,
      maxConcurrent: this.maxConcurrent,
    };
  }
}

const requestQueue = new RequestQueue();

function queueRequest(requestData) {
  return requestQueue.enqueue(requestData);
}

function getQueueStats() {
  return requestQueue.getStats();
}

export { queueRequest, getQueueStats };
