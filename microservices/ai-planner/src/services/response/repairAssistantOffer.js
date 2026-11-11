import { asksForCityClarification } from './textUtils.js';
import { updateStatus } from '../statusService.js';
import { buildKnownCityClarificationResponseViaLlm } from './clarification.js';
import { containsNonCyrillic } from '../llm/assistantResponseUtils.js';
import { stripJsonArtifacts } from '../llm/assistantResponseUtils.js';
import { removeChineseCharacters } from '../llm/assistantResponseUtils.js';
import { removeGarbageText } from '../llm/assistantResponseUtils.js';
import { getKnownDateValue } from './slotUtils.js';
import { shouldReplaceClarificationWithFallback } from './clarification.js';
import { normalizeOfferDescriptions } from './offerText.js';
import { titleMatchesResponseText } from './offerText.js';
import { getMissingDescriptionNumbers } from './offerText.js';
import { rebuildOfferTextWithRecovery } from './offerText.js';
import { extractOfferIntro } from './offerText.js';

export async function repairAssistantOffer({
  needsClarification,
  hasValidCity,
  assistantResponse,
  citySlot,
  userId,
  sessionId,
  requestId,
  messages,
  requestPlannerAssistantMessage,
  assistantTemperature,
  userMessage,
  effectiveSlots,
  vagueCheck,
  history,
  userPreferences,
  offerEvents,
  offerDeliveryTemperature,
  offerDeliveryMaxTokens,
  hasPreviouslyShownEvents,
}) {
  if (
    needsClarification &&
    hasValidCity &&
    assistantResponse.text &&
    asksForCityClarification(assistantResponse.text)
  ) {
    const cityName = citySlot?.value ? String(citySlot.value).trim() : '';
    console.warn(
      `⚠️ [${userId}][${sessionId}] LLM спросила город при уже известном городе "${cityName}". Делаю авто-повтор без вопроса о городе.`
    );
    if (requestId) updateStatus(requestId, 'Уточняем детали...');

    const retryMessages = messages.map((msg, index) => {
      if (index === 0 && msg.role === 'system') {
        const prefix =
          `✅ ГОРОД УЖЕ ИЗВЕСТЕН${cityName ? `: "${cityName}"` : ''}.\n` +
          `КРИТИЧЕСКИ ВАЖНО: ЗАПРЕЩЕНО спрашивать город или предлагать выбор города.\n` +
          `Задай 1-2 уточняющих вопроса ТОЛЬКО по недостающим деталям (например: тип мероприятия, бюджет, жанр, время).\n\n`;
        return { ...msg, content: prefix + msg.content };
      }
      return msg;
    });

    assistantResponse = await requestPlannerAssistantMessage(
      retryMessages,
      'повторный (город уже известен)',
      1,
      assistantTemperature,
      null
    );

    if (
      assistantResponse?.parsedFromJson &&
      String(assistantResponse?.text || '').trim() === 'Извините, не удалось сформировать ответ.' &&
      (!Array.isArray(assistantResponse?.buttons) || assistantResponse.buttons.length === 0)
    ) {
      console.warn(
        `⚠️ [${userId}][${sessionId}] Повторный ответ вернулся пустым JSON. Подставляю безопасное уточнение через LLM-guard.`
      );
      const safeClarification = await buildKnownCityClarificationResponseViaLlm({
        userId,
        sessionId,
        userMessage,
        requestId,
        knownCity: cityName,
        slots: effectiveSlots,
        vagueRequestInfo: vagueCheck,
        originalText: '',
        originalButtons: [],
        history,
        userPreferences,
      });
      assistantResponse.text = safeClarification.message;
      assistantResponse.buttons = safeClarification.buttons;
    }

    if (containsNonCyrillic(assistantResponse.text)) {
      console.warn(
        `⚠️ [${userId}][${sessionId}] Ответ после повтора без вопроса о городе всё ещё содержит некириллические символы. Делаю доп.повтор строго на русском.`
      );

      const strictRetryMessages = retryMessages.map((msg, index) => {
        if (index === 0 && msg.role === 'system') {
          return {
            ...msg,
            content:
              `Ответ строго на русском языке! Без английских, китайских и любых других некириллических символов.\n` +
              `ЗАПРЕЩЕНО использовать латиницу даже в одном слове.\n\n` +
              msg.content,
          };
        }
        return msg;
      });

      assistantResponse = await requestPlannerAssistantMessage(
        strictRetryMessages,
        'повторный (город уже известен, строго русский)',
        1,
        assistantTemperature,
        null
      );

      if (!assistantResponse.parsedFromJson) {
        assistantResponse.text =
          stripJsonArtifacts(assistantResponse.text) || 'Извините, не удалось сформировать ответ.';
        assistantResponse.buttons = [];
      }

      if (containsNonCyrillic(assistantResponse.text)) {
        assistantResponse.text = removeChineseCharacters(assistantResponse.text);
      }
    }

    if (assistantResponse.text) {
      assistantResponse.text = removeGarbageText(assistantResponse.text);
    }

    assistantResponse.text = (assistantResponse.text || '')
      .replace(/🎯\s*Предложение:\s*undefined/gi, '')
      .replace(/🎯\s*Предложение:\s*$/gm, '')
      .trim();

    if (containsNonCyrillic(assistantResponse.text)) {
      console.warn(
        `⚠️ [${userId}][${sessionId}] После всех ретраев остались некириллические символы. Генерирую безопасное уточнение через LLM-guard.`
      );
      const safeClarification = await buildKnownCityClarificationResponseViaLlm({
        userId,
        sessionId,
        userMessage,
        requestId,
        knownCity: cityName,
        slots: effectiveSlots,
        vagueRequestInfo: vagueCheck,
        originalText: assistantResponse.text,
        originalButtons: assistantResponse.buttons,
        history,
        userPreferences,
      });
      assistantResponse.text = safeClarification.message;
      assistantResponse.buttons = safeClarification.buttons;
    }

    const knownDate = getKnownDateValue(effectiveSlots);
    if (
      shouldReplaceClarificationWithFallback(assistantResponse.text, history, {
        knownCity: cityName,
        knownDate,
      })
    ) {
      console.log(
        `🔁 [${userId}][${sessionId}] Перегенерирую шаблонное уточнение через LLM-guard: "${assistantResponse.text}"`
      );
      const safeClarification = await buildKnownCityClarificationResponseViaLlm({
        userId,
        sessionId,
        userMessage,
        requestId,
        knownCity: cityName,
        slots: effectiveSlots,
        vagueRequestInfo: vagueCheck,
        originalText: assistantResponse.text,
        originalButtons: assistantResponse.buttons,
        history,
        userPreferences,
      });
      assistantResponse.text = safeClarification.message;
      assistantResponse.buttons = safeClarification.buttons;
    }

    assistantResponse.text = normalizeOfferDescriptions(assistantResponse.text, offerEvents);

    if (Array.isArray(offerEvents) && offerEvents.length > 0) {
      const eventTitles = offerEvents.map((e) => (e.title || '').trim());
      const responseText = assistantResponse.text;

      // Подсчитываем количество описаний событий по нумерации (1., 2., 3. и т.д.)
      const numberedEventsPattern = /^\s*\d{1,2}[.)]\s+/gm;
      const numberedMatches = responseText.match(numberedEventsPattern);
      const numberedEventsCount = numberedMatches ? numberedMatches.length : 0;

      // Проверяем, какие события упоминаются в тексте (более строгая проверка)
      const describedEvents = eventTitles.map((title, index) => {
        if (!title) return { index, title, found: false };
        const found = titleMatchesResponseText(title, responseText);
        return found
          ? { index, title, found: true, method: 'normalized' }
          : { index, title, found: false };
      });

      const foundEvents = describedEvents.filter((e) => e.found);
      const foundEventsCount = foundEvents.length;

      const missingDescriptionNumbers = getMissingDescriptionNumbers(
        responseText,
        offerEvents.length
      );
      let missingDescriptionsCount = missingDescriptionNumbers.length;
      const missingDescriptionsTitles = missingDescriptionNumbers
        .map((n) => eventTitles[n - 1])
        .filter(Boolean);

      // Если события на месте, но "Описание" оформлено криво — чиним без перегенерации.
      const hasAllEventsByStructure =
        numberedEventsCount >= offerEvents.length && foundEventsCount >= offerEvents.length;

      if (hasAllEventsByStructure && missingDescriptionsCount > 0) {
        assistantResponse.text = rebuildOfferTextWithRecovery({
          primaryText: responseText,
          retryText: responseText,
          events: offerEvents,
          fallbackIntro: extractOfferIntro(responseText, ''),
          ensureOutro: false,
        });
        missingDescriptionsCount = getMissingDescriptionNumbers(
          assistantResponse.text,
          offerEvents.length
        ).length;
      }

      // Если ничего не найдено - используем безопасный ответ из данных (без галлюцинаций)
      // Проверяем оба критерия: количество пронумерованных описаний и упоминания названий
      // Требуем, чтобы оба условия выполнялись строго
      const isAllDescribed =
        numberedEventsCount >= offerEvents.length &&
        foundEventsCount >= offerEvents.length &&
        missingDescriptionsCount === 0;

      if (!isAllDescribed) {
        const missingEvents = describedEvents.filter((e) => !e.found);
        const missingCount = missingEvents.length;
        const missingTitles = missingEvents.map((e) => e.title);

        console.warn(
          `⚠️ [${userId}][${sessionId}] LLM описала только ${foundEventsCount} из ${offerEvents.length} событий. ` +
            `Пронумерованных описаний: ${numberedEventsCount}, найденных названий: ${foundEventsCount}. ` +
            `Пропущено: ${missingCount}. Без описания: ${missingDescriptionsCount}. ` +
            `Ожидаемые события: ${eventTitles.join(', ')}`
        );

        if (missingTitles.length > 0) {
          console.warn(
            `⚠️ [${userId}][${sessionId}] Пропущенные события: ${missingTitles.join(', ')}`
          );
        }
        if (missingDescriptionsTitles.length > 0) {
          console.warn(
            `⚠️ [${userId}][${sessionId}] События без строки "Описание:": ${missingDescriptionsTitles.join(', ')}`
          );
        }

        // Перегенерируем ответ с более строгими инструкциями
        console.log(
          `🔄 [${userId}][${sessionId}] Перегенерирую ответ с требованием описать все ${offerEvents.length} событий`
        );

        if (requestId) updateStatus(requestId, 'Улучшаем описание событий...');

        const firstAttemptOfferText = assistantResponse.text;

        const retryMessages = messages.map((msg, index) => {
          if (index === 0 && msg.role === 'system') {
            // Формируем детальный список пропущенных событий
            const missingListSource =
              missingTitles.length > 0 ? missingTitles : missingDescriptionsTitles;
            const missingList =
              missingListSource.length > 0
                ? missingListSource.map((t, i) => `${i + 1}. "${t}"`).join('\n')
                : 'Все события должны быть описаны!';

            return {
              ...msg,
              content: `🚨🚨🚨 КРИТИЧЕСКАЯ ОШИБКА! 🚨🚨🚨

В предыдущем ответе ты нарушил требования формата. Это НЕПРАВИЛЬНО!

	Сводка ошибок:
	- Пронумерованных пунктов: ${numberedEventsCount}
	- Найденных названий событий: ${foundEventsCount} из ${offerEvents.length}
	- Пропущено событий: ${missingCount}
	- Без строки "Описание:": ${missingDescriptionsCount}
	
	Ты ДОЛЖЕН описать ВСЕ ${offerEvents.length} событий из списка. Пропущенные события (${missingCount}):
	${missingList}

ВСЕ СОБЫТИЯ, КОТОРЫЕ ТЫ ДОЛЖЕН ОПИСАТЬ (ВСЕ ${offerEvents.length}):
${eventTitles.map((t, i) => `${i + 1}. "${t}"`).join('\n')}

ОПИСЫВАЙ ВСЕ ${offerEvents.length} СОБЫТИЙ БЕЗ ИСКЛЮЧЕНИЯ! НЕ пропускай ни одного!
	ДЛЯ КАЖДОГО события ОБЯЗАТЕЛЬНО добавь строку "Описание:".
Описание нужно СГЕНЕРИРОВАТЬ для КАЖДОГО события (1–2 предложения).
Если во входном JSON для события есть поле "description" — используй его как ОСНОВУ: выбери 1–2 ключевые детали и ПЕРЕФРАЗИРУЙ.
КРИТИЧЕСКИ ВАЖНО: НЕ копируй description дословно/длинными кусками и НЕ обрывай текст на "...".
КРИТИЧЕСКИ ВАЖНО: НЕ добавляй фактов, которых нет в данных.
НЕ выдумывай фактов, которых нет в данных (артистов, программу, жанр/сетлист, “рождественское шоу”, “бестселлер”, дресс‑код, спец‑гостей и т.п.).
НЕ используй оценочные ярлыки без фактов: "уникальный", "популярный", "известный", "легендарный", "лучший", "хиты", "зажигательный".
КАЖДОЕ событие должно начинаться с новой строки с нумерацией (1., 2., 3., 4., 5. и т.д.).
Между КАЖДЫМ событием должна быть ПУСТАЯ СТРОКА (двойной перенос \n\n).

КРИТИЧЕСКИ ВАЖНО:
- Отвечай ТОЛЬКО на русском языке!
- НЕ используй другие языки (немецкий, китайский, английский и т.д.)!
- НЕ добавляй случайные фразы на других языках!
- НЕ добавляй мусорный текст!

ПРОВЕРЬ СЕБЯ: После написания ответа посчитай, сколько событий ты описал. Должно быть РОВНО ${offerEvents.length}!

${msg.content}`,
            };
          }
          return msg;
        });

        assistantResponse = await requestPlannerAssistantMessage(
          retryMessages,
          'перегенерация (все события)',
          1,
          offerDeliveryTemperature,
          offerDeliveryMaxTokens
        );

        // Обработка ответа после перегенерации (аналогично основной обработке)
        if (!assistantResponse.parsedFromJson) {
          console.warn(
            `⚠️ [${userId}][${sessionId}] Перегенерированный ответ не соответствует JSON-формату. Запрашиваю перегенерацию строго в JSON.`
          );

          if (requestId) updateStatus(requestId, 'Улучшаем формат ответа...');

          const retryJsonMessages = retryMessages.map((msg, index) => {
            if (index === 0 && msg.role === 'system') {
              return {
                ...msg,
                content: `‼️ Ответ должен быть строго JSON без текста вне объекта!\n\n${msg.content}`,
              };
            }
            return msg;
          });

          assistantResponse = await requestPlannerAssistantMessage(
            retryJsonMessages,
            'повторная перегенерация (JSON)',
            1,
            offerDeliveryTemperature,
            offerDeliveryMaxTokens
          );

          if (!assistantResponse.parsedFromJson) {
            console.warn(
              `⚠️ [${userId}][${sessionId}] Повторный перегенерированный ответ всё ещё не является чистым JSON. JSON-блок будет удален.`
            );
            assistantResponse.text =
              stripJsonArtifacts(assistantResponse.text) ||
              'Извините, не удалось сформировать ответ.';
            assistantResponse.buttons = [];
          }
        }

        if (containsNonCyrillic(assistantResponse.text)) {
          console.warn(
            `⚠️ [${userId}][${sessionId}] Перегенерированный ответ содержит китайские символы. Удаляю их.`
          );
          assistantResponse.text = removeChineseCharacters(assistantResponse.text);
        }

        // Удаляем мусорный текст из перегенерированного ответа
        if (assistantResponse.text) {
          const beforeClean = assistantResponse.text;
          assistantResponse.text = removeGarbageText(assistantResponse.text);
          if (beforeClean !== assistantResponse.text) {
            console.log(
              `🧹 [${userId}][${sessionId}] Удален мусорный текст из перегенерированного ответа`
            );
          }
        }

        // Удаляем "🎯 Предложение: undefined" из перегенерированного ответа
        assistantResponse.text = (assistantResponse.text || '')
          .replace(/🎯\s*Предложение:\s*undefined/gi, '')
          .replace(/🎯\s*Предложение:\s*$/gm, '')
          .trim();

        // Повторная проверка после перегенерации (используем ту же строгую логику)
        if (assistantResponse.text) {
          const retryResponseText = assistantResponse.text;
          const retryNumberedMatches = retryResponseText.match(numberedEventsPattern);
          const retryNumberedEventsCount = retryNumberedMatches ? retryNumberedMatches.length : 0;

          const retryDescribedEvents = eventTitles.map((title, index) => {
            if (!title) return { index, title, found: false };
            const found = titleMatchesResponseText(title, retryResponseText);
            return found
              ? { index, title, found: true, method: 'normalized' }
              : { index, title, found: false };
          });

          const retryFoundEvents = retryDescribedEvents.filter((e) => e.found);
          const retryFoundEventsCount = retryFoundEvents.length;
          const retryMissingDescriptionsCount = getMissingDescriptionNumbers(
            retryResponseText,
            offerEvents.length
          ).length;
          const retryIsAllDescribed =
            retryNumberedEventsCount >= offerEvents.length &&
            retryFoundEventsCount >= offerEvents.length &&
            retryMissingDescriptionsCount === 0;

          if (!retryIsAllDescribed) {
            const retryMissingEvents = retryDescribedEvents.filter((e) => !e.found);
            const retryMissingCount = retryMissingEvents.length;
            const retryMissingTitles = retryMissingEvents.map((e) => e.title);
            console.warn(
              `⚠️ [${userId}][${sessionId}] После перегенерации описано только ${retryFoundEventsCount} из ${offerEvents.length} событий. ` +
                `Пронумерованных описаний: ${retryNumberedEventsCount}, найденных названий: ${retryFoundEventsCount}. Пропущено: ${retryMissingCount}`
            );
            if (retryMissingTitles.length > 0) {
              console.warn(
                `⚠️ [${userId}][${sessionId}] После перегенерации пропущенные события: ${retryMissingTitles.join(', ')}`
              );
            }

            // Перегенерация снова неполная — собираем лучшее и дозаполняем из данных.
            const MAX_EVENTS_TO_SEND = 5;
            const fallbackEvents = offerEvents.slice(0, MAX_EVENTS_TO_SEND);
            const intro = hasPreviouslyShownEvents
              ? `Я нашёл ещё варианты — смотрите подборку ниже (${fallbackEvents.length} шт.):`
              : `Я нашёл варианты — смотрите подборку ниже (${fallbackEvents.length} шт.):`;
            assistantResponse.text = rebuildOfferTextWithRecovery({
              primaryText: firstAttemptOfferText,
              retryText: retryResponseText,
              events: fallbackEvents,
              fallbackIntro: intro,
              ensureOutro: true,
            });
            console.log(
              `🛟 [${userId}][${sessionId}] LLM снова описала не все события; восстановил текст (1-я попытка + перегенерация + дозаполнение из данных) и буду отправлять ${fallbackEvents.length} карточек`
            );
          } else {
            console.log(
              `✅ [${userId}][${sessionId}] После перегенерации описаны все ${offerEvents.length} событий (пронумерованных: ${retryNumberedEventsCount}, найденных: ${retryFoundEventsCount})`
            );
          }
        }
      } else {
        console.log(
          `✅ [${userId}][${sessionId}] LLM описала все ${offerEvents.length} событий из списка (пронумерованных: ${numberedEventsCount}, найденных: ${foundEventsCount})`
        );
      }
    }
  }

  return { assistantResponse };
}
