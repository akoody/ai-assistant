const CHINESE_CHAR_REGEX = /[\u3400-\u9FFF]/;
const OPTIONAL_DUPLICATE_BUTTON_LABELS = new Set(['покажи все', 'покажи всё']);
const HTML_ENTITY_MAP = Object.freeze({
  '&laquo;': '«',
  '&raquo;': '»',
  '&ldquo;': '“',
  '&rdquo;': '”',
  '&lsquo;': '‘',
  '&rsquo;': '’',
  '&quot;': '"',
  '&apos;': "'",
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&mdash;': '—',
  '&ndash;': '–',
  '&nbsp;': ' ',
  '&hellip;': '…',
});
const AWKWARD_RUSSIAN_PATTERNS = Object.freeze([
  {
    pattern: /давайте\s+сразу\s+начн[её]м\s+поиск\s+по\s+интересующему\s+вас\s+направлению\?/giu,
    replacement: 'Давайте сразу начнем подбор: что вас интересует?',
  },
  {
    pattern: /в\s+каком\s+жанре\s+или\s+чем\s+именно\s+вас\s+интересует\?/giu,
    replacement: 'Какой жанр вас интересует?',
  },
  {
    pattern: /какую\s+дату\s+интересует\?/giu,
    replacement: 'Какая дата вас интересует?',
  },
  {
    pattern: /чем\s+именно\s+вас\s+интересует\?/giu,
    replacement: 'Что именно вас интересует?',
  },
  {
    pattern: /в\s+каком\s+жанре\s+концертов\s+вы\s+предпочитаете\?/giu,
    replacement: 'Какой жанр концертов вам ближе?',
  },
  {
    pattern: /какой\s+жанр\s+концерты\s+вам\s+ближе\??/giu,
    replacement: 'Какой жанр концертов вам ближе?',
  },
  {
    pattern: /какой\s+жанр\s+театры\s+вам\s+ближе\??/giu,
    replacement: 'Какой жанр спектаклей вам ближе?',
  },
  {
    pattern: /какой\s+жанр\s+выставки\s+вам\s+ближе\??/giu,
    replacement: 'Какой жанр выставок вам ближе?',
  },
  {
    pattern: /какой\s+жанр\s+музеи\s+вам\s+ближе\??/giu,
    replacement: 'Какой жанр экспозиций вам ближе?',
  },
  {
    pattern: /в\s+каком\s+жанре\s+мероприятия\s+вам\s+больше\s+всего\s+нравится\?/giu,
    replacement: 'Какой жанр мероприятия вам ближе?',
  },
  {
    pattern: /что\s+тебя\s+больше\s+интересует/giu,
    replacement: 'Что вас больше интересует',
  },
  {
    pattern: /интересующему\s+вас\s+направлению/giu,
    replacement: 'вашему запросу',
  },
  {
    pattern: /какая\s+сумма\s+у\s+вас\s+ограничивает\s+стоимость\s+билета(?:\s+на\s+концерт)?\?/giu,
    replacement: 'Какой бюджет на билет вам подходит?',
  },
  {
    pattern:
      /какой\s+бюджет\s+на\s+билет\s+вам\s+подходит\s+следующ(?:ий|ем)\s+месяц(?:е)?\s+в\s+/giu,
    replacement: 'Какой бюджет на билет вам подходит в следующем месяце в ',
  },
  {
    pattern:
      /какой\s+бюджет\s+на\s+билет\s+вам\s+подходит\s+будущ(?:ий|ем)\s+месяц(?:е)?\s+в\s+/giu,
    replacement: 'Какой бюджет на билет вам подходит в будущем месяце в ',
  },
  {
    pattern: /(?<![A-Za-zА-Яа-яЁё0-9_])в\s+следующую\s+неделю(?![A-Za-zА-Яа-яЁё0-9_])/giu,
    replacement: 'на следующей неделе',
  },
  {
    pattern: /(?<![A-Za-zА-Яа-яЁё0-9_])на\s+следующая\s+неделя(?![A-Za-zА-Яа-яЁё0-9_])/giu,
    replacement: 'на следующей неделе',
  },
  {
    pattern: /(?<![A-Za-zА-Яа-яЁё0-9_])на\s+среда(?![A-Za-zА-Яа-яЁё0-9_])/giu,
    replacement: 'на среду',
  },
  {
    pattern: /(?<![A-Za-zА-Яа-яЁё0-9_])на\s+пятница(?![A-Za-zА-Яа-яЁё0-9_])/giu,
    replacement: 'на пятницу',
  },
  {
    pattern: /(?<![A-Za-zА-Яа-яЁё0-9_])на\s+суббота(?![A-Za-zА-Яа-яЁё0-9_])/giu,
    replacement: 'на субботу',
  },
  {
    pattern: /(?<![A-Za-zА-Яа-яЁё0-9_])на\s+следующие\s+выходные(?![A-Za-zА-Яа-яЁё0-9_])/giu,
    replacement: 'на следующих выходных',
  },
  {
    pattern:
      /(?:погода|новости|финансы|политика|бытовые\s+вопросы)\s+меня\s+не\s+специализируется/giu,
    replacement: 'Тут не подскажу',
  },
  {
    pattern: /какие\s+события\s+вам\s+сейчас\s+подойдут\?/giu,
    replacement: 'Что вам сейчас интересно?',
  },
  {
    pattern: /какое\s+событие\s+вас\s+больше\s+всего\s+заинтересует\??/giu,
    replacement: 'Что вам сейчас интересно?',
  },
  {
    pattern: /их\s+не\s+подошло/giu,
    replacement: 'они не подошли',
  },
  {
    pattern: /рад\s+уделить\s+внимание\s+вашим\s+предпочтениям(?:[,.!?\s]+|$)/giu,
    replacement: 'Учту ваши предпочтения. ',
  },
  {
    pattern: /видите\s+ли(?:[,.!?\s]+|$)/giu,
    replacement: '',
  },
]);

