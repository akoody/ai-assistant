export function estimateTokens(text) {
  if (!text || typeof text !== 'string') {
    return 0;
  }
  // Консервативная оценка: 1 токен = 2.5 символа для русского/JSON текста
  // Это дает запас, чтобы не превысить лимит 32k
  return Math.ceil(text.length / 2.5);
}

export function estimateMessagesTokens(messages) {
  let totalTokens = 0;

  messages.forEach((msg) => {
    // Каждое сообщение имеет overhead на форматирование (role, JSON структура)
    // Примерно 5-10 токенов на сообщение
    const messageOverhead = 8;
    const contentTokens = estimateTokens(msg.content || '');
    totalTokens += messageOverhead + contentTokens;
  });

  return totalTokens;
}

const DEFAULT_MAX_PROMPT_TOKENS = 24000;
const parsedMaxPromptTokens = Number.parseInt(process.env.PLANNER_MAX_PROMPT_TOKENS || '', 10);
const MAX_PROMPT_TOKENS =
  Number.isFinite(parsedMaxPromptTokens) && parsedMaxPromptTokens > 0
    ? parsedMaxPromptTokens
    : DEFAULT_MAX_PROMPT_TOKENS;
const DEFAULT_MAX_HISTORY_MESSAGES = 12;
const parsedMaxHistoryMessages = Number.parseInt(
  process.env.PLANNER_MAX_HISTORY_MESSAGES || '',
  10
);
const MAX_HISTORY_MESSAGES =
  Number.isFinite(parsedMaxHistoryMessages) && parsedMaxHistoryMessages >= 0
    ? parsedMaxHistoryMessages
    : DEFAULT_MAX_HISTORY_MESSAGES;
const DEFAULT_RECENT_HISTORY_MESSAGES = 6;
const parsedRecentHistoryMessages = Number.parseInt(
  process.env.PLANNER_RECENT_HISTORY_MESSAGES || '',
  10
);
const RECENT_HISTORY_MESSAGES =
  Number.isFinite(parsedRecentHistoryMessages) && parsedRecentHistoryMessages > 0
    ? parsedRecentHistoryMessages
    : DEFAULT_RECENT_HISTORY_MESSAGES;
const DEFAULT_HISTORY_MESSAGE_CHAR_LIMIT = 1200;
const parsedHistoryMessageCharLimit = Number.parseInt(
  process.env.PLANNER_HISTORY_MESSAGE_CHAR_LIMIT || '',
  10
);
const HISTORY_MESSAGE_CHAR_LIMIT =
  Number.isFinite(parsedHistoryMessageCharLimit) && parsedHistoryMessageCharLimit >= 200
    ? parsedHistoryMessageCharLimit
    : DEFAULT_HISTORY_MESSAGE_CHAR_LIMIT;
const DEFAULT_HISTORY_SUMMARY_CHAR_LIMIT = 320;
const parsedHistorySummaryCharLimit = Number.parseInt(
  process.env.PLANNER_HISTORY_SUMMARY_CHAR_LIMIT || '',
  10
);
const HISTORY_SUMMARY_CHAR_LIMIT =
  Number.isFinite(parsedHistorySummaryCharLimit) && parsedHistorySummaryCharLimit >= 120
    ? parsedHistorySummaryCharLimit
    : DEFAULT_HISTORY_SUMMARY_CHAR_LIMIT;

const HIGH_SIGNAL_HISTORY_PATTERNS = [
  /(?<![A-Za-zА-Яа-яЁё0-9_])(москва|питер|санкт[-\s]?петербург|нижн(?:ий|ем)\s+новгород|екатеринбург|казань|новосибирск)(?![A-Za-zА-Яа-яЁё0-9_])/iu,
  /(?<![A-Za-zА-Яа-яЁё0-9_])(сегодня|завтра|послезавтра|выходн|недел|месяц|май|июн|июл|август|сентябр|октябр|ноябр|декабр|январ|феврал|март|апрел)(?![A-Za-zА-Яа-яЁё0-9_])/iu,
  /(?<![A-Za-zА-Яа-яЁё0-9_])(концерт|театр|спектакл|выставк|музе|стендап|шоу|экскурси|детям|квиз|праздник|фестивал)(?![A-Za-zА-Яа-яЁё0-9_])/iu,
  /(?<![A-Za-zА-Яа-яЁё0-9_])(жанр|категор|исполнител|артист|бюджет|цена|дороже|дешевле|до\s+\d+|от\s+\d+)(?:(?<=[A-Za-zА-Яа-яЁё0-9_])(?![A-Za-zА-Яа-яЁё0-9_])|(?<![A-Za-zА-Яа-яЁё0-9_])(?=[A-Za-zА-Яа-яЁё0-9_]))/iu,
  /(?<![A-Za-zА-Яа-яЁё0-9_])(нрав|люблю|не люблю|не хочу|хочу|предпочита|подойдет|подойдёт|любой|любая|покажи все|уточнить)(?![A-Za-zА-Яа-яЁё0-9_])/iu,
];

