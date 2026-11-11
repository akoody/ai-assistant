function extractNumberedSegments(text) {
  const normalizedText = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  const listItemPattern = /^\s*(\d{1,2})[\.)]\s+/gm;
  const matches = [...normalizedText.matchAll(listItemPattern)];
  if (matches.length === 0) {
    return [];
  }
  return matches.map((m, idx) => {
    const num = Number.parseInt(m[1], 10);
    const start = m.index ?? 0;
    const end = matches[idx + 1]?.index ?? normalizedText.length;
    return {
      num,
      start,
      end,
      segment: normalizedText.slice(start, end),
    };
  });
}

function hasOfferListArtifacts(text = '') {
  const source = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();

  if (!source) {
    return false;
  }

  return (
    /^\s*\d{1,2}[.)]\s+\S/m.test(source) ||
    /(?:^|\n)\s*(?:дата\s+и\s+время|место(?:\s+проведения)?|описание|цена)\s*[:\-—–]/iu.test(source)
  );
}

function extractOfferTailAfterLastSegment(text = '') {
  const source = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  const segments = extractNumberedSegments(source);
  if (segments.length === 0) {
    return '';
  }
  return source.slice(segments[segments.length - 1].end).trim();
}

function getMissingDescriptionNumbers(text, expectedCount) {
  const expected = Number.isFinite(expectedCount) ? expectedCount : 0;
  if (!text || expected <= 0) {
    return [];
  }
  const segments = extractNumberedSegments(text);
  const missing = [];
  for (let i = 1; i <= expected; i++) {
    const segment = segments.find((s) => s.num === i)?.segment || '';
    // Принимаем распространённые варианты оформления поля "Описание".
    if (!/(?:^|\n)\s*описание\s*(?::|—|–|-|\n)/iu.test(segment)) {
      missing.push(i);
    }
  }
  return missing;
}