function normalizeButtonLabel(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ');
}

function decodeHtmlEntities(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return text;
  }

  let decoded = text;
  for (const [entity, char] of Object.entries(HTML_ENTITY_MAP)) {
    decoded = decoded.replace(new RegExp(entity, 'gi'), char);
  }

  decoded = decoded.replace(/&#(\d+);/g, (_match, num) =>
    String.fromCharCode(Number.parseInt(num, 10))
  );
  decoded = decoded.replace(/&#x([0-9A-Fa-f]+);/g, (_match, hex) =>
    String.fromCharCode(Number.parseInt(hex, 16))
  );

  return decoded;
}

function preserveSentenceCase(sourceText, replacementText) {
  if (!sourceText || !replacementText) {
    return replacementText;
  }

  const firstLetter = String(sourceText).trim().charAt(0);
  if (firstLetter && firstLetter === firstLetter.toUpperCase()) {
    return replacementText.charAt(0).toUpperCase() + replacementText.slice(1);
  }

  return replacementText.charAt(0).toLowerCase() + replacementText.slice(1);
}

export function containsAwkwardRussianPhrasing(text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return false;
  }

  return AWKWARD_RUSSIAN_PATTERNS.some(({ pattern }) => {
    pattern.lastIndex = 0;
    return pattern.test(text);
  });
}

export function fixCommonAwkwardRussianPhrasing(text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return text;
  }

  let result = text;
  AWKWARD_RUSSIAN_PATTERNS.forEach(({ pattern, replacement }) => {
    result = result.replace(pattern, (match) => preserveSentenceCase(match, replacement));
  });

  return result;
}

function stripTrailingInlineButtonList(text, allowedButtons) {
  if (typeof text !== 'string' || text.trim().length === 0 || allowedButtons.size === 0) {
    return text;
  }

  const lines = text.split('\n');
  const lastLineIndex = lines.length - 1;
  const lastLine = lines[lastLineIndex];
  const buttonsMarkerMatch = lastLine.match(/(?<![A-Za-zА-Яа-яЁё0-9_])(?:Кнопки|Buttons)\s*:\s*/i);
  const colonIndex = buttonsMarkerMatch
    ? buttonsMarkerMatch.index + buttonsMarkerMatch[0].length - 1
    : lastLine.lastIndexOf(':');

  if (colonIndex === -1) {
    return text;
  }

  const prefix = lastLine.slice(0, colonIndex + 1);
  const suffix = lastLine.slice(colonIndex + 1).trim();
  if (!suffix) {
    return text;
  }

  const items = suffix
    .split(/\s*(?:\||,|;|\t)\s*/)
    .map((item) => item.trim())
    .filter(Boolean);

  const minimumMatchCount = Math.min(3, Math.max(2, allowedButtons.size));
  if (items.length < minimumMatchCount) {
    return text;
  }

  const everyItemMatches = items.every((item) => allowedButtons.has(normalizeButtonLabel(item)));
  if (!everyItemMatches) {
    return text;
  }

  lines[lastLineIndex] = buttonsMarkerMatch
    ? lastLine.slice(0, buttonsMarkerMatch.index).trimEnd()
    : prefix.trimEnd();
  return lines.join('\n').trim();
}

function stripTrailingButtonLines(text, allowedButtons) {
  if (typeof text !== 'string' || text.trim().length === 0 || allowedButtons.size === 0) {
    return text;
  }

  const lines = text.split('\n');
  let trailingDuplicateCount = 0;

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const normalizedLine = normalizeButtonLabel(lines[index]);
    if (!normalizedLine) {
      if (trailingDuplicateCount > 0) {
        continue;
      }
      break;
    }

    if (!allowedButtons.has(normalizedLine)) {
      break;
    }

    trailingDuplicateCount += 1;
  }

  if (trailingDuplicateCount < 2) {
    return text;
  }

  let removed = 0;
  while (removed < trailingDuplicateCount && lines.length > 0) {
    lines.pop();
    removed += 1;
  }

  while (lines.length > 0 && !lines[lines.length - 1].trim()) {
    lines.pop();
  }

  return lines.join('\n').trim();
}

export function stripDuplicatedButtonLabels(text, buttons = []) {
  if (
    typeof text !== 'string' ||
    text.trim().length === 0 ||
    !Array.isArray(buttons) ||
    buttons.length === 0
  ) {
    return text;
  }

  const allowedButtons = new Set(
    buttons.map((button) => normalizeButtonLabel(button)).filter(Boolean)
  );

  OPTIONAL_DUPLICATE_BUTTON_LABELS.forEach((button) =>
    allowedButtons.add(normalizeButtonLabel(button))
  );

  let cleanedText = stripTrailingButtonLines(text, allowedButtons);
  cleanedText = stripTrailingInlineButtonList(cleanedText, allowedButtons);

  return cleanedText;
}

function sanitizeJsonForParsing(jsonText) {
  if (typeof jsonText !== 'string' || jsonText.length === 0) {
    return jsonText;
  }

  let result = '';
  let insideString = false;
  let escape = false;

  for (let i = 0; i < jsonText.length; i += 1) {
    const char = jsonText[i];

    if (insideString) {
      if (escape) {
        result += char;
        escape = false;
        continue;
      }

      if (char === '\\') {
        result += char;
        escape = true;
        continue;
      }

      if (char === '"') {
        insideString = false;
        result += char;
        continue;
      }

      if (char === '\n') {
        result += '\\n';
        continue;
      }

      if (char === '\r') {
        result += '\\r';
        continue;
      }

      if (char === '\t') {
        result += '\\t';
        continue;
      }

      result += char;
      continue;
    }

    result += char;

    if (char === '"') {
      insideString = true;
      escape = false;
    }
  }

  return result;
}