const SHORT_CLARIFICATION_PATTERNS = [
  /^(да|нет|ага|ок|хорошо|любой|любая|другая|другой|покажи все|показать все|сойдет|сойд[её]т)$/iu,
  /^(сегодня|завтра|послезавтра|на следующей неделе|на выходных)$/iu,
  /^(уточнить\s+(дату|категорию|жанр|город|бюджет))$/iu,
  /^(концерты|театры|выставки|музеи|стендап|шоу)$/iu,
];

function normalizeHistoryContent(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeButtons(buttons = []) {
  if (!Array.isArray(buttons)) {
    return [];
  }

  const seen = new Set();
  const normalized = [];

  for (const button of buttons) {
    const value = normalizeHistoryContent(button);
    if (!value) {
      continue;
    }
    const key = value.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(value);
    if (normalized.length >= 6) {
      break;
    }
  }

  return normalized;
}

export function attachAssistantButtonsToContent(content = '', metadata = {}) {
  const normalizedContent = normalizeHistoryContent(content);
  const buttons = normalizeButtons(metadata?.buttons);

  if (buttons.length === 0) {
    return normalizedContent;
  }

  const buttonsSuffix = ` Кнопки: ${buttons.join(' | ')}`;
  return normalizeHistoryContent(`${normalizedContent}${buttonsSuffix}`);
}

export function truncateHistoryContent(content = '', limit = HISTORY_MESSAGE_CHAR_LIMIT) {
  const normalized = normalizeHistoryContent(content);
  if (!normalized || normalized.length <= limit) {
    return normalized;
  }

  if (limit < 80) {
    return `${normalized.slice(0, Math.max(limit - 15, 1))} ...[truncated]`;
  }

  const ellipsis = ' ...[truncated] ';
  const available = Math.max(limit - ellipsis.length, 1);
  const headLength = Math.max(Math.floor(available * 0.68), 1);
  const tailLength = Math.max(available - headLength, 1);
  const head = normalized.slice(0, headLength).trimEnd();
  const tail = normalized.slice(-tailLength).trimStart();

  return `${head}${ellipsis}${tail}`;
}

function isShortClarificationReply(content = '') {
  const normalized = normalizeHistoryContent(content);
  if (!normalized || normalized.length > 80) {
    return false;
  }

  return SHORT_CLARIFICATION_PATTERNS.some((pattern) => pattern.test(normalized));
}

function hasHighSignalContent(content = '') {
  const normalized = normalizeHistoryContent(content);
  if (!normalized) {
    return false;
  }

  return HIGH_SIGNAL_HISTORY_PATTERNS.some((pattern) => pattern.test(normalized));
}

function buildHistoryEntries(history = []) {
  if (!Array.isArray(history) || history.length === 0) {
    return [];
  }

  const nonSystemHistory = history
    .filter((msg) => msg && msg.role !== 'system')
    .map((msg, sourceIndex, allMessages) => {
      const baseContent =
        msg.role === 'assistant'
          ? attachAssistantButtonsToContent(msg.content, msg.metadata)
          : normalizeHistoryContent(msg.content);

      if (!baseContent) {
        return null;
      }

      const shortClarification = isShortClarificationReply(baseContent);
      const highSignal = hasHighSignalContent(baseContent);
      const hasButtons = normalizeButtons(msg.metadata?.buttons).length > 0;
      const nearTail = sourceIndex >= Math.max(allMessages.length - RECENT_HISTORY_MESSAGES, 0);
      let importance = msg.role === 'user' ? 6 : 3;

      if (shortClarification) {
        importance += 8;
      }
      if (highSignal) {
        importance += 5;
      }
      if (hasButtons) {
        importance += 4;
      }
      if (/[0-9]/.test(baseContent)) {
        importance += 1;
      }
      if (baseContent.length <= 180) {
        importance += 1;
      }
      if (nearTail) {
        importance += 3;
      }

      return {
        role: msg.role,
        content: baseContent,
        sourceIndex,
        importance,
        isRecent: nearTail,
        isImportant: shortClarification || highSignal || hasButtons,
      };
    })
    .filter(Boolean);

  return nonSystemHistory;
}

function selectHistoryEntries(entries = []) {
  if (MAX_HISTORY_MESSAGES <= 0 || entries.length === 0) {
    return [];
  }

  if (entries.length <= MAX_HISTORY_MESSAGES) {
    return entries;
  }

  const recentCount = Math.min(RECENT_HISTORY_MESSAGES, MAX_HISTORY_MESSAGES);
  const recentEntries = entries.slice(-recentCount);
  const selectedIndexes = new Set(recentEntries.map((entry) => entry.sourceIndex));
  const remainingSlots = MAX_HISTORY_MESSAGES - recentEntries.length;

  if (remainingSlots > 0) {
    const prioritizedOlder = entries
      .slice(0, -recentCount)
      .sort((a, b) => b.importance - a.importance || b.sourceIndex - a.sourceIndex);

    for (const entry of prioritizedOlder) {
      if (selectedIndexes.size >= MAX_HISTORY_MESSAGES) {
        break;
      }
      selectedIndexes.add(entry.sourceIndex);
    }
  }

  return entries.filter((entry) => selectedIndexes.has(entry.sourceIndex));
}

function buildHistoryMessages(entries = [], mode = 'default') {
  return entries.map((entry) => {
    let charLimit = HISTORY_SUMMARY_CHAR_LIMIT;

    if (mode === 'default') {
      if (entry.isRecent) {
        charLimit = HISTORY_MESSAGE_CHAR_LIMIT;
      } else if (entry.isImportant) {
        charLimit = Math.min(
          HISTORY_MESSAGE_CHAR_LIMIT,
          Math.max(HISTORY_SUMMARY_CHAR_LIMIT * 2, 520)
        );
      }
    } else if (mode === 'summary') {
      charLimit = entry.isRecent
        ? Math.min(HISTORY_MESSAGE_CHAR_LIMIT, Math.max(HISTORY_SUMMARY_CHAR_LIMIT * 2, 640))
        : HISTORY_SUMMARY_CHAR_LIMIT;
    } else if (mode === 'aggressive') {
      charLimit = entry.isRecent
        ? Math.min(HISTORY_MESSAGE_CHAR_LIMIT, 420)
        : Math.min(HISTORY_SUMMARY_CHAR_LIMIT, 180);
    }

    return {
      role: entry.role,
      content: truncateHistoryContent(entry.content, charLimit),
    };
  });
}

function buildFullHistoryMessages(history = []) {
  return buildHistoryEntries(history).map((entry) => ({
    role: entry.role,
    content: entry.content,
  }));
}

function fitHistoryIntoBudget(systemPrompt, historyEntries, userMessage, maxTokens) {
  const baseMessages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];
  const tryBuild = (entries, mode) => {
    const historyMessages = buildHistoryMessages(entries, mode);
    const messages = [baseMessages[0], ...historyMessages, baseMessages[1]];
    return {
      historyMessages,
      messages,
      totalTokens: estimateMessagesTokens(messages),
    };
  };

  let selectedEntries = [...historyEntries];

  for (const mode of ['default', 'summary', 'aggressive']) {
    const attempt = tryBuild(selectedEntries, mode);
    if (attempt.totalTokens <= maxTokens) {
      return attempt;
    }
  }

  const minimumRecentEntries = Math.min(
    selectedEntries.length,
    Math.max(2, Math.min(RECENT_HISTORY_MESSAGES, 4))
  );

  while (selectedEntries.length > minimumRecentEntries) {
    const dropIndex = selectedEntries.findIndex((entry) => !entry.isRecent);
    if (dropIndex === -1) {
      break;
    }
    selectedEntries.splice(dropIndex, 1);

    for (const mode of ['summary', 'aggressive']) {
      const attempt = tryBuild(selectedEntries, mode);
      if (attempt.totalTokens <= maxTokens) {
        return attempt;
      }
    }
  }

  while (selectedEntries.length > 0) {
    const attempt = tryBuild(selectedEntries, 'aggressive');
    if (attempt.totalTokens <= maxTokens) {
      return attempt;
    }
    selectedEntries.shift();
  }

  return tryBuild([], 'aggressive');
}