function normalizeForMatch(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[\u2010\u2011\u2012\u2013\u2014]/g, '-')
    .replace(/[«»„“”"']/g, ' ')
    .replace(/[(){}\[\],.!?:;+/\\|*=_~`<>]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const TITLE_STOP_WORDS = new Set([
  'концерт',
  'шоу',
  'спектакль',
  'выставка',
  'мюзикл',
  'группа',
  'оркестр',
  'хиты',
  'мировые',
  'рок',
  'поп',
  'джаз',
  'классика',
]);

function tokenizeForMatch(value) {
  const normalized = normalizeForMatch(value);
  if (!normalized) return [];
  return normalized
    .split(' ')
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => t.length >= 2)
    .filter((t) => !TITLE_STOP_WORDS.has(t));
}

function fuzzyTokenMatch(tokenA, tokenB) {
  if (tokenA === tokenB) return true;
  const minLen = Math.min(tokenA.length, tokenB.length);
  if (minLen < 3) return false;
  const prefixLen = Math.max(3, minLen - 2);
  return tokenA.slice(0, prefixLen) === tokenB.slice(0, prefixLen);
}

function titleMatchesResponseText(title, responseText) {
  const normalizedTitle = normalizeForMatch(title);
  const normalizedText = normalizeForMatch(responseText);

  if (!normalizedTitle || !normalizedText) return false;

  if (normalizedText.includes(normalizedTitle)) return true;

  const titleTokens = tokenizeForMatch(title);
  if (titleTokens.length === 0) return false;

  const textTokens = tokenizeForMatch(responseText);
  const textTokenSet = new Set(textTokens);
  const matched = titleTokens.filter((t) => textTokenSet.has(t));
  const ratio = matched.length / titleTokens.length;

  if (ratio >= 0.7) return true;
  if (titleTokens.length >= 4 && matched.length >= 3) return true;

  const fuzzyMatched = titleTokens.filter((tt) => textTokens.some((rt) => fuzzyTokenMatch(tt, rt)));
  const fuzzyRatio = fuzzyMatched.length / titleTokens.length;

  if (fuzzyRatio >= 0.8) return true;

  return false;
}

function extractEventOrderFromLlmResponse(responseText, offerEvents, normalizeForSearch) {
  if (!responseText || !Array.isArray(offerEvents) || offerEvents.length === 0) {
    return offerEvents;
  }

  // Паттерн для поиска нумерованных элементов (1., 2., 3. и т.д.)
  // Ищем строки, начинающиеся с цифр, за которыми следует точка или скобка
  const listItemPattern = /^\s*(\d{1,2})[\.)]\s+(.+?)(?=^\s*\d{1,2}[\.)]\s+|$)/gms;
  const matches = [...responseText.matchAll(listItemPattern)];

  if (matches.length === 0) {
    // Если нет нумерации, возвращаем исходный порядок
    return offerEvents;
  }

  // Для каждого нумерованного пункта в тексте ищем соответствующее событие
  const orderedEvents = [];
  const usedIndices = new Set();

  matches.forEach((match) => {
    const itemText = match[2] || '';
    const normalizedItemText = normalizeForSearch(itemText);

    // Ищем событие с наибольшим совпадением в этом пункте
    let bestMatch = null;
    let bestMatchScore = 0;

    offerEvents.forEach((event, index) => {
      if (usedIndices.has(index)) {
        return; // Событие уже использовано
      }

      const title = (event.title || '').trim();
      if (!title) return;

      const normalizedTitle = normalizeForSearch(title);

      // 1. Проверяем точное совпадение в исходном тексте
      if (itemText.includes(title)) {
        bestMatch = index;
        bestMatchScore = 100;
        return;
      }

      // 2. Проверяем точное совпадение в нормализованном тексте
      if (normalizedItemText.includes(normalizedTitle)) {
        bestMatch = index;
        bestMatchScore = 100;
        return;
      }

      // 3. Проверяем по значимым словам (слова длиннее 2 символов)
      const titleWords = title.split(/\s+/).filter((w) => w.length > 2);
      if (titleWords.length > 0) {
        const foundWords = titleWords.filter((word) => {
          const wordLower = word.toLowerCase().replace(/ё/g, 'е');
          const wordPattern = new RegExp(
            `\\b${wordLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
            'i'
          );
          return wordPattern.test(normalizedItemText);
        });
        const matchRatio = foundWords.length / titleWords.length;

        // Обновляем лучший матч, если этот лучше
        if (matchRatio > bestMatchScore / 100) {
          bestMatch = index;
          bestMatchScore = matchRatio * 100;
        }
      }
    });

    // Если нашли событие с достаточным совпадением, добавляем его
    if (bestMatch !== null && bestMatchScore >= 50) {
      orderedEvents.push(offerEvents[bestMatch]);
      usedIndices.add(bestMatch);
    }
  });

  // Если не смогли найти события по нумерации, возвращаем исходный порядок
  if (orderedEvents.length === 0) {
    return offerEvents;
  }

  return orderedEvents;
}