function extractTextAndButtonsFromJsonLike(content) {
  if (typeof content !== 'string' || content.length === 0) {
    return null;
  }

  const textMatch = content.match(/"text"\s*:\s*"([\s\S]*?)"\s*(,|\})/);
  if (!textMatch) {
    return null;
  }

  let extractedText = textMatch[1]
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .trim();

  return {
    text: extractedText,
    buttons: [],
  };
}

function extractButtonsFromTextBlock(text) {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return { text: typeof text === 'string' ? text : '', buttons: [] };
  }

  const markerRegex = /(^|\n|[.!?…]\s+)(?:Кнопки|Buttons)\s*:\s*/i;
  const markerMatch = text.match(markerRegex);
  if (!markerMatch) {
    return { text, buttons: [] };
  }

  const markerIndex = markerMatch.index + markerMatch[1].length;
  const markerEndIndex = markerMatch.index + markerMatch[0].length;
  const afterMarker = text.slice(markerEndIndex);

  const bracketMatch = afterMarker.match(/\[([\s\S]{0,800}?)\]/);
  const inside = bracketMatch ? bracketMatch[1] : afterMarker;

  const buttons = [];
  const pushUnique = (value) => {
    const trimmed = String(value || '').trim();
    if (!trimmed) return;
    if (!buttons.includes(trimmed)) buttons.push(trimmed);
  };

  const quoteMatches = inside.match(/"([^"\n\r]+)"/g);
  if (quoteMatches && quoteMatches.length > 0) {
    quoteMatches.forEach((m) => pushUnique(m.replace(/^"|"$/g, '')));
  } else {
    const angleMatches = inside.match(/«([^»\n\r]+)»/g);
    if (angleMatches && angleMatches.length > 0) {
      angleMatches.forEach((m) => pushUnique(m.replace(/^«|»$/g, '')));
    } else {
      inside
        .split(/\s*(?:\||\n|,|;|\t)\s*/)
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach(pushUnique);
    }
  }

  if (buttons.length === 0) {
    return { text, buttons: [] };
  }

  const cleanedText = text.slice(0, markerIndex).trim();
  return { text: cleanedText, buttons };
}

function normalizeButtonsArray(rawButtons) {
  if (!Array.isArray(rawButtons)) {
    return [];
  }

  const normalizedButtons = [];
  const seen = new Set();

  const pushUnique = (value) => {
    const trimmed = decodeHtmlEntities(String(value || '')).trim();
    if (!trimmed) {
      return;
    }

    const key = trimmed.toLowerCase().replace(/ё/g, 'е');
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    normalizedButtons.push(trimmed);
  };

  rawButtons.forEach((button) => {
    if (typeof button === 'string') {
      pushUnique(button);
      return;
    }

    if (!button || typeof button !== 'object' || Array.isArray(button)) {
      return;
    }

    if (typeof button.text === 'string') {
      pushUnique(button.text);
      return;
    }

    Object.entries(button).forEach(([key, value]) => {
      if (typeof key === 'string' && key.trim() && value) {
        pushUnique(key);
      }
    });
  });

  return normalizedButtons;
}

export function stripJsonArtifacts(text) {
  if (!text || typeof text !== 'string') {
    return '';
  }
  let cleaned = decodeHtmlEntities(text)
    .replace(/```json[\s\S]*?```/gi, '')
    .replace(/```[\s\S]*?```/g, '');

  if (/^\s*\{[\s\S]*\}\s*$/.test(cleaned)) {
    return '';
  }

  cleaned = cleaned
    .replace(/\{[\s\S]*?\}/g, ' ')
    .replace(/"buttons"\s*:\s*\[[^\]]*?\]/gi, ' ')
    .replace(/"text"\s*:\s*/gi, ' ')
    .replace(/[,{}]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return cleaned.trim();
}