export function trimHistoryMessages(history = []) {
  const entries = buildHistoryEntries(history);
  const selectedEntries = selectHistoryEntries(entries);
  return buildHistoryMessages(selectedEntries, 'default');
}

function buildSelectedHistoryMessages(history = [], mode = 'default') {
  const entries = buildHistoryEntries(history);
  const selectedEntries = selectHistoryEntries(entries);
  return buildHistoryMessages(selectedEntries, mode);
}

export function compressHistoryIfNeeded(
  systemPrompt,
  history,
  userMessage,
  maxTokens = MAX_PROMPT_TOKENS
) {
  const baseMessages = [
    {
      role: 'system',
      content: systemPrompt,
    },
    {
      role: 'user',
      content: userMessage,
    },
  ];

  const fullHistoryMessages = buildFullHistoryMessages(history);
  const messagesWithFullHistory = [baseMessages[0], ...fullHistoryMessages, baseMessages[1]];
  const totalTokensWithFullHistory = estimateMessagesTokens(messagesWithFullHistory);

  if (totalTokensWithFullHistory <= maxTokens) {
    console.log(
      `🔢 Подсчет токенов: ${totalTokensWithFullHistory.toLocaleString()} / ${maxTokens.toLocaleString()}`
    );
    return messagesWithFullHistory;
  }

  const defaultHistoryMessages = buildSelectedHistoryMessages(history, 'default');
  const messagesWithDefaultHistory = [baseMessages[0], ...defaultHistoryMessages, baseMessages[1]];

  // Подсчитываем токены
  const totalTokens = estimateMessagesTokens(messagesWithDefaultHistory);

  console.log(
    `🔢 Подсчет токенов: ${totalTokens.toLocaleString()} / ${maxTokens.toLocaleString()}`
  );

  // Если токенов меньше лимита, возвращаем как есть
  if (totalTokens <= maxTokens) {
    return messagesWithDefaultHistory;
  }

  // Нужно дополнительно сжимать историю
  console.log(`⚠️ Превышен лимит токенов! Дополнительно сжимаю историю...`);

  const historyEntries = selectHistoryEntries(buildHistoryEntries(history));
  const {
    historyMessages,
    messages: finalMessages,
    totalTokens: finalTokens,
  } = fitHistoryIntoBudget(systemPrompt, historyEntries, userMessage, maxTokens);
  const removedCount = Math.max(history.length - historyMessages.length, 0);

  console.log(
    `✅ История сжата: ${removedCount} сообщений удалено, ${historyMessages.length} оставлено, ` +
      `${finalTokens.toLocaleString()} токенов осталось`
  );

  return finalMessages;
}

export function buildMessages(systemPrompt, history, userMessage, userId = '', sessionId = '') {
  // Сжимаем историю, если нужно
  const messages = compressHistoryIfNeeded(systemPrompt, history, userMessage, MAX_PROMPT_TOKENS);

  const totalTokens = estimateMessagesTokens(messages);
  console.log(
    `📊 [${userId}][${sessionId}] Финальный размер запроса: ${totalTokens.toLocaleString()} токенов ` +
      `(лимит: ${MAX_PROMPT_TOKENS.toLocaleString()}, история<=${MAX_HISTORY_MESSAGES}, ` +
      `recent<=${RECENT_HISTORY_MESSAGES}, символов/сообщение<=${HISTORY_MESSAGE_CHAR_LIMIT}, ` +
      `summary<=${HISTORY_SUMMARY_CHAR_LIMIT})`
  );

  return messages;
}