function selectEventsDescribedInResponse(
  responseText,
  offerEvents,
  { userId = 'test', sessionId = 'test' } = {}
) {
  if (!responseText || !Array.isArray(offerEvents) || offerEvents.length === 0) {
    return null;
  }

  const extractContiguousNumberedCount = (text) => {
    const normalizedText = String(text || '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');
    const listItemPattern = /^\s*(\d{1,2})[\.)]\s+\S/gm;
    const matches = [...normalizedText.matchAll(listItemPattern)];
    const nums = matches
      .map((m) => parseInt(m[1], 10))
      .filter((n) => Number.isFinite(n) && n >= 1 && n <= 10);
    if (nums.length === 0) return 0;
    const uniqueSorted = [...new Set(nums)].sort((a, b) => a - b);
    let contiguous = 0;
    for (let i = 1; i <= 10; i += 1) {
      if (uniqueSorted.includes(i)) contiguous = i;
      else break;
    }
    return contiguous;
  };

  const normalizeForSearch = (text) => normalizeForMatch(text);
  const normalizedResponseText = normalizeForSearch(responseText);
  const numberedEventsCount = extractContiguousNumberedCount(responseText);

  const describedEvents = offerEvents.filter((event) => {
    const title = (event.title || '').trim();
    if (!title) return false;
    return (
      titleMatchesResponseText(title, responseText) ||
      normalizedResponseText.includes(normalizeForSearch(title))
    );
  });

  console.log(
    `📊 [${userId}][${sessionId}] Анализ описанных событий: ` +
      `пронумерованных=${numberedEventsCount}, найдено по названиям=${describedEvents.length}, ожидалось=${offerEvents.length}`
  );

  const orderedEvents =
    numberedEventsCount > 0
      ? extractEventOrderFromLlmResponse(responseText, offerEvents, normalizeForSearch)
      : [];

  const shouldPreferMatchedTitles =
    describedEvents.length > 0 &&
    orderedEvents.length > 0 &&
    orderedEvents.length < describedEvents.length;

  if (shouldPreferMatchedTitles) {
    console.warn(
      `⚠️ [${userId}][${sessionId}] Восстановление порядка по нумерации вернуло только ${orderedEvents.length} ` +
        `событий, хотя по названиям найдено ${describedEvents.length}. Использую список по названиям, чтобы не терять карточки.`
    );
  }

  if (numberedEventsCount >= offerEvents.length || describedEvents.length >= offerEvents.length) {
    console.log(
      `✅ [${userId}][${sessionId}] Количество пронумерованных описаний (${numberedEventsCount}) или найденных по названиям (${describedEvents.length}) >= количества событий (${offerEvents.length}). ` +
        `Восстанавливаю порядок событий из текста LLM.`
    );

    if (!shouldPreferMatchedTitles && orderedEvents.length > 0) {
      return orderedEvents;
    }

    return describedEvents.length > 0 ? describedEvents : offerEvents;
  }

  if (numberedEventsCount > 0) {
    if (!shouldPreferMatchedTitles && orderedEvents.length > 0) {
      console.log(
        `✅ [${userId}][${sessionId}] Восстанавливаю порядок ${orderedEvents.length} событий из текста LLM (из ${offerEvents.length}).`
      );
      return orderedEvents;
    }

    if (describedEvents.length > 0) {
      console.warn(
        `⚠️ [${userId}][${sessionId}] Нумерованный разбор дал меньше событий, чем поиск по названиям ` +
          `(${orderedEvents.length} против ${describedEvents.length}). Отправляю найденные по названиям события.`
      );
      return describedEvents;
    }
  }

  if (describedEvents.length > 0) {
    console.warn(
      `⚠️ [${userId}][${sessionId}] LLM описала только ${describedEvents.length} из ${offerEvents.length} событий ` +
        `(пронумерованных описаний: ${numberedEventsCount}). ` +
        `Отправляю только описанные события, чтобы избежать несоответствия между текстом и карточками.`
    );
    return describedEvents;
  }

  console.warn(
    `⚠️ [${userId}][${sessionId}] Не найдено описанных событий по названиям (пронумерованных: ${numberedEventsCount}). ` +
      `Использую все события.`
  );
  return offerEvents;
}

function shouldRecoverFullOfferAfterPartialLlmList({
  offerEvents,
  describedEventsList,
  assistantText,
} = {}) {
  if (!Array.isArray(offerEvents) || offerEvents.length === 0) {
    return false;
  }

  if (!Array.isArray(describedEventsList) || describedEventsList.length === 0) {
    return false;
  }

  if (describedEventsList.length >= offerEvents.length) {
    return false;
  }

  const numberedSegmentsCount = extractNumberedSegments(String(assistantText || '')).length;
  const missingDescriptions = getMissingDescriptionNumbers(
    assistantText,
    Math.min(describedEventsList.length, offerEvents.length)
  );

  return numberedSegmentsCount < offerEvents.length || missingDescriptions.length > 0;
}

export {
  extractNumberedSegments,
  hasOfferListArtifacts,
  extractOfferTailAfterLastSegment,
  getMissingDescriptionNumbers,
  normalizeForMatch,
  tokenizeForMatch,
  titleMatchesResponseText,
  selectEventsDescribedInResponse,
  shouldRecoverFullOfferAfterPartialLlmList,
};