export function normalizeAssistantResponse(rawContent) {
  const fallbackText = 'Извините, не удалось сформировать ответ.';

  const fallback = {
    text: fallbackText,
    buttons: [],
    raw: rawContent ?? '',
    parsedFromJson: false,
  };

  if (typeof rawContent !== 'string' || rawContent.trim().length === 0) {
    return fallback;
  }

  // Сначала пробуем извлечь JSON из смешанного контента
  const jsonMatch = rawContent.match(/\{[\s\S]*\}/);
  let cleaned = '';

  if (jsonMatch) {
    // Если найден JSON блок, используем его
    cleaned = jsonMatch[0];
  } else {
    // Иначе очищаем как раньше
    cleaned = rawContent
      .replace(/```json\s*/gi, '')
      .replace(/```\s*/g, '')
      .trim();
  }

  try {
    const parsed = JSON.parse(cleaned);
    let text = typeof parsed.text === 'string' ? decodeHtmlEntities(parsed.text).trim() : '';
    let buttons = normalizeButtonsArray(parsed.buttons);

    const extracted = extractButtonsFromTextBlock(text);
    if (extracted.buttons.length > 0) {
      text = extracted.text;
      if (buttons.length === 0) {
        buttons = extracted.buttons;
      }
    }

    const hasMeaningfulStructuredContent = Boolean(text) || buttons.length > 0;
    if (!hasMeaningfulStructuredContent) {
      return fallback;
    }

    text = stripDuplicatedButtonLabels(text, buttons);

    // Очищаем текст: удаляем markdown, эмодзи и улучшаем форматирование
    let cleanedText = text;
    if (cleanedText) {
      cleanedText = removeMarkdownFormatting(cleanedText);
      cleanedText = removeEmojis(cleanedText);
      cleanedText = improveTextFormatting(cleanedText);
    } else {
      cleanedText = fallback.text;
    }

    return {
      text: cleanedText || fallback.text,
      buttons,
      raw: rawContent,
      parsedFromJson: true,
    };
  } catch (_error) {
    const sanitized = sanitizeJsonForParsing(cleaned);
    if (sanitized !== cleaned) {
      try {
        const parsed = JSON.parse(sanitized);
        const text = typeof parsed.text === 'string' ? decodeHtmlEntities(parsed.text).trim() : '';
        const buttons = normalizeButtonsArray(parsed.buttons);
        if (!text && buttons.length === 0) {
          return fallback;
        }
        return {
          text: stripDuplicatedButtonLabels(text, buttons) || fallback.text,
          buttons,
          raw: rawContent,
          parsedFromJson: true,
        };
      } catch (_nestedSanitizedError) {
        // ignore and continue
      }
    }

    const heuristics = extractTextAndButtonsFromJsonLike(cleaned);
    if (heuristics && heuristics.text) {
      const extracted = extractButtonsFromTextBlock(heuristics.text);
      let cleanedText = cleanResidualJsonArtifacts(extracted.text);
      // Очищаем текст: удаляем markdown, эмодзи и улучшаем форматирование
      if (cleanedText) {
        cleanedText = removeMarkdownFormatting(cleanedText);
        cleanedText = removeEmojis(cleanedText);
        cleanedText = improveTextFormatting(cleanedText);
      } else {
        cleanedText = fallback.text;
      }
      return {
        text:
          stripDuplicatedButtonLabels(
            cleanedText,
            extracted.buttons.length > 0 ? extracted.buttons : heuristics.buttons
          ) || fallback.text,
        buttons: extracted.buttons.length > 0 ? extracted.buttons : heuristics.buttons,
        raw: rawContent,
        parsedFromJson: false,
      };
    }

    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');

    // Если есть JSON в ответе, пытаемся его извлечь даже если перед ним есть текст
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const potentialJson = cleaned.slice(firstBrace, lastBrace + 1);
      try {
        const parsed = JSON.parse(potentialJson);
        const text = typeof parsed.text === 'string' ? decodeHtmlEntities(parsed.text).trim() : '';
        const buttons = normalizeButtonsArray(parsed.buttons);
        if (!text && buttons.length === 0) {
          return fallback;
        }
        // Очищаем текст: удаляем markdown, эмодзи и улучшаем форматирование
        let cleanedText = text;
        if (cleanedText) {
          cleanedText = removeMarkdownFormatting(cleanedText);
          cleanedText = removeEmojis(cleanedText);
          cleanedText = improveTextFormatting(cleanedText);
        } else {
          cleanedText = fallback.text;
        }
        return {
          text: stripDuplicatedButtonLabels(cleanedText, buttons) || fallback.text,
          buttons,
          raw: rawContent,
          parsedFromJson: true,
        };
      } catch (_nestedError) {
        const heuristicsNested = extractTextAndButtonsFromJsonLike(potentialJson);
        if (heuristicsNested && heuristicsNested.text) {
          let cleanedText = cleanResidualJsonArtifacts(heuristicsNested.text);
          // Очищаем текст: удаляем markdown, эмодзи и улучшаем форматирование
          if (cleanedText) {
            cleanedText = removeMarkdownFormatting(cleanedText);
            cleanedText = removeEmojis(cleanedText);
            cleanedText = improveTextFormatting(cleanedText);
          } else {
            cleanedText = fallback.text;
          }
          return {
            text:
              stripDuplicatedButtonLabels(cleanedText, heuristicsNested.buttons) || fallback.text,
            buttons: heuristicsNested.buttons,
            raw: rawContent,
            parsedFromJson: false,
          };
        }
      }
    }

    // Если JSON не нашли, но есть префикс (текст перед {), используем его
    const prefix = firstBrace > 0 ? cleaned.slice(0, firstBrace).trim() : '';
    if (prefix.length > 10) {
      const extracted = extractButtonsFromTextBlock(prefix);
      let cleanedText = cleanResidualJsonArtifacts(extracted.text);
      if (cleanedText) {
        cleanedText = removeMarkdownFormatting(cleanedText);
        cleanedText = removeEmojis(cleanedText);
        cleanedText = improveTextFormatting(cleanedText);
      } else {
        cleanedText = fallback.text;
      }
      return {
        text: stripDuplicatedButtonLabels(cleanedText, extracted.buttons) || fallback.text,
        buttons: extracted.buttons,
        raw: rawContent,
        parsedFromJson: false,
      };
    }

    const plain = stripJsonArtifacts(cleaned);
    if (plain) {
      const extracted = extractButtonsFromTextBlock(plain);
      let cleanedText = cleanResidualJsonArtifacts(extracted.text);
      // Очищаем текст: удаляем markdown, эмодзи и улучшаем форматирование
      if (cleanedText) {
        cleanedText = removeMarkdownFormatting(cleanedText);
        cleanedText = removeEmojis(cleanedText);
        cleanedText = improveTextFormatting(cleanedText);
      } else {
        cleanedText = fallback.text;
      }
      return {
        text: stripDuplicatedButtonLabels(cleanedText, extracted.buttons) || fallback.text,
        buttons: extracted.buttons,
        raw: rawContent,
        parsedFromJson: false,
      };
    }

    return fallback;
  }
}

export function containsChineseCharacters(text) {
  if (!text || typeof text !== 'string') {
    return false;
  }
  return CHINESE_CHAR_REGEX.test(text);
}

export function removeChineseCharacters(text) {
  if (!text || typeof text !== 'string') {
    return text;
  }
  return text.replace(CHINESE_CHAR_REGEX, '').trim();
}

