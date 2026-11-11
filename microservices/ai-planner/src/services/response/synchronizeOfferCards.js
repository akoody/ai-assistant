import { extractNumberedSegments } from './offerText.js';
import { extractOfferTailAfterLastSegment } from './offerText.js';
import { hasOfferListArtifacts } from './offerText.js';
import { buildStrictOfferTextFromEvents } from './offerText.js';
import { getOfferFallbackIntro } from './offerText.js';
import { getKnownCityValue } from './slotUtils.js';
import { getKnownEventTypeValue } from './slotUtils.js';

export async function synchronizeOfferCards({
  assistantResponse,
  eventsForResponse,
  isEventDetailsRequest,
  userId,
  sessionId,
  hasPreviouslyShownEvents,
  popularSelectionUsedForSearch,
  effectiveSlots,
}) {
  if (
    assistantResponse.text &&
    eventsForResponse &&
    eventsForResponse.length > 0 &&
    !isEventDetailsRequest
  ) {
    const extractContiguousNumberedCount = (text) => {
      const listItemPattern = /(?:^|\n)\s*(\d{1,2})[\.)]\s+\S/gm;
      const matches = [...String(text || '').matchAll(listItemPattern)];
      const nums = matches
        .map((m) => parseInt(m[1], 10))
        .filter((n) => Number.isFinite(n) && n >= 1 && n <= 10);
      if (nums.length === 0) return 0;
      const uniqueSorted = [...new Set(nums)].sort((a, b) => a - b);
      let contiguous = 0;
      for (let i = 1; i <= 10; i++) {
        if (uniqueSorted.includes(i)) contiguous = i;
        else break;
      }
      return contiguous;
    };

    const truncateToNumberedCount = (text, keepCount) => {
      if (!text || keepCount <= 0) return text;
      const t = String(text);
      const itemRegex = /(?:^|\n)\s*(\d{1,2})[\.)]\s+/gm;
      const matches = [...t.matchAll(itemRegex)];
      if (matches.length === 0) return t;

      const idx = matches.findIndex((m) => parseInt(m[1], 10) === keepCount + 1);
      if (idx === -1) return t;
      const cutPos = matches[idx].index;
      if (typeof cutPos !== 'number' || cutPos <= 0) return t;
      return t.slice(0, cutPos).trim();
    };

    const textCount = extractContiguousNumberedCount(assistantResponse.text);
    const rawNumberedCount = extractNumberedSegments(assistantResponse.text).length;
    const cardsCount = eventsForResponse.length;
    const rawTail = extractOfferTailAfterLastSegment(assistantResponse.text);
    const hasLeakingOfferTail = hasOfferListArtifacts(rawTail);

    if (
      (textCount > 0 && cardsCount !== textCount) ||
      (rawNumberedCount > 0 && rawNumberedCount !== cardsCount) ||
      hasLeakingOfferTail
    ) {
      console.warn(
        `⚠️ [${userId}][${sessionId}] Синхронизация: текст и карточки разошлись ` +
          `(contiguous=${textCount}, raw=${rawNumberedCount}, cards=${cardsCount}, leakingTail=${hasLeakingOfferTail}). ` +
          `Пересобираю текст строго из карточек.`
      );
      assistantResponse.text = buildStrictOfferTextFromEvents(
        assistantResponse.text,
        eventsForResponse,
        {
          fallbackIntro: getOfferFallbackIntro(eventsForResponse, {
            hasPreviouslyShownEvents,
            popularSelectionUsed: popularSelectionUsedForSearch,
            cityName: getKnownCityValue(effectiveSlots),
          }),
          hasKnownEventType: Boolean(getKnownEventTypeValue(effectiveSlots)),
        }
      );
    } else {
      const finalCount = Math.min(cardsCount, textCount || cardsCount);
      if (cardsCount > finalCount) {
        console.warn(
          `⚠️ [${userId}][${sessionId}] Синхронизация: карточек (${cardsCount}) больше, чем пунктов текста (${textCount}). Обрезаю карточки до ${finalCount}.`
        );
        eventsForResponse = eventsForResponse.slice(0, finalCount);
      } else if (textCount > 0 && textCount > finalCount) {
        console.warn(
          `⚠️ [${userId}][${sessionId}] Синхронизация: пунктов текста (${textCount}) больше, чем карточек (${cardsCount}). Обрезаю текст до ${finalCount}.`
        );
        assistantResponse.text = truncateToNumberedCount(assistantResponse.text, finalCount);
      }
    }
  }

  return { assistantResponse, eventsForResponse };
}
