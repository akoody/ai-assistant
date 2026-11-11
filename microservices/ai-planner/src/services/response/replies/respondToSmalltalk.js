import { isVagueArtistDescriptor } from '../../../../../../shared/vagueArtistUtils.js';
import { isAssistantIdentityQuestion } from '../../assistantIdentityService.js';
import { isRussianCity } from '../../offerService.js';
import { hasCategoryButtons } from '../../quickButtonsService.js';
import { getCurrentSessionSlots } from '../../slotsService.js';
import { updateStatus } from '../../statusService.js';
import { getLastAssistantButtons } from '../conversationHistory.js';
import { buildClarificationDeclineResponseViaLlm } from '../dialogReplies.js';
import { requestAssistantMessage } from '../gatewayClient.js';
import {
  buildSmalltalkSystemPrompt,
  ensureFarewellHasHelp,
  isMaybeLaterReplyText,
  normalizeShortUserReply,
  pickFirstSentence,
  sanitizeSmalltalkText,
  shouldRepromptCategoryForAckViaLlm,
} from '../moodHealth.js';
import { buildAssistantIdentityResponseViaLlm } from '../redirects.js';

// Smalltalk without a recommendations request gets a conversational reply. A "да" during
// clarification continues the search instead (`continue`, possibly with an inferred
// event type). Returns null for messages that are not smalltalk.
export async function respondToSmalltalk({
  hasRecommendationsIntent,
  requestId,
  session,
  sessionId,
  slotExtractionResult,
  smalltalkIntent,
  userId,
  userMessage,
}) {
  if (smalltalkIntent && !hasRecommendationsIntent) {
    const kind = typeof smalltalkIntent.kind === 'string' ? smalltalkIntent.kind : null;
    const rawUserText = String(userMessage || '').trim();

    if (kind === 'ack' && isAssistantIdentityQuestion(rawUserText)) {
      if (requestId) updateStatus(requestId, 'Формируем ответ...');
      return {
        kind: 'reply',
        response: await buildAssistantIdentityResponseViaLlm({
          userId,
          sessionId,
          userMessage: rawUserText,
          requestId,
        }),
      };
    }

    const normalizedShortReply = normalizeShortUserReply(rawUserText);
    const isYesReply = ['да', 'ага', 'угу', 'конечно', 'точно', 'верно', 'давай'].includes(
      normalizedShortReply
    );
    const isNoReply =
      ['нет', 'неа'].includes(normalizedShortReply) || isMaybeLaterReplyText(rawUserText);

    // "да/нет" часто приходит как smalltalk(kind=ack) из AI Slots.
    // Если мы в процессе уточнений — не надо отвечать "Понял.", надо продолжать сценарий.
    const shouldBypassSmalltalkAck =
      kind === 'ack' && (isYesReply || isNoReply) && Boolean(session?.clarificationAsked);

    if (shouldBypassSmalltalkAck && isNoReply) {
      if (requestId) updateStatus(requestId, 'Формируем ответ...');
      return {
        kind: 'reply',
        response: await buildClarificationDeclineResponseViaLlm({
          userId,
          sessionId,
          userMessage,
          requestId,
        }),
      };
    }

    if (shouldBypassSmalltalkAck && isYesReply) {
      const snapshotSlots = Array.isArray(session?.slotsSnapshot) ? session.slotsSnapshot : [];
      const hasNamedTarget = snapshotSlots.some((s) => {
        if (!s || (s.name !== 'исполнитель' && s.name !== 'название_мероприятия')) {
          return false;
        }
        if (s.name === 'исполнитель' && isVagueArtistDescriptor(s.value)) {
          return false;
        }
        return Boolean(s.value);
      });
      const hasEventTypeSlot = snapshotSlots.some(
        (s) =>
          s && (s.name === 'тип_мероприятия' || s.name === 'тип_события' || s.name === 'категория')
      );
      if (hasNamedTarget && !hasEventTypeSlot) {
        if (!slotExtractionResult || typeof slotExtractionResult !== 'object') {
          slotExtractionResult = { slots: [], intents: [] };
        }
        if (!Array.isArray(slotExtractionResult.slots)) {
          slotExtractionResult.slots = [];
        }
        slotExtractionResult.slots.push({
          name: 'тип_мероприятия',
          value: 'концерты',
          confidence: 0.9,
        });
      }
      // Не возвращаемся с ответом — продолжаем основную обработку.
      return { kind: 'continue', slotExtractionResult };
    } else {
      if (requestId) updateStatus(requestId, 'Формируем ответ...');

      const currentSlots = await getCurrentSessionSlots(userId, sessionId);
      const citySlot = Array.isArray(currentSlots)
        ? currentSlots.find((slot) => slot && slot.name === 'город')
        : null;
      const normalizedCity =
        citySlot && citySlot.value && String(citySlot.value).trim().length > 0
          ? String(citySlot.value).trim()
          : null;
      const hasValidCity = Boolean(normalizedCity && isRussianCity(normalizedCity));

      const categoryButtons = ['Концерты', 'Театры', 'Выставки', 'Музеи', 'Покажи все'];
      const cityButtons = [
        'Москва',
        'Санкт-Петербург',
        'Екатеринбург',
        'Новосибирск',
        'Казань',
        'Нижний Новгород',
        'Другой город',
      ];
      const followUp = hasValidCity
        ? `Что вам интересно в городе ${normalizedCity}?`
        : 'В каком городе будем искать мероприятия?';

      const lastAssistantButtonsForContext =
        kind === 'ack' ? await getLastAssistantButtons(userId, sessionId) : [];
      const shouldRepeatCategoryQuestion =
        kind === 'ack' &&
        hasValidCity &&
        hasCategoryButtons(lastAssistantButtonsForContext) &&
        (await shouldRepromptCategoryForAckViaLlm({
          userId,
          sessionId,
          userMessage: rawUserText,
          normalizedCity,
          requestId,
        }));

      if (shouldRepeatCategoryQuestion) {
        return {
          kind: 'reply',
          response: {
            message: `Не совсем понял категорию. ${followUp}`,
            buttons: categoryButtons,
            offer: null,
          },
        };
      }

      const fallbackPrefix = (() => {
        if (kind === 'thanks') return 'Пожалуйста!';
        if (kind === 'ack') return 'Понял.';
        if (/как\s+дела|как\s+ты|как\s+жизнь/iu.test(rawUserText)) return 'Всё хорошо, спасибо!';
        return 'Здравствуйте.';
      })();

      let generatedText = '';
      let rawLlmSmalltalkText = '';
      try {
        const systemPrompt = buildSmalltalkSystemPrompt({ kind, hasValidCity, normalizedCity });
        const messages = [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: rawUserText || '...' },
        ];
        const normalized = await requestAssistantMessage(
          messages,
          userId,
          sessionId,
          'smalltalk',
          1,
          0.6,
          requestId,
          220
        );
        const candidate = String(normalized?.text || '').trim();
        rawLlmSmalltalkText = candidate;
        if (candidate) {
          const sanitized = sanitizeSmalltalkText(candidate, { kind, normalizedCity });
          const first = pickFirstSentence(sanitized);
          const forbidden =
            kind !== 'farewell' &&
            /(?<![A-Za-zА-Яа-яЁё0-9_])(?:пиш(?:и|ите)|напиш(?:и|ите))(?![A-Za-zА-Яа-яЁё0-9_])/iu.test(
              first
            );
          const bulletLike = /^\s*[-•*]+\s*/u.test(first);
          generatedText = !forbidden && !bulletLike ? first : '';
        }
      } catch (error) {
        console.warn(
          `⚠️ [${userId}][${sessionId}] Не удалось сгенерировать smalltalk-ответ через LLM:`,
          error
        );
      }

      if (kind === 'farewell') {
        return {
          kind: 'reply',
          response: {
            message: ensureFarewellHasHelp(generatedText || 'До встречи!'),
            buttons: [],
            offer: null,
          },
        };
      }

      // Для "ок/спасибо" не надо снова вести к подбору — отвечаем коротко и без кнопок.
      if (kind === 'ack' || kind === 'thanks') {
        const relaxedLlmText = (() => {
          const first = pickFirstSentence(rawLlmSmalltalkText);
          if (!/[А-Яа-яЁё]/u.test(first)) return '';
          if (/^\s*[-•*]+\s*/u.test(first)) return '';
          return first;
        })();
        return {
          kind: 'reply',
          response: {
            message: generatedText || relaxedLlmText || fallbackPrefix,
            buttons: [],
            offer: null,
          },
        };
      }

      const prefix = (generatedText || fallbackPrefix).replace(/[.!…]*$/u, '.');
      return {
        kind: 'reply',
        response: {
          message: `${prefix} ${followUp}`,
          buttons: hasValidCity ? categoryButtons : cityButtons,
          offer: null,
        },
      };
    }
  }
  return null;
}