export function containsNonCyrillic(text) {
  if (!text || typeof text !== 'string') return false;

  let cleaned = text;

  cleaned = cleaned.replace(/kassir\.ru/gi, '');

  cleaned = cleaned
    .replace(/[\u{1F600}-\u{1F64F}]/gu, '')
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, '')
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, '')
    .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '')
    .replace(/[\u{2600}-\u{26FF}]/gu, '')
    .replace(/[\u{2700}-\u{27BF}]/gu, '')
    .replace(/[\u{1F900}-\u{1F9FF}]/gu, '')
    .replace(/[\u{1FA00}-\u{1FA6F}]/gu, '')
    .replace(/[\u{1FA70}-\u{1FAFF}]/gu, '')
    .replace(/[\u{20E3}]/gu, '')
    .replace(/[\u{FE0F}]/gu, '')
    .replace(/[\u{200D}]/gu, '');

  const allowedPattern = /[а-яА-ЯёЁ0-9\s.,!?:;\-"'()[\]{}\/\\|@#$%^&*+=~`«»—–…№]/g;

  cleaned = cleaned.replace(allowedPattern, '');

  if (cleaned.length === 0) return false;

  if (/[\u3400-\u9FFF\uF900-\uFAFF]/.test(cleaned)) return true;

  if (/[a-zA-Z]/.test(cleaned)) {
    const latinCount = (cleaned.match(/[a-zA-Z]/g) || []).length;
    if (latinCount > 3) return true;
  }

  if (cleaned.length > 5) return true;

  return false;
}

export function hasForbiddenAssistantFeminineSelfReference(text) {
  const value = String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е');
  if (!value) return false;

  const forbiddenPatterns = [
    /(?:^|[^\p{L}\p{N}_])поняла(?=$|[^\p{L}\p{N}_])/u,
    /(?:^|[^\p{L}\p{N}_])смогла(?=$|[^\p{L}\p{N}_])/u,
    /(?:^|[^\p{L}\p{N}_])готова(?=$|[^\p{L}\p{N}_])/u,
    /(?:^|[^\p{L}\p{N}_])нашла(?=$|[^\p{L}\p{N}_])/u,
    /(?:^|[^\p{L}\p{N}_])подобрала(?=$|[^\p{L}\p{N}_])/u,
    /(?:^|[^\p{L}\p{N}_])увидела(?=$|[^\p{L}\p{N}_])/u,
    /(?:^|[^\p{L}\p{N}_])предложила(?=$|[^\p{L}\p{N}_])/u,
    /(?:^|[^\p{L}\p{N}_])подтвердила(?=$|[^\p{L}\p{N}_])/u,
    /(?:^|[^\p{L}\p{N}_])разобралась(?=$|[^\p{L}\p{N}_])/u,
    /(?:^|[^\p{L}\p{N}_])проверила(?=$|[^\p{L}\p{N}_])/u,
    /(?:^|[^\p{L}\p{N}_])запомнила(?=$|[^\p{L}\p{N}_])/u,
    /(?:^|[^\p{L}\p{N}_])уточнила(?=$|[^\p{L}\p{N}_])/u,
  ];

  return forbiddenPatterns.some((pattern) => pattern.test(value));
}

/**
 * Удаляет мусорный текст из ответа (немецкий текст, случайные фразы и т.д.)
 * @param {string} text - Текст для очистки
 * @returns {string} Очищенный текст
 */
export function removeGarbageText(text) {
  if (!text || typeof text !== 'string') {
    return text;
  }

  let cleaned = text;

  // Удаляем утекшие мета-инструкции вида "Directions:" (встречается перед нумерованным списком).
  cleaned = cleaned
    // "Directions:" отдельным блоком
    .replace(/Directions:\s*[\s\S]*?(?=(?:\n\s*\d+[.)]\s)|$)/gi, '')
    // "Directions:" склеено с русским текстом
    .replace(/([А-Яа-яЁё])Directions:\s*/g, '$1 ');

  cleaned = cleaned.replace(/\bchoose\s+one\b!?/gi, 'Выберите вариант:');
  cleaned = cleaned.replace(
    /(?:^|\n)\s*[-–—•]*\s*(?:выражайте|выражай)\s+благодарност[ьи]\.?\s*(?=\n|$)/gim,
    '\n'
  );
  cleaned = cleaned.replace(/\bexpress\s+gratitude\b\.?/gi, '');

  // КРИТИЧЕСКИ ВАЖНО: Удаляем блок со ссылками и лишней информацией
  // Паттерн 1: Удаляем всё после "Если нужна более развернутая информация" до конца
  cleaned = cleaned.replace(/Если нужна более развернутая информация[\s\S]*$/gi, '');

  // Паттерн 2: Удаляем всё после "Могу также предложить:" до конца
  cleaned = cleaned.replace(/Могу также предложить:[\s\S]*$/gi, '');

  // Паттерн 3: Удаляем блоки с URL ссылками на kassir.ru
  cleaned = cleaned.replace(/\d+\.\s*https?:\/\/[^\s]+kassir\.ru[^\s]*/gi, '');

  // Паттерн 4: Удаляем текст про регистрацию и подтверждение
  cleaned = cleaned.replace(/Для\s+любого\s+выбора[\s\S]*?подтверждение[^\n]*/gi, '');

  // Паттерн 5: Удаляем блоки с кнопками в тексте типа "buttons": [...]
  cleaned = cleaned.replace(/"buttons"\s*:\s*\[[\s\S]*?\]/gi, '');

  // Паттерн 6: Удаляем случайные JSON артефакты с текстом и кнопками
  cleaned = cleaned.replace(/"\s*"text"\s*:/gi, '');

  // Паттерн 7: Удаляем блоки с "Концерты. Уточните жанр..." и подобное
  cleaned = cleaned.replace(/Концерты\.\s*Уточните[\s\S]*?варианты\./gi, '');

  // Удаляем известные мусорные фразы
  const garbagePatterns = [
    /sagt\s+eigentlich\s+die[^\s]*/gi, // "sagt eigentlich die七" и подобное
    /eigentlich\s+die[^\s]*/gi, // "eigentlich die七"
    /die[^\s]*\s*$/gm, // "die七" в конце строки
    /commemorate\s+мцыЕ/gi, // "commemorate мцыЕ" - специфический галлюцинированный текст
    /commemorate/gi, // само слово "commemorate" в русском контексте скорее всего мусор
    /[^\u0000-\u007F\u0080-\u00FF\u0100-\u017F\u0180-\u024F\u1E00-\u1EFF\u0400-\u04FF\u0500-\u052F]+/g, // Нелатинские и некириллические символы (кроме уже обработанных китайских)
    /(?:Note|Translation|Generated by|Answer|Response|Explanation):/gi, // Английские мета-теги
    /(?:\b(?:the|and|is|are|was|were|have|has|had|will|would|can|could|should|this|that|these|those|there|here|what|when|where|why|how|a|an|of|to|in|on|at|by|from|it|for|with)\b\s*){3,}/gi, // Последовательности английских стоп-слов
  ];

  garbagePatterns.forEach((pattern) => {
    cleaned = cleaned.replace(pattern, '');
  });

  // Удаляем строки, которые содержат только мусорные символы или ссылки
  const lines = cleaned.split('\n');
  const cleanedLines = lines.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed) return true; // Оставляем пустые строки

    // Удаляем строки, которые содержат только URL
    if (/^https?:\/\//i.test(trimmed)) return false;

    // Удаляем строки типа "1. https://..."
    if (/^\d+\.\s*https?:\/\//i.test(trimmed)) return false;

    // Удаляем строки, которые содержат только мусорные символы или очень короткие мусорные фразы
    if (trimmed.length < 3) return false;
    if (/^[^\u0400-\u04FF\u0000-\u007F]+$/.test(trimmed)) return false; // Только некириллические и нелатинские символы

    return true;
  });

  cleaned = cleanedLines.join('\n');

  // Удаляем множественные пробелы и переносы
  cleaned = cleaned
    .replace(/\s{3,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return cleaned;
}

/**
 * Удаляет markdown форматирование из текста
 * @param {string} text - Текст с markdown форматированием
 * @returns {string} Текст без markdown форматирования
 */
export function removeMarkdownFormatting(text) {
  if (typeof text !== 'string') {
    return text;
  }

  let cleaned = text;

  // Удаляем жирный текст **текст** или __текст__
  // Используем нежадное совпадение для обработки любых символов, включая кавычки и другие спецсимволы
  // Обрабатываем множественные вхождения в цикле, пока есть пары
  let prevCleaned = '';
  let iterations = 0;
  const maxIterations = 10; // Защита от бесконечного цикла
  while (prevCleaned !== cleaned && iterations < maxIterations) {
    prevCleaned = cleaned;
    iterations++;
    // Удаляем **текст** (нежадное совпадение, обрабатывает любые символы кроме звездочек)
    // Используем [^*] для захвата любых символов кроме звездочки, включая пробелы, кавычки и т.д.
    cleaned = cleaned.replace(/\*\*([^*]*?)\*\*/g, '$1');
    // Удаляем __текст__
    cleaned = cleaned.replace(/__([^_]*?)__/g, '$1');
  }

  // Удаляем курсив *текст* или _текст_ (но не если это часть **текст**)
  cleaned = cleaned.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '$1');
  cleaned = cleaned.replace(/(?<!_)_([^_]+)_(?!_)/g, '$1');

  // Удаляем заголовки с решетками # ## ### и т.д.
  cleaned = cleaned.replace(/^#{1,6}\s+/gm, '');

  // Удаляем markdown ссылки [текст](url) → текст
  cleaned = cleaned.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');

  // Удаляем блоки кода ```код``` → код
  cleaned = cleaned.replace(/```[\s\S]*?```/g, (match) => {
    return match.replace(/```/g, '').trim();
  });

  // Удаляем незакрытые блоки кода в конце текста (оборванный вывод)
  cleaned = cleaned.replace(/```[a-zA-Z]*[\s\S]*$/i, '');

  // Удаляем inline код `код` → код
  cleaned = cleaned.replace(/`([^`]+)`/g, '$1');

  // Удаляем зачеркнутый текст ~~текст~~
  cleaned = cleaned.replace(/~~([^~]+)~~/g, '$1');

  // Удаляем списки с дефисами или звездочками в начале строки
  // Обрабатываем случаи, когда после дефиса может быть пробел и markdown форматирование
  cleaned = cleaned.replace(/^[\s]*[-*+]\s+/gm, '');

  // Также удаляем оставшиеся дефисы в начале строк (если они остались после удаления markdown)
  cleaned = cleaned.replace(/^\s*-\s+/gm, '');

  // НЕ удаляем нумерованные списки - они нужны для структуры

  // Убираем лишние пробелы после удаления форматирования (но сохраняем переносы строк)
  // НЕ заменяем множественные пробелы глобально, чтобы не нарушить форматирование
  // Только убираем пробелы в начале строк
  cleaned = cleaned.replace(/\n[ \t]+/g, '\n'); // Убираем пробелы в начале строк
  cleaned = cleaned.replace(/[ \t]+$/gm, ''); // Убираем пробелы в конце строк

  // Убираем пробелы только в начале и конце всего текста, но сохраняем переносы строк
  cleaned = cleaned.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');

  return cleaned;
}

/**
 * Удаляет эмодзи и декоративные символы из текста
 * @param {string} text - Текст с эмодзи
 * @returns {string} Текст без эмодзи
 */
export function removeEmojis(text) {
  if (typeof text !== 'string') {
    return text;
  }

  // Удаляем эмодзи (Unicode диапазоны для эмодзи)
  let cleaned = text
    // Удаляем эмодзи из основных диапазонов
    .replace(/[\u{1F600}-\u{1F64F}]/gu, '') // Emoticons
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, '') // Misc Symbols and Pictographs
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, '') // Transport and Map
    .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '') // Flags
    .replace(/[\u{2600}-\u{26FF}]/gu, '') // Misc symbols
    .replace(/[\u{2700}-\u{27BF}]/gu, '') // Dingbats
    .replace(/[\u{1F900}-\u{1F9FF}]/gu, '') // Supplemental Symbols and Pictographs
    .replace(/[\u{1FA00}-\u{1FA6F}]/gu, '') // Chess Symbols
    .replace(/[\u{1FA70}-\u{1FAFF}]/gu, '') // Symbols and Pictographs Extended-A
    // Удаляем цифры в кружочках (1️⃣, 2️⃣ и т.д.)
    .replace(/[\u{20E3}]/gu, '') // Combining Enclosing Keycap
    .replace(/[\u{FE0F}]/gu, '') // Variation Selector-16
    .replace(/[\u{200D}]/gu, '') // Zero Width Joiner
    // Удаляем другие декоративные символы
    .replace(
      /[➡️▶️⭐🌟✨🎉🎊🎈🎁🎀🎂🎃🎄🎅🎆🎇🎈🎉🎊🎋🎌🎍🎎🎏🎐🎑🎒🎓🎖️🎗️🎙️🎚️🎛️🎜🎝🎞️🎟️🎠🎡🎢🎣🎤🎥🎦🎧🎨🎩🎪🎫🎬🎭🎮🎯🎰🎱🎲🎳🎴🎵🎶🎷🎸🎹🎺🎻🎼🎽🎾🎿🏀🏁🏂🏃🏄🏅🏆🏇🏈🏉🏊🏋️🏌️🏍️🏎️🏏🏐🏑🏒🏓🏔️🏕️🏖️🏗️🏘️🏙️🏚️🏛️🏜️🏝️🏞️🏟️🏠🏡🏢🏣🏤🏥🏦🏧🏨🏩🏪🏫🏬🏭🏮🏯🏰🏱🏲🏳️🏴🏵️🏶🏷️🏸🏹🏺🏻🏼🏽🏾🏿]/gu,
      ''
    );

  // Убираем пробелы только в начале и конце всего текста, но сохраняем переносы строк
  cleaned = cleaned.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');

  return cleaned;
}

/**
 * Улучшает форматирование текста: нормализует переносы строк и структурирует текст
 * @param {string} text - Текст для форматирования
 * @returns {string} Отформатированный текст
 */
export function improveTextFormatting(text) {
  if (typeof text !== 'string') {
    return text;
  }

  let formatted = text;

  // Нормализуем дефисы (часто LLM/рендерер "съедает" нестандартные дефисы или пробелы)
  formatted = formatted
    .replace(/[\u2010\u2011\u2012\u2013\u2014]/g, '-') // hyphen / non-breaking hyphen / figure dash / en/em dash
    .replace(/ии\s*-\s*ассистент/giu, 'ИИ-ассистент')
    .replace(/ии\s+ассистент/giu, 'ИИ-ассистент')
    .replace(/ииассистент/giu, 'ИИ-ассистент');

  formatted = fixCommonAwkwardRussianPhrasing(formatted);

  // Нормализуем переносы строк (убираем \r, оставляем только \n)
  formatted = formatted.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // КРИТИЧЕСКИ ВАЖНО: Добавляем переносы строк перед ключевыми полями внутри описания событий
  // Паттерн: "Дата и время:", "Место проведения:", "Описание:", "Цена:" и т.д.
  // Эти поля должны начинаться с новой строки для лучшей читаемости
  formatted = formatted.replace(
    /(\S)\s+(Дата и время:|Дата:|Время:|Место проведения:|Место:|Описание:|Цена:|Возрастное ограничение:|Возраст:)/g,
    '$1\n$2'
  );

  // КРИТИЧЕСКИ ВАЖНО: Исправляем случаи, когда события написаны в одной строке
  // Паттерн: "1. Название события" или "1. Название" или "1) Название" и т.д.
  // Находим нумерацию событий в одной строке и добавляем переносы строк между ними
  // Ищем паттерны типа: "1. Событие 1 2. Событие 2" или "1. Событие 1\n2. Событие 2" (без пустой строки)
  // Регулярное выражение ищет: начало строки или перенос + число + точка/скобка + пробел + текст + пробел + число + точка/скобка
  // Но не трогаем, если между ними уже есть перенос строки с пустой строкой (\n\n)
  // Более точное регулярное выражение: ищем нумерацию, которая начинается с начала строки или после переноса

  // КРИТИЧЕСКИ ВАЖНО: Сначала обрабатываем случаи, когда перед первым событием идет текст без переноса
  // Паттерн: "интересны: 1. Папа" или "варианты: 1. Событие" или "найдено: 1. Событие"
  // Это должно быть ПЕРВЫМ, чтобы обработать начало списка событий
  // Ищем паттерн: текст с двоеточием, за которым следует номер события (1., 2., 3. и т.д.)
  formatted = formatted.replace(
    /([а-яёa-z][^\n:]*?)(:\s*)(\d+[.)]\s+[а-яёa-z"«])/gi,
    (match, p1, p2, p4) => {
      // Если перед номером события идет текст с двоеточием без переноса строки, добавляем перенос
      // Проверяем, что после номера идет текст (название события), а не время (например, "19:00")
      // Это гарантирует, что мы не сломаем паттерны типа "время: 19:00"
      if (!p1.includes('\n') && !match.includes('\n\n')) {
        // Проверяем, что это действительно начало списка (номер начинается с 1-10 и после него идет текст)
        const numberMatch = p4.match(/^(\d+)/);
        if (numberMatch && parseInt(numberMatch[1]) >= 1 && parseInt(numberMatch[1]) <= 10) {
          return p1 + p2 + '\n\n' + p4;
        }
      }
      return match;
    }
  );

  // КРИТИЧЕСКИ ВАЖНО: Обрабатываем случаи, когда после "рублей" или "₽" сразу идет следующий номер
  // Паттерн: "...рублей 2. Событие" или "...₽ 2. Событие" или "...рублей 2. "Событие""
  // УЛУЧШЕНО: более надежное регулярное выражение, которое захватывает все варианты
  // Обрабатываем случаи, когда между "рублей" и номером может быть любой текст (кроме переноса строки)
  // Используем более агрессивный паттерн, который ищет "рублей" за которым следует номер события
  formatted = formatted.replace(/(рублей?|₽|руб\.)([^\n]*?)(\d+[.)]\s*)/g, (match, p1, p2, p4) => {
    // Если между ценой и следующим номером нет переноса строки (или только пробелы/знаки препинания),
    // добавляем двойной перенос
    const betweenText = p2.trim();
    // Если между "рублей" и номером только пробелы, знаки препинания или короткий текст без переноса строки
    if (!p2.includes('\n') && !match.includes('\n\n') && betweenText.length < 50) {
      return p1 + '\n\n' + p4;
    }
    return match;
  });

  // Сначала обрабатываем случаи, когда события идут в одной строке без переноса
  // Ищем паттерн: "число. текст число. текст" где между ними только пробелы
  // УЛУЧШЕНО: более жадное совпадение для захвата всего текста события, включая многострочные описания
  formatted = formatted.replace(/(\d+[.)]\s+[^\n\d]+?)(\s+)(\d+[.)]\s+)/g, (match, p1, p2, p4) => {
    // Если между событиями только пробелы (без переноса строки), добавляем двойной перенос
    if (!p2.includes('\n')) {
      return p1 + '\n\n' + p4;
    }
    return match;
  });

  // Затем обрабатываем случаи, когда события идут с одним переносом строки, но без пустой строки
  // Ищем паттерн: "число. текст\nчисло. текст" где между ними только один перенос
  formatted = formatted.replace(
    /(\d+[.)]\s+[^\n]+?)(\n)(?!\n)(\d+[.)]\s+)/g,
    (match, p1, p2, p4) => {
      // Если между событиями только один перенос строки (без пустой строки), добавляем еще один
      return p1 + '\n\n' + p4;
    }
  );

  // ДОПОЛНИТЕЛЬНАЯ ОБРАБОТКА: Исправляем случаи, когда события идут подряд без пробелов между номером и текстом следующего события
  // Паттерн: "1. Событие 1. Событие 2" или "1. Событие1. Событие 2"
  // Это может происходить, когда LLM генерирует текст без переносов строк
  formatted = formatted.replace(/(\d+[.)]\s+[^\n\d]+?)(\s*)(\d+[.)]\s+)/g, (match, p1, p2, p4) => {
    // Если между событиями нет переноса строки или только пробелы, добавляем двойной перенос
    if (!p2.includes('\n')) {
      return p1 + '\n\n' + p4;
    }
    return match;
  });

  // ДОПОЛНИТЕЛЬНАЯ ОБРАБОТКА: Исправляем случаи, когда после описания события сразу идет следующий номер без переноса
  // Паттерн: "1. Событие Дата и время: 11 декабря 2025 г. 20:00 Место проведения: G-Drive Арена 2. Событие"
  // Ищем паттерн: "Дата и время:" или "Место проведения:" или "Цена:" за которыми следует номер следующего события
  // УЛУЧШЕНО: более точное регулярное выражение, которое захватывает весь текст до следующего номера, включая "рублей"
  formatted = formatted.replace(
    /((?:Дата и время|Место проведения|Цена|цена|Место|место|Дата|дата)[^\n]*(?:рублей?|₽|руб\.)?[^\n]*?)(\s+)(\d+[.)]\s+)/g,
    (match, p1, p2, p4) => {
      // Если между описанием и следующим номером нет переноса строки, добавляем двойной перенос
      if (!p2.includes('\n')) {
        return p1 + '\n\n' + p4;
      }
      return match;
    }
  );

  // Убираем множественные пустые строки (более 2 подряд)
  formatted = formatted.replace(/\n{3,}/g, '\n\n');

  // Убираем пробелы в конце строк
  formatted = formatted.replace(/[ \t]+$/gm, '');

  // Убираем пробелы в начале строк (но сохраняем переносы строк)
  formatted = formatted.replace(/\n[ \t]+/g, '\n');

  // Убираем только множественные пробелы внутри строк (3 и более подряд), но сохраняем двойные пробелы для форматирования
  formatted = formatted.replace(/[ \t]{3,}/g, '  ');

  // Убираем пробелы только в начале и конце всего текста, но сохраняем переносы строк
  // Используем более мягкий trim, который не удаляет переносы строк в конце
  formatted = formatted.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');

  // Нормализуем обращение к пользователю "вы вас вам ваш" с маленькой буквы,
  // НО только если это не начало предложения.
  // Нормализуем обращение к пользователю "вы вас вам ваш" с маленькой буквы,
  // НО только если это не начало предложения.
  formatted = formatted.replace(
    /([^.!?\s]|^)([.!?]\s+|\n\s*|\s+|^)(вы|вас|вам|вами|ваш|ваша|ваше|ваши|вашего|вашему|вашим|вашими|вашем|вашу|вашей|ваших)(?=[^\p{L}\p{N}_]|$)/giu,
    (match, p1, sep, word) => {
      const isStartOfSentence =
        (!p1 && (!sep || /^\s*$/.test(sep))) ||
        /[.!?]/.test(sep) ||
        /[.!?]/.test(sep) ||
        /\n/.test(sep);

      if (isStartOfSentence) {
        const capitalized = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        return `${p1 || ''}${sep}${capitalized}`;
      }

      return `${p1 || ''}${sep}${word.toLowerCase()}`;
    }
  );

  return formatted;
}

function cleanResidualJsonArtifacts(text) {
  if (typeof text !== 'string') {
    return '';
  }

  let cleaned = decodeHtmlEntities(text).trim();

  const textMatch = cleaned.match(/"text"\s*:\s*"([\s\S]*?)"(,|\})/);
  if (textMatch && textMatch[1]) {
    cleaned = textMatch[1]
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .trim();
  }

  if (/^\{/.test(cleaned) && !cleaned.includes('"')) {
    cleaned = cleaned.replace(/^\{+|\}+$/g, '').trim();
  }

  cleaned = cleaned.replace(/^"|"$/g, '').trim();

  return cleaned;
}
