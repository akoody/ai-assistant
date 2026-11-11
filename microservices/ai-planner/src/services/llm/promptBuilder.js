import {
  getGeneralDialogPrompt,
  getMissingDataPrompt,
  getOfferDeliveryPrompt,
  getNoResultsPrompt,
  getEventDetailsPrompt,
  getHealthComplaintPrompt,
} from '../configService.js';
import { getRequiredSlots } from '../slotsRequirementsService.js';
import { formatEventDetailsForPrompt } from '../eventInfoService.js';
import {
  hasSeniorFriendlyContext,
  isRussianCity,
  resolveMoodSearchSignal,
} from '../offerService.js';
import { getUserPreferences, formatPreferencesDescription } from '../userPreferencesService.js';
import { hasStoredPreferenceMemory, hasTastePreferenceMemory } from '../preferenceMemoryService.js';
import {
  hasExplicitPreferenceSignal,
  hasNegativePreferenceCue,
  splitPreferenceChangeText,
} from '../../../../../shared/preferenceRules.js';

const COMPACT_PROMPT_TEMPLATES_ENABLED = process.env.PLANNER_COMPACT_PROMPT_TEMPLATES !== '0';

function hashToIndex(value, modulo) {
  if (!modulo || modulo <= 0) return 0;
  const text = String(value ?? '');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash % modulo;
}

function pickOne(list, seed) {
  const items = Array.isArray(list) ? list.filter(Boolean) : [];
  if (items.length === 0) return null;
  const deterministic = process.env.DETERMINISTIC_CLARIFICATION === '1';
  if (deterministic) return items[hashToIndex(seed, items.length)] || items[0];
  const index = Math.floor(Math.random() * items.length);
  return items[index] || items[0];
}

function getSlotValue(slots, names) {
  const slot = slots.find((item) => item && names.includes(item.name) && item.value);
  return slot ? String(slot.value).trim() : null;
}

function hasRomanticClarificationContext(slots = [], userMessage = '') {
  const contextValue = getSlotValue(slots, ['контекст_события']) || '';
  const moodValue = getSlotValue(slots, ['настроение']) || '';
  const combined = `${contextValue} ${moodValue} ${String(userMessage || '')}`
    .toLowerCase()
    .replace(/ё/g, 'е');

  return /(романт|свидани|для\s*двоих|вдвоем|вдвоем|вдво|влюблен|любов)/u.test(combined);
}

function hasSoftMoodClarificationContext(slots = [], userMessage = '') {
  const moodValue = getSlotValue(slots, ['настроение']) || '';
  const combined = `${moodValue} ${String(userMessage || '')}`.toLowerCase().replace(/ё/g, 'е');

  return /(груст|тоск|хандр|печал|погруст|скучно|одиноко|хочу\s+развеяться|поднять\s+настроение|хочу\s+отвлечься|нет\s+настроения)/u.test(
    combined
  );
}

function normalizePreferenceToken(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .trim();
}

function normalizePromptText(text = '') {
  return String(text || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripPromptSection(prompt = '', startMarker = '', endMarkers = []) {
  if (!startMarker) {
    return prompt;
  }

  const source = String(prompt || '');
  const startIndex = source.indexOf(startMarker);
  if (startIndex === -1) {
    return source;
  }

  const validEndIndexes = endMarkers
    .map((marker) => source.indexOf(marker, startIndex + startMarker.length))
    .filter((index) => index !== -1);

  if (validEndIndexes.length === 0) {
    return source;
  }

  const endIndex = Math.min(...validEndIndexes);
  return `${source.slice(0, startIndex)}${source.slice(endIndex)}`;
}

function stripPromptTail(prompt = '', marker = '') {
  if (!marker) {
    return prompt;
  }

  const source = String(prompt || '');
  const index = source.indexOf(marker);
  if (index === -1) {
    return source;
  }

  return source.slice(0, index);
}

function compactPromptTemplate(prompt = '') {
  if (!COMPACT_PROMPT_TEMPLATES_ENABLED) {
    return String(prompt || '');
  }

  let compact = String(prompt || '');

  compact = stripPromptSection(compact, 'ЯЗЫКОВОЙ ЧЕК-ЛИСТ ПЕРЕД ОТПРАВКОЙ ОТВЕТА:', [
    'Ты - виртуальный помощник Кассир.ру',
    'Базовые принципы поведения',
    'Правила поведения:',
    'КРИТИЧЕСКИ ВАЖНО - ГЛАВНОЕ ПРАВИЛО!',
  ]);

  compact = stripPromptTail(compact, 'ФОРМАТ ОТВЕТА:');
  compact = stripPromptTail(compact, 'ПРАВИЛЬНЫЙ ФОРМАТ ОТВЕТА:');
  compact = stripPromptTail(compact, 'НЕПРАВИЛЬНЫЙ ФОРМАТ');
  compact = stripPromptTail(compact, '❗ ФИНАЛЬНАЯ ПРОВЕРКА ПЕРЕД ОТПРАВКОЙ ОТВЕТА');
  compact = stripPromptTail(compact, 'КРИТИЧЕСКИ ВАЖНО - ЧТО ЗАПРЕЩЕНО ДОБАВЛЯТЬ В ОТВЕТ:');

  return normalizePromptText(compact);
}

function getPromptTemplate(factory) {
  return compactPromptTemplate(factory?.() || '');
}

function formatPreferenceMemoryBrief(userPreferences = null) {
  if (!userPreferences) {
    return null;
  }

  const description = normalizePromptText(formatPreferencesDescription(userPreferences) || '');
  if (!description) {
    return null;
  }

  return description
    .split('\n')
    .map((line) => line.replace(/^[-•]\s*/u, '').trim())
    .filter(Boolean)
    .slice(0, 6)
    .join(' | ');
}

function buildCompactSlotsInfo({
  slots = [],
  normalizedCity = null,
  hasValidCity = false,
  hasStoredPreferences = false,
  hasTastePreferences = false,
  allowPreferenceMemoryHint = false,
  userPreferences = null,
  seniorContextForPrompt = false,
}) {
  const normalizedSlots = Array.isArray(slots)
    ? slots
        .filter(
          (slot) =>
            slot &&
            slot.name &&
            slot.value !== undefined &&
            slot.value !== null &&
            String(slot.value).trim()
        )
        .map((slot) => `${slot.name}=${String(slot.value).trim()}`)
    : [];

  const lines = ['\n\nКОНТЕКСТ ПОЛЬЗОВАТЕЛЯ:'];

  if (normalizedSlots.length > 0) {
    lines.push(`слоты: ${normalizedSlots.join(' | ')}`);
  } else {
    lines.push('слоты: нет подтверждённых данных');
  }

  if (hasValidCity && normalizedCity) {
    lines.push(`город_зафиксирован: "${normalizedCity}"`);
    lines.push('правило: город повторно не спрашивать');
  }

  if (hasStoredPreferences && allowPreferenceMemoryHint) {
    const memoryBrief = formatPreferenceMemoryBrief(userPreferences);
    lines.push(
      `память: использовать сохранённые предпочтения${memoryBrief ? ` -> ${memoryBrief}` : ''}`
    );
  } else if (hasStoredPreferences) {
    lines.push(
      `память: есть ${hasTastePreferences ? 'вкусовые' : 'сохранённые'} предпочтения, но без прямой просьбы их не упоминать и не подмешивать`
    );
  } else {
    lines.push('память: сохранённых предпочтений нет');
  }

  if (seniorContextForPrompt) {
    lines.push('senior_friendly: да');
    lines.push('ограничения: без рэпа/хип-хопа/металла/стендапа/клубных событий и без 16+/18+');
    lines.push('приоритет: классика, театр, опера, балет, выставки, музеи, экскурсии, джаз');
  }

  return `${lines.join('\n')}\n`;
}

const FRESH_PREFERENCE_ACK_SLOT_NAMES = new Set([
  'жанр',
  'жанр_музыки',
  'предпочтения_жанры',
  'исполнитель',
  'артист',
  'тип_мероприятия',
  'тип_события',
  'предпочтения_типы_событий',
]);

const FRESH_PREFERENCE_EVENT_TYPE_SLOT_NAMES = new Set([
  'тип_мероприятия',
  'тип_события',
  'предпочтения_типы_событий',
]);

function formatPreferenceValueForPrompt(value = '') {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildFreshPreferenceAckInstruction({ slots = [], userMessage = '' } = {}) {
  const normalizedMessage = normalizePreferenceToken(userMessage);
  if (!normalizedMessage || !hasExplicitPreferenceSignal(normalizedMessage)) {
    return '';
  }

  const { positivePart } = splitPreferenceChangeText(userMessage);
  if (
    !positivePart ||
    !hasExplicitPreferenceSignal(positivePart) ||
    hasNegativePreferenceCue(positivePart)
  ) {
    return '';
  }

  const preferenceSlots = (Array.isArray(slots) ? slots : []).filter(
    (slot) =>
      slot &&
      FRESH_PREFERENCE_ACK_SLOT_NAMES.has(String(slot.name || '').trim()) &&
      slot.isNegative !== true &&
      formatPreferenceValueForPrompt(slot.value)
  );

  const concreteTasteSlot = preferenceSlots.find(
    (slot) => !FRESH_PREFERENCE_EVENT_TYPE_SLOT_NAMES.has(String(slot.name || '').trim())
  );
  const fallbackSlot = concreteTasteSlot || preferenceSlots[0] || null;
  if (!fallbackSlot) {
    return '';
  }

  const value = formatPreferenceValueForPrompt(fallbackSlot.value);
  if (!value) {
    return '';
  }

  const slotName = String(fallbackSlot.name || '').trim();
  const ackExample = FRESH_PREFERENCE_EVENT_TYPE_SLOT_NAMES.has(slotName)
    ? `Запомнил, что вам нравятся ${value}.`
    : `Запомнил, что вам нравится ${value}.`;

  return (
    `\nсвежее_предпочтение: пользователь сейчас явно сообщил позитивное предпочтение "${value}". ` +
    `Система уже сохраняет это в память. В поле text начни с короткого естественного подтверждения от первого лица в мужском роде, например: "${ackExample}" ` +
    `После этого сразу продолжай текущий сценарий: покажи найденные события или задай нужное уточнение. ` +
    `Не повторяй подтверждение дважды и не подтверждай негативные предпочтения как понравившиеся.\n`
  );
}

function buildClarificationAcknowledgement(slots) {
  const city = getSlotValue(slots, ['город']);
  const date = getSlotValue(slots, [
    'дата_события',
    'дата',
    'концерт_дата',
    'спектакль_дата',
    'выставка_дата',
  ]);
  const eventType = getSlotValue(slots, [
    'тип_мероприятия',
    'тип_события',
    'предпочтения_типы_событий',
    'категория',
    'category',
    'event_type',
  ]);
  const artist = getSlotValue(slots, ['артист', 'исполнитель']);
  const parts = [];

  if (eventType) {
    parts.push(`тип мероприятия: "${eventType}"`);
  }
  if (artist) {
    parts.push(`исполнитель: "${artist}"`);
  }
  if (city) {
    parts.push(`город: "${city}"`);
  }
  if (date) {
    parts.push(`дата или период: "${date}"`);
  }

  if (parts.length === 0) {
    return '';
  }

  return (
    `\n\nПОДТВЕРЖДЕННЫЕ ПАРАМЕТРЫ ЗАПРОСА: ${parts.join(', ')}.\n` +
    `КРИТИЧЕСКИ ВАЖНО: Перед уточняющим вопросом ОБЯЗАТЕЛЬНО дружелюбно и естественно подтверди, что ты уже понял эти параметры.\n` +
    `Если известны город и дата/период, первая фраза ответа ОБЯЗАТЕЛЬНО должна явно содержать и город, и дату/период.\n` +
    (date
      ? `КРИТИЧЕСКИ ВАЖНО ПО ДАТЕ: используй дату/период РОВНО в пользовательском смысле: "${date}". ` +
        `ЗАПРЕЩЕНО сужать период до конкретных чисел, добавлять диапазон дней или менять месяц, если таких чисел не было в запросе.\n`
      : '') +
    `Подтверждение должно звучать тепло и по-человечески, а не сухо или телеграфно.\n` +
    `НЕ начинай с рубленых конструкций вроде "Понял:" или "Принял:".\n` +
    `Сохраняй тот же смысл: коротко подтверди известные параметры и затем задай один естественный уточняющий вопрос.\n` +
    `ВАРЬИРУЙ формулировки: меняй глаголы, порядок слов и сам вопрос; не используй один и тот же заход как постоянный шаблон.\n` +
    `Не злоупотребляй связками вроде "Чтобы сузить варианты" и не копируй одну и ту же реплику из ответа в ответ.\n` +
    `НЕ переспрашивай уже известные параметры и НЕ пропускай это подтверждение.\n`
  );
}

function buildMoodClarificationAcknowledgement(slots = [], userMessage = '') {
  if (!hasSoftMoodClarificationContext(slots, userMessage)) {
    return '';
  }

  return `\n\nЭМОЦИОНАЛЬНЫЙ КОНТЕКСТ:
Пользователь пришёл с мягким эмоциональным запросом и хочет подобрать событие под настроение.
Перед уточняющим вопросом ОБЯЗАТЕЛЬНО добавь одну короткую человеческую фразу с эмпатией и мягким переходом к подбору.
Например по смыслу: "Понимаю, давайте подберем что-то под это настроение" или "Давайте найдем что-то, что поможет немного переключиться".
ВАЖНО:
- не уходи в психотерапию и не давай советов о жизни;
- не драматизируй и не используй тяжелые формулировки;
- не пропускай эту мягкую подводку и не начинай сразу с сухого вопроса вроде "Какой бюджет?";\n`;
}

function getGenreClarificationButtonsForEventType(
  eventType = '',
  userPreferences = null,
  slots = []
) {
  const normalizedEventType = String(eventType || '')
    .toLowerCase()
    .replace(/ё/g, 'е');
  const seniorFriendlyContext = hasSeniorFriendlyContext(slots);
  const moodSignal = !normalizedEventType ? resolveMoodSearchSignal({ slots }) : null;
  const dislikedGenres = new Set(
    Array.isArray(userPreferences?.dislikedGenres)
      ? userPreferences.dislikedGenres.map(normalizePreferenceToken).filter(Boolean)
      : []
  );
  const genericButtons = new Set(['любой', 'покажи все']);
  let sourceButtons;

  if (!normalizedEventType && moodSignal?.profile?.key === 'fun') {
    sourceButtons = ['Стендап', 'Комедия', 'Шоу', 'Юмористический концерт', 'Любой', 'Покажи все'];
  } else if (normalizedEventType.includes('дет')) {
    sourceButtons = [
      'Малышам (2-6)',
      'Для младшего и среднего возраста (7-12)',
      'Для старшего возраста (от 12 лет)',
      'Детские спектакли',
      'Детские концерты',
      'Детские мюзиклы',
      'Цирк / Клоунада',
      'Детские шоу',
      'Другое',
      'Покажи все',
    ];
  } else if (normalizedEventType.includes('фестив')) {
    sourceButtons = ['Музыкальные фестивали', 'Опен-эйр', 'Покажи все'];
  } else if (normalizedEventType.includes('театр') || normalizedEventType.includes('спектак')) {
    sourceButtons = [
      'Драма',
      'Комедия',
      'Опера',
      'Балет / Танец',
      'Мюзикл',
      'Кукольный театр',
      'Спектакли',
      'Гастроли',
      'Мелодрама',
      'Сказка',
      'Трагикомедия',
      'Иммерсивный спектакль',
      'Танец',
      'Цирк / Клоунада',
      'Моноспектакли',
      'Любой',
      'Покажи все',
    ];
  } else if (normalizedEventType.includes('шоу')) {
    sourceButtons = [
      'Цирк / Клоунада',
      'Спортивное шоу',
      'Юмор',
      'Танец',
      'Другое',
      'Стендап',
      'Цирк',
      'Любой',
      'Покажи все',
    ];
  } else if (normalizedEventType.includes('экскурс')) {
    sourceButtons = [
      'Пешеходные',
      'Автобусные',
      'Необычные',
      'Обзорные',
      'Детям',
      'Театрализованная экскурсия',
      'Экскурсия в особняк',
      'Любой',
      'Покажи все',
    ];
  } else if (
    normalizedEventType.includes('образован') ||
    normalizedEventType.includes('курс') ||
    normalizedEventType.includes('обучен')
  ) {
    sourceButtons = [
      'Дополнительное образование',
      'Вебинары',
      'Лекции',
      'Конференции',
      'Мастер-классы',
      'Любой',
      'Покажи все',
    ];
  } else if (normalizedEventType.includes('спорт')) {
    sourceButtons = [
      'Футбол',
      'Единоборства',
      'Другое',
      'Баскетбол',
      'Автоспорт',
      'Любой',
      'Покажи все',
    ];
  } else if (
    normalizedEventType.includes('стендап') ||
    normalizedEventType.includes('standup') ||
    normalizedEventType.includes('stand up')
  ) {
    sourceButtons = ['Сольный', 'Женский', 'Любой', 'Покажи все'];
  } else if (normalizedEventType.includes('музе')) {
    sourceButtons = [
      'Детские',
      'Заповедники',
      'Мемориальные',
      'Квартиры исторические',
      'Археологические',
      'Естественнонаучные',
      'Краеведческие',
      'Литературные',
      'Отраслевые',
      'Художественные',
      'Выставки',
      'Архитектурные',
      'Исторические',
      'Комплексные',
      'Технические',
      'Искусствоведческие',
      'Фотографии',
      'Любой',
      'Покажи все',
    ];
  } else if (normalizedEventType.includes('турист')) {
    sourceButtons = ['Экскурсии', 'Выставки', 'Активный отдых', 'Любой', 'Покажи все'];
  } else if (seniorFriendlyContext) {
    sourceButtons = [
      'Классика',
      'Джаз',
      'Творческий вечер',
      'Инструментальная музыка',
      'Любой',
      'Покажи все',
    ];
  } else {
    sourceButtons = ['Рок', 'Поп', 'Джаз', 'Классика', 'Клубы', 'Хип-хоп', 'Любой', 'Покажи все'];
  }
  const filteredButtons = sourceButtons.filter((button) => {
    const normalizedButton = normalizePreferenceToken(button);
    if (!normalizedButton || genericButtons.has(normalizedButton)) {
      return true;
    }

    return !dislikedGenres.has(normalizedButton);
  });

  const finalButtons = filteredButtons.length > 0 ? filteredButtons : sourceButtons;

  const specific = [];
  const generic = [];
  for (const btn of finalButtons) {
    const normalized = normalizePreferenceToken(btn);
    if (genericButtons.has(normalized) || normalized === 'другое') {
      generic.push(btn);
    } else {
      specific.push(btn);
    }
  }

  if (specific.length <= 5) {
    return [...specific, ...generic];
  }

  const shuffled = [...specific];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  return [...shuffled.slice(0, 5), ...generic];
}

export async function buildSystemPrompt({
  slots,
  requestType,
  offerEvents,
  userId,
  sessionId,
  noResultsDetected,
  userIntent = {},
  userMessage = '',
  eventDetailsContext = null,
  isFirstMessage = false,
  isNonRussianCity = false,
  nonRussianCityName = null,
  hasSelectedOtherCity = false,
  vagueRequestInfo = null,
  allowPreferenceMemoryHint = false,
  userPreferences: providedUserPreferences = null,
}) {
  const citySlot = slots.find((slot) => slot && slot.name === 'город');
  const normalizedCity =
    citySlot && citySlot.value && String(citySlot.value).trim().length > 0
      ? String(citySlot.value).trim()
      : null;
  const hasValidCity = Boolean(normalizedCity && isRussianCity(normalizedCity));

  const LANGUAGE_GUARD =
    `\n\nЯЗЫКОВОЙ КОНТРОЛЬ:\n` +
    `- Пиши только по-русски.\n` +
    `- A-Z допустимы только внутри точных названий из входных данных и "Kassir.ru".\n` +
    `- Перед отправкой проверь и "text", и каждую кнопку.\n\n`;

  const OFFTOPIC_RULES =
    `\n\nГРАНИЦЫ:\n` +
    `- Помогай только с мероприятиями, афишей, билетами и уточнением параметров поиска.\n` +
    `- О себе говори в мужском роде.\n` +
    `- На оффтоп не отвечай по сути: коротко обозначь границу и верни к подбору.\n` +
    `- Не обсуждай внутренние технологии, модель и устройство.\n` +
    (hasValidCity
      ? `- Если город уже известен, возвращай к подбору в городе ${normalizedCity}.\n\n`
      : `- Если города нет, мягко попроси выбрать город или категорию.\n\n`);

  function getResponseFormatRules({ responseMode = 'short' } = {}) {
    const textRule =
      responseMode === 'detailed'
        ? '- "text": русский ответ на "вы". Если сценарий требует деталей или перечисления событий, не сокращай важную информацию.\n'
        : '- "text": короткий русский ответ на "вы".\n';

    return (
      `\nФОРМАТ ВЫВОДА:\n` +
      `- Ответ строго JSON без текста вне объекта.\n` +
      `- Поля только "text" и "buttons".\n` +
      `${textRule}` +
      `- "buttons": массив коротких русских кнопок, если кнопок нет — [].\n\n`
    );
  }

  const withLanguageGuard = (prompt, options = {}) =>
    `${LANGUAGE_GUARD}${getResponseFormatRules(options)}${normalizePromptText(prompt)}`;
  const withOfftopicRules = (prompt, options = {}) =>
    withLanguageGuard(`${OFFTOPIC_RULES}${prompt}`, options);

  // Получаем сохранённые предпочтения пользователя
  let userPreferences = providedUserPreferences;
  if (!userPreferences) {
    try {
      userPreferences = await getUserPreferences(userId);
    } catch (error) {
      console.warn(`⚠️ [promptBuilder] Не удалось загрузить предпочтения пользователя:`, error);
    }
  }

  // Формируем информацию о слотах и предпочтениях
  let slotsInfo = '';
  const hasTastePreferences = hasTastePreferenceMemory(userPreferences);
  const hasStoredPreferences = hasStoredPreferenceMemory(userPreferences);

  // Добавляем явную инструкцию для LLM при senior-friendly контексте
  const seniorContextForPrompt = hasSeniorFriendlyContext(slots);
  slotsInfo = buildCompactSlotsInfo({
    slots,
    normalizedCity,
    hasValidCity,
    hasStoredPreferences,
    hasTastePreferences,
    allowPreferenceMemoryHint,
    userPreferences,
    seniorContextForPrompt,
  });
  slotsInfo += buildFreshPreferenceAckInstruction({ slots, userMessage });

  // КРИТИЧЕСКИ ВАЖНО: Сначала проверяем жалобу на здоровье/эмоциональное состояние
  // Это должно обрабатываться в первую очередь, до всех остальных сценариев
  if (userIntent.healthComplaint) {
    let prompt = getPromptTemplate(getHealthComplaintPrompt);
    if (!prompt || prompt.trim().length === 0) {
      console.warn('⚠️ healthComplaintPrompt пустой, используем generalDialogPrompt');
      prompt = getPromptTemplate(getGeneralDialogPrompt);
    }
    prompt += `\n\nКРИТИЧЕСКИ ВАЖНО ПО КНОПКАМ:
- Используй только кнопки из списка: ["Найти концерт","Найти театр","Найти выставку","Найти музей","Найти стендап","Найти спортивное событие","Может, позже"].
- Верни 3 релевантные кнопки поиска по существующим категориям Kassir.ru и кнопку "Может, позже".
- Кнопки должны подходить под настроение пользователя. Например, для запроса "хочу поорать" допустимы "Найти концерт", "Найти стендап", "Найти спортивное событие".
- Запрещено придумывать любые другие кнопки, места, сценарии, эмоциональные действия и формулировки, которые не являются реальными категориями поиска.
- Нельзя возвращать кнопки вроде "Найти место для выхода злости", "Позже", "Не сейчас", "Подобрать концерты" и любые другие свободные варианты.

КРИТИЧЕСКИ ВАЖНО — ОБРАЩЕНИЕ НА «ВЫ»:
- ВСЕГДА обращайся к пользователю на «вы»: вам, ваш, ваша, вас, вами.
- НИКОГДА не используй «ты», «тебе», «тебя», «твой», «твоя» — это грубая ошибка.
- Проверь каждое предложение перед ответом: нет ли «тебе», «тебя», «ты».

КРИТИЧЕСКИ ВАЖНО ПО ТОНУ:
- Человек поделился личным состоянием: ответь доброжелательно, уважительно, спокойно, не телеграфно и на «вы».
- В ответе обязательно должны быть три смысла: короткая человеческая реакция; честная граница с прямым упоминанием медицинской или психологической помощи/советов, с которыми ты не можешь помочь как специалист; мягкая помощь в своей части — подобрать мероприятие или посмотреть афишу, если пользователь хочет переключиться.
- Границу не пропускай. Подходящие формулировки: "медицинскую или психологическую помощь я не заменю", "не могу давать медицинские или психологические советы". Не используй длинный дисклеймер.
- Не отвечай одной короткой фразой или одним вопросом.
- Не повторяй мысль о переключении или подборе двумя разными предложениями.
- Не делай каждый ответ одинаковым по форме: не нужно всегда три ровных предложения одинакового размера.
- Не начинай с дисклеймера о своей роли: сначала нужна короткая человеческая реакция.
- Не повторяй каждый раз одну формулу про врача и психолога: можно сказать через специалиста, советы по состоянию, границы своей роли или отсутствие профессиональной помощи.
- Не обещай, что мероприятие улучшит состояние, настроение или даст силы.
- Не извиняйся за состояние пользователя: не используй "Извините", "Простите", "Прошу прощения"; вместо этого пиши "Жаль, что...", "Понимаю, что..." и тому подобное, разнообразие разрешено.
- Не давай личные советы вне афиши: прогулки, книги, сон, отдых, разговор по душам и похожие действия не подходят.
- Не перечисляй категории в тексте — они будут кнопками.
- Не пиши "не хорошо" раздельно; лучше "плохо", "неважно" или "не очень хорошо".
- Избегай неестественных дословных калек про состояние пользователя и глубину переживания.\n`;
    prompt = prompt.replace('{slotsInfo}', slotsInfo);
    console.log(`📝 [${requestType}] Используется промпт: healthComplaintPrompt`);
    return withLanguageGuard(prompt);
  }

  // КРИТИЧЕСКИ ВАЖНО: Проверяем, есть ли валидный город
  // Если города нет в базе или пользователь выбрал "Другой город", сообщаем об этом
  if (!hasValidCity) {
    let prompt = getPromptTemplate(getGeneralDialogPrompt);
    let cityWarning = '';

    if (isNonRussianCity && nonRussianCityName) {
      // Пользователь указал город, но он невалиден
      cityWarning =
        `\n\n⚠️⚠️⚠️ КРИТИЧЕСКИ ВАЖНО: Пользователь указал город "${nonRussianCityName}", по которому у тебя нет информации!\n\n` +
        `Ты ДОЛЖЕН вежливо сообщить пользователю, что по данному городу информации нет.\n\n` +
        `КРИТИЧЕСКИ ВАЖНО: НЕ говори фразы типа "я не поддерживаю поиск в других городах", "я не могу искать в городах кроме тех что в кнопках", "я не поддерживаю города кроме указанных в кнопках" и т.д.!\n\n` +
        `Вместо этого просто вежливо сообщи, что по данному городу информации нет, и предложи выбрать другой город из доступных.\n\n` +
        `Пример правильного ответа: "Извините, по городу "${nonRussianCityName}" у меня нет информации о событиях. Пожалуйста, укажите другой город, например: Москва, Санкт-Петербург, Казань, Екатеринбург и другие."\n\n` +
        `НЕ пытайся искать события в городах, по которым нет информации! НЕ генерируй выдуманные события!\n\n`;
    } else {
      // Пользователь выбрал "Другой город" или город не указан
      let cityButtonsInstruction = '';
      if (hasSelectedOtherCity) {
        // Если пользователь уже выбирал "Другой город" ранее, не показываем эту кнопку
        cityButtonsInstruction =
          `\n\n⚠️⚠️⚠️ КРИТИЧЕСКИ ВАЖНО: Пользователь УЖЕ выбирал "Другой город" ранее в этом диалоге!\n\n` +
          `КРИТИЧЕСКИ ВАЖНО (ОФФТОП): Если вопрос пользователя НЕ про мероприятия/афишу/досуг (например: погода, новости, финансы, бытовые вопросы), НЕ пытайся отвечать по теме оффтопа.\n` +
          `Вместо этого: кратко и дружелюбно объясни, что ты специализируешься на подборе мероприятий, и предложи перейти к подбору (можно показать кнопки городов).\n` +
          `Не используй один и тот же шаблонный текст — отвечай естественно.\n\n` +
          `ОБЯЗАТЕЛЬНО покажи кнопки с городами в массиве buttons!\n\n` +
          `Показывай ТОЛЬКО кнопки с конкретными городами: "Москва", "Санкт-Петербург", "Екатеринбург", "Новосибирск", "Казань", "Нижний Новгород" и т.д.\n\n` +
          `ЗАПРЕЩЕНО добавлять "Другой город" в кнопки - пользователь уже выбирал эту опцию!\n\n` +
          `ЗАПРЕЩЕНО оставлять массив buttons пустым - ОБЯЗАТЕЛЬНО покажи кнопки с городами!\n\n` +
          `КРИТИЧЕСКИ ВАЖНО: ЗАПРЕЩЕНО писать фразы вроде "Вот несколько вариантов...", "Есть несколько вариантов..." или обещать показать события — поиск ещё не выполнялся, вариантов пока нет!\n\n` +
          `КРИТИЧЕСКИ ВАЖНО: НЕ говори фразы типа "я не поддерживаю поиск в других городах", "я не могу искать в городах кроме тех что в кнопках", "я не поддерживаю города кроме указанных в кнопках" и т.д.!\n\n` +
          `Вместо этого просто вежливо попроси выбрать город из предложенных, например: "Чтобы подобрать подходящие мероприятия, мне нужно знать город. В каком городе вы хотите посетить событие?"\n\n` +
          `Пример правильного ответа: "Чтобы подобрать подходящие мероприятия, мне нужно знать город. В каком городе вы хотите посетить событие?" с кнопками: ["Москва", "Санкт-Петербург", "Екатеринбург", "Новосибирск", "Казань", "Нижний Новгород"]\n\n`;
      } else {
        // Если пользователь еще не выбирал "Другой город", можно показать эту кнопку
        cityButtonsInstruction =
          `\n\n⚠️⚠️⚠️ КРИТИЧЕСКИ ВАЖНО: Пользователь выбрал "Другой город" или город не указан!\n\n` +
          `КРИТИЧЕСКИ ВАЖНО (ОФФТОП): Если вопрос пользователя НЕ про мероприятия/афишу/досуг (например: погода, новости, финансы, бытовые вопросы), НЕ пытайся отвечать по теме оффтопа и НЕ требуй город "для ответа на оффтоп".\n` +
          `Вместо этого: кратко и дружелюбно объясни, что ты специализируешься на подборе мероприятий, и предложи перейти к подбору (можно показать кнопки городов).\n` +
          `Не используй один и тот же шаблонный текст — отвечай естественно.\n\n` +
          `Если запрос пользователя ПРО мероприятия/афишу/досуг — тогда сначала уточни валидный город (например, Москва, Санкт-Петербург, Екатеринбург и т.д.) ПЕРЕД тем, как говорить о найденных событиях.\n\n` +
          `НЕ говори о найденных событиях, НЕ описывай мероприятия, НЕ упоминай конкретные концерты, спектакли или выставки, пока не узнаешь валидный город!\n\n` +
          `КРИТИЧЕСКИ ВАЖНО: ЗАПРЕЩЕНО писать фразы вроде "Вот несколько вариантов...", "Есть несколько вариантов..." или обещать показать события — поиск ещё не выполнялся, вариантов пока нет!\n\n` +
          `КРИТИЧЕСКИ ВАЖНО: НЕ говори фразы типа "я не поддерживаю поиск в других городах", "я не могу искать в городах кроме тех что в кнопках", "я не поддерживаю города кроме указанных в кнопках" и т.д.!\n\n` +
          `Вместо этого просто вежливо попроси выбрать город из предложенных, например: "Чтобы подобрать подходящие мероприятия, мне нужно знать город. В каком городе вы хотите посетить событие?"\n\n` +
          `Пример правильного ответа: "Чтобы подобрать подходящие мероприятия, мне нужно знать город. В каком городе вы хотите посетить событие?"\n\n` +
          `📝 ПРИМЕР ПРАВИЛЬНОГО ОТВЕТА ДЛЯ ОФФТОПА (JSON):\n` +
          `{\n` +
          `  "text": "Я помогаю с подбором мероприятий и событий. По погоде подсказать не могу. Хотите, подберу, куда сходить? Выберите город:",\n` +
          `  "buttons": ["Москва", "Санкт-Петербург", "Екатеринбург", "Другой город"]\n` +
          `}\n\n` +
          `Можешь показать кнопки с городами, включая "Другой город" (только если пользователь еще не выбирал эту опцию ранее).\n\n`;
      }
      cityWarning = cityButtonsInstruction;
    }

    // Если пользователь уже выбирал "Другой город", добавляем явное указание о кнопках в начало промпта
    if (hasSelectedOtherCity) {
      const buttonsInstruction =
        `\n\n🔴🔴🔴 КРИТИЧЕСКИ ВАЖНО ДЛЯ КНОПОК: Пользователь УЖЕ выбирал "Другой город"!\n\n` +
        `ОБЯЗАТЕЛЬНО включи в массив buttons кнопки с городами: ["Москва", "Санкт-Петербург", "Екатеринбург", "Новосибирск", "Казань", "Нижний Новгород"]\n\n` +
        `НЕ оставляй массив buttons пустым! НЕ добавляй "Другой город" в кнопки!\n\n`;
      prompt = buttonsInstruction + cityWarning + prompt.replace('{slotsInfo}', slotsInfo);
    } else {
      prompt = cityWarning + prompt.replace('{slotsInfo}', slotsInfo);
    }
    console.log(`📝 [${requestType}] Город невалиден или отсутствует`);
    return withOfftopicRules(prompt);
  }

  // Сценарий: расплывчатый запрос - нужно задать уточняющие вопросы перед поиском
  if (
    vagueRequestInfo &&
    vagueRequestInfo.isVague &&
    Array.isArray(vagueRequestInfo.missingDetails) &&
    vagueRequestInfo.missingDetails.length > 0
  ) {
    let prompt = getPromptTemplate(getMissingDataPrompt);
    if (!prompt || prompt.trim().length === 0) {
      console.warn('⚠️ missingDataPrompt пустой, используем generalDialogPrompt');
      prompt = getPromptTemplate(getGeneralDialogPrompt);
    }

    const rawDetails = vagueRequestInfo.missingDetails;
    const EVENT_TYPE_SLOT_NAMES = [
      'тип_мероприятия',
      'тип_события',
      'предпочтения_типы_событий',
      'категория',
      'category',
      'event_type',
    ];
    const knownEventTypeSlot = slots.find((s) => EVENT_TYPE_SLOT_NAMES.includes(s.name));
    const knownEventTypeValue = knownEventTypeSlot ? knownEventTypeSlot.value : null;
    const normalizedEventTypeValue = String(knownEventTypeValue || '')
      .toLowerCase()
      .replace(/ё/g, 'е');
    const hasDislikedGenres =
      Array.isArray(userPreferences?.dislikedGenres) && userPreferences.dislikedGenres.length > 0;
    const isMusicEventRequest =
      normalizedEventTypeValue.includes('концерт') ||
      normalizedEventTypeValue.includes('музык') ||
      normalizedEventTypeValue.includes('фестиваль');
    const details =
      hasDislikedGenres && isMusicEventRequest
        ? rawDetails.filter((detail) => detail !== 'жанр')
        : rawDetails;
    const needsEventType = details.includes('тип_мероприятия');
    const hasRomanticContext = hasRomanticClarificationContext(slots, userMessage);
    const seedBase = `${userId}|${sessionId}|${userMessage}`;
    const seed =
      process.env.DETERMINISTIC_CLARIFICATION === '1' ? seedBase : `${seedBase}|${Date.now()}`;
    const selectableDetails = details.filter(
      (d) => d === 'жанр' || d === 'бюджет' || d === 'время' || d === 'дата'
    );
    const primaryDetail = needsEventType ? 'тип_мероприятия' : pickOne(selectableDetails, seed);

    // Формируем информацию о том, что нужно уточнить
    let clarificationInfo = '';

    if (isFirstMessage) {
      clarificationInfo += `\n\n✨ СТИЛЬ (ПЕРВОЕ СООБЩЕНИЕ): Это первый ответ ассистента.\n`;
      clarificationInfo += `Поздоровайся (используй "Здравствуйте!" или "Привет!"), кратко предложи помощь в подборе и задай уточняющий вопрос.\n`;
      clarificationInfo += `Сформулируй приветствие и предложение помощи САМОСТОЯТЕЛЬНО, естественно и дружелюбно.\n`;
      clarificationInfo += `ВАЖНО: Не используй одну и ту же фразу каждый раз. Будь разнообразным в формулировках.\n`;
      clarificationInfo += `КРИТИЧЕСКИ ВАЖНО: пиши "вы/вас/вам/ваш" со строчной буквы (кроме начала предложения).\n\n`;
    }

    if (needsEventType) {
      // Пользователь не указал тип мероприятия (просто "куда-то сходить")
      clarificationInfo += `\n\n🎯 ВАЖНО: Пользователь хочет куда-то сходить, но не уточнил, что именно его интересует.\n`;
      if (hasRomanticContext) {
        clarificationInfo += `💞 РОМАНТИЧЕСКИЙ КОНТЕКСТ: пользователь ищет вариант для свидания/вечера вдвоём.\n`;
        clarificationInfo += `Сохрани этот смысл в первой фразе ответа: вопрос должен звучать как подбор для романтичного вечера, а НЕ как сухой универсальный опрос.\n`;
        clarificationInfo += `Разрешены формулировки в духе "Для вечера вдвоём что вам ближе?" или "Для свидания что хочется посмотреть?". Не копируй их дословно каждый раз.\n\n`;
      }
      clarificationInfo += `Задай 1-2 КОРОТКИХ уточняющих вопроса, чтобы понять предпочтения.\n\n`;
      clarificationInfo += `ОБЯЗАТЕЛЬНО спроси тип мероприятия! (Сформулируй вопрос естественно и разнообразно)\n\n`;
      clarificationInfo += `КРИТИЧЕСКИ ВАЖНО: НЕ формулируй вопрос как ДА/НЕТ (например, "вы ищете ...?").\n`;
      clarificationInfo += `Вопрос ДОЛЖЕН соответствовать кнопкам и подразумевать выбор из них.\n\n`;
      clarificationInfo += `Кнопки: ["Концерты", "Театры", "Выставки", "Музеи", "Стендап", "Покажи все"]\n`;
      clarificationInfo += `КРИТИЧЕСКИ ВАЖНО: НЕ перечисляй названия кнопок (категории) в самом тексте ответа! Они отобразятся в интерфейсе автоматически.\n\n`;
    } else {
      // Пользователь указал тип, но без деталей
      clarificationInfo += `\n\n🎯 ВАЖНО: Пользователь сделал расплывчатый запрос (указал город и тип мероприятия, но без деталей).\n`;
      clarificationInfo += `Задай 1-2 КОРОТКИХ уточняющих вопроса, чтобы подобрать лучшие варианты.\n\n`;
      if (knownEventTypeValue) {
        clarificationInfo += `ТИП МЕРОПРИЯТИЯ УЖЕ ИЗВЕСТЕН: "${knownEventTypeValue}".\n`;
        clarificationInfo += `КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО спрашивать категорию/тип мероприятия — он уже определён!\n`;
        clarificationInfo += `ЗАПРЕЩЕНО предлагать кнопки: "Концерты", "Театры", "Выставки", "Музеи", "Стендап" — это кнопки выбора категории, они НЕУМЕСТНЫ!\n`;
        clarificationInfo += `Спрашивай ТОЛЬКО о деталях: дата, время, бюджет, жанр (если применимо).\n\n`;
      }
    }

    if (normalizedCity) {
      clarificationInfo += `✅ ГОРОД УЖЕ ИЗВЕСТЕН: "${normalizedCity}".\n`;
      clarificationInfo += `КРИТИЧЕСКИ ВАЖНО: ЗАПРЕЩЕНО спрашивать город или предлагать выбор города.\n\n`;
    }

    clarificationInfo += buildClarificationAcknowledgement(slots);
    clarificationInfo += buildMoodClarificationAcknowledgement(slots, userMessage);

    if (primaryDetail) {
      clarificationInfo += `СЕЙЧАС уточни ТОЛЬКО ОДНУ деталь: ${primaryDetail}.\n`;
      clarificationInfo += `КРИТИЧЕСКИ ВАЖНО: НЕ пиши "или" (например, "жанр или бюджет") и НЕ перечисляй несколько уточнений в одном вопросе.\n\n`;
    }

    // Генерируем конкретные вопросы и кнопки в зависимости от недостающих деталей
    let questionsAndButtons = '';

    if (needsEventType) {
      questionsAndButtons += `- Тип мероприятия: задай вопрос о категории (сформулируй своими словами). Кнопки: ["Концерты", "Театры", "Выставки", "Музеи", "Стендап", "Покажи все"]\n`;
    }
    if (!needsEventType && primaryDetail === 'жанр') {
      const genreButtons = getGenreClarificationButtonsForEventType(
        knownEventTypeValue,
        userPreferences,
        slots
      );
      questionsAndButtons += `- Жанр: задай короткий вопрос о предпочитаемом жанре (сформулируй своими словами). Кнопки: ${JSON.stringify(genreButtons)}\n`;
    }
    if (!needsEventType && primaryDetail === 'бюджет') {
      questionsAndButtons += `- Бюджет: задай короткий вопрос о комфортном бюджете (сформулируй своими словами). Кнопки: ["До 500₽", "До 1000₽", "До 3000₽", "До 5000₽", "Не важно"]\n`;
    }
    if (!needsEventType && primaryDetail === 'время') {
      questionsAndButtons += `- Время: задай короткий вопрос о предпочтительном времени начала (сформулируй своими словами). Кнопки: ["Утром", "Днем", "Вечером", "Ночью", "Любое время", "Покажи все"]\n`;
    }
    if (!needsEventType && primaryDetail === 'дата') {
      questionsAndButtons += `- Дата: задай короткий вопрос о дне или периоде посещения (сформулируй своими словами). Кнопки: ["Сегодня", "Завтра", "Ближайшие выходные", "На следующей неделе", "Любая", "Покажи все"]\n`;
    }

    if (questionsAndButtons) {
      clarificationInfo += `КНОПКИ ДЛЯ ТЕКУЩЕГО УТОЧНЕНИЯ:\n${questionsAndButtons}\n`;
    }

    clarificationInfo += `\n⚠️ КРИТИЧЕСКИ ВАЖНО:\n`;
    clarificationInfo += `- Задай один короткий вопрос по самой важной недостающей детали\n`;
    clarificationInfo += `- Добавь релевантные кнопки быстрого ответа и кнопку "Покажи все"\n`;
    clarificationInfo += `- НЕ перечисляй варианты ответа (кнопки) в самом тексте сообщения — они отобразятся автоматически под текстом\n`;
    clarificationInfo += `- НЕ генерируй и НЕ описывай события: сейчас этап уточнения, а не выдачи\n`;
    clarificationInfo += `- ЗАПРЕЩЕНО писать фразы вроде "Вот несколько вариантов...", "Есть несколько вариантов...", "На эти даты есть разные варианты...", "Могу предложить несколько вариантов..." — поиск ещё не выполнялся и карточек событий в ответе не будет\n`;
    clarificationInfo += `- НЕ пиши, что "ничего не найдено": поиск ещё не выполнялся\n`;
    clarificationInfo += `- Если в ответе НЕТ карточек событий, текст НЕ ДОЛЖЕН создавать ощущение, что подборка уже найдена или приложена\n`;
    clarificationInfo += `- Если известен период вроде "май", "в мае", "на выходных", сохраняй именно эту формулировку: НЕ придумывай числа внутри периода\n`;
    clarificationInfo += `- Плохой пример: "Вот несколько вариантов, на которые вы можете обратить внимание в мае в Нижнем Новгороде. В каком направлении вас больше интересует?"\n`;
    clarificationInfo += `- Хороший пример: "В мае в Нижнем Новгороде что вам было бы интереснее?"\n`;
    clarificationInfo += `- Хороший пример при известном типе: "Какой жанр вам ближе в мае в Нижнем Новгороде?"\n`;
    clarificationInfo += `- Сформулируй вопрос естественно, без копирования шаблонов и без плейсхолдеров\n`;

    // Заменяем плейсхолдер missingSlotsInfo на нашу информацию
    if (prompt.includes('{missingSlotsInfo}')) {
      prompt = prompt.replace('{missingSlotsInfo}', clarificationInfo);
    } else {
      prompt = clarificationInfo + prompt;
    }

    prompt = prompt.replace('{slotsInfo}', slotsInfo);

    // Добавляем строгий запрет на генерацию событий
    const knownSlotsStr =
      !needsEventType && knownEventTypeValue
        ? ` (тип мероприятия "${knownEventTypeValue}" УЖЕ ИЗВЕСТЕН — НЕ спрашивай о нём!)`
        : '';
    const noEventsWarning = `\n\nКРИТИЧЕСКИ ВАЖНО: В КОНТЕКСТЕ НЕТ СПИСКА СОБЫТИЙ В ФОРМАТЕ JSON! ⚠️⚠️⚠️
	НЕ ГЕНЕРИРУЙ СОБЫТИЯ! НЕ ОПИСЫВАЙ МЕРОПРИЯТИЯ! СНАЧАЛА ЗАДАЙ УТОЧНЯЮЩИЕ ВОПРОСЫ!
	ЗАПРЕЩЕНО писать, что "ничего не найдено" — поиск ещё не выполнялся.
	ЗАПРЕЩЕНО писать фразы вроде "Вот несколько вариантов...", "Есть несколько вариантов...", "На эти даты есть разные варианты...", "Могу предложить несколько вариантов...", так как вариантов пока нет и карточек событий не будет.
	Если карточек нет, вопрос должен звучать как УТОЧНЕНИЕ, а не как анонс уже найденной подборки.
	Твоя задача СЕЙЧАС - задать 1-2 уточняющих вопроса${needsEventType ? ' о типе мероприятия' : ' о дате, жанре, времени или бюджете'}${knownSlotsStr}.\n\n`;

    prompt = noEventsWarning + prompt;

    console.log(
      `📝 [${requestType}] Используется промпт: vagueRequestClarification (уточнения: ${vagueRequestInfo.missingDetails.join(', ')})`
    );
    return withOfftopicRules(prompt);
  }

  // Сценарий: пользователь явно попросил изменить/уточнить дату
  if (userIntent.changeDateRequest) {
    let prompt = getPromptTemplate(getGeneralDialogPrompt);

    const changeDateInstruction =
      '\n\nПользователь хочет уточнить дату мероприятия.\n\n' +
      'Твоя задача - предложить варианты дат с кнопками для выбора.\n\n' +
      '📝 ПРИМЕР ПРАВИЛЬНОГО ОТВЕТА(не копируй дословно) В ФОРМАТЕ JSON:\n' +
      '{\n' +
      '  "text": "На какую дату вы планируете посетить мероприятие?",\n' +
      '  "buttons": ["Сегодня", "Завтра", "Ближайшие выходные", "На следующей неделе", "Любая"]\n' +
      '}\n\n' +
      'КРИТИЧЕСКИ ВАЖНО:\n' +
      '- НЕ перечисляй варианты дат в самом тексте ответа — кнопки отобразятся автоматически\n' +
      '- НЕ предлагай конкретные месяцы (январь, июль и т.д.) - только относительные даты\n' +
      '- НЕ перечисляй уже показанные события\n' +
      '- Сосредоточься ТОЛЬКО на уточнении даты\n\n';

    prompt = changeDateInstruction + prompt.replace('{slotsInfo}', slotsInfo);

    console.log(`📝 [${requestType}] Используется промпт: changeDateClarification`);
    return withOfftopicRules(prompt);
  }

  // Сценарий: пользователь просит уточнить жанр/бюджет/время/дату
  const messageLower = userMessage.toLowerCase();
  const isGenreClarification =
    messageLower.includes('уточнить жанр') ||
    messageLower.includes('выбрать жанр') ||
    messageLower.includes('другой жанр');
  const isBudgetClarification =
    messageLower.includes('уточнить бюджет') || messageLower.includes('изменить бюджет');
  const isTimeClarification =
    messageLower.includes('уточнить время') ||
    messageLower.includes('изменить время') ||
    messageLower.includes('выбрать время');
  const isDateClarification =
    messageLower.includes('уточнить дату') || messageLower.includes('изменить дату');

  if (isGenreClarification || isBudgetClarification || isTimeClarification || isDateClarification) {
    let prompt = getPromptTemplate(getGeneralDialogPrompt);
    let clarificationInstruction = '';
    const acknowledgementInstruction = buildClarificationAcknowledgement(slots);

    if (isGenreClarification) {
      const knownEventType = getSlotValue(slots, [
        'тип_мероприятия',
        'тип_события',
        'предпочтения_типы_событий',
        'категория',
        'category',
        'event_type',
      ]);
      const genreButtons = getGenreClarificationButtonsForEventType(
        knownEventType,
        providedUserPreferences,
        slots
      );
      clarificationInstruction =
        `\n\nПользователь хочет уточнить жанр мероприятия.\n\n` +
        `Твоя задача - предложить варианты жанров с кнопками для выбора.\n` +
        `Используй именно такие кнопки жанров: ${JSON.stringify(genreButtons)}.\n\n` +
        `Коротко подтверди уже известные параметры и задай один вопрос именно о жанре.\n` +
        `Формулируй вопрос по-разному, без копирования шаблонов из предыдущих ответов.\n` +
        `КРИТИЧЕСКИ ВАЖНО: НЕ перечисляй варианты (кнопки) в самом тексте ответа!\n\n`;
    } else if (isBudgetClarification) {
      clarificationInstruction =
        `\n\nПользователь хочет уточнить бюджет.\n\n` +
        `Твоя задача - предложить варианты бюджета с кнопками для выбора.\n\n` +
        `Коротко подтверди уже известные параметры и задай один вопрос именно о бюджете.\n` +
        `Не используй одинаковое начало ответа каждый раз.\n` +
        `КРИТИЧЕСКИ ВАЖНО: НЕ перечисляй варианты (кнопки) в самом тексте ответа!\n\n`;
    } else if (isTimeClarification) {
      clarificationInstruction =
        `\n\nПользователь хочет уточнить время.\n\n` +
        `Твоя задача - предложить варианты времени с кнопками для выбора.\n\n` +
        `Коротко подтверди уже известные параметры и задай один вопрос именно о времени.\n` +
        `Меняй формулировку от ответа к ответу.\n` +
        `КРИТИЧЕСКИ ВАЖНО: НЕ перечисляй варианты (кнопки) в самом тексте ответа!\n\n`;
    } else if (isDateClarification) {
      clarificationInstruction =
        `\n\nПользователь хочет уточнить дату.\n\n` +
        `Твоя задача - предложить варианты дат с кнопками для выбора.\n\n` +
        `Коротко подтверди уже известные параметры и задай один вопрос именно о дате.\n` +
        `Не повторяй одну и ту же формулу ответа.\n` +
        `КРИТИЧЕСКИ ВАЖНО: НЕ перечисляй варианты (кнопки) в самом тексте ответа!\n\n`;
    }

    prompt =
      clarificationInstruction +
      acknowledgementInstruction +
      prompt.replace('{slotsInfo}', slotsInfo);
    console.log(
      `📝 [${requestType}] Используется промпт: clarificationRequest (${isGenreClarification ? 'жанр' : isBudgetClarification ? 'бюджет' : isTimeClarification ? 'время' : 'дата'})`
    );
    return withOfftopicRules(prompt);
  }

  // Сценарий: пользователь хочет изменить предпочтения
  if (userIntent.changePreferencesRequest) {
    let prompt = getPromptTemplate(getGeneralDialogPrompt);

    const changePreferencesInstruction =
      '\n\nКРИТИЧЕСКИ ВАЖНО: Пользователь хочет изменить свои сохранённые предпочтения!\n\n' +
      'Твоя задача:\n' +
      '1. Вежливо спросить, что именно пользователь хочет изменить (жанр, тип события, бюджет, город)\n' +
      '2. Предложить кнопки для выбора: ["Изменить жанр", "Изменить тип события", "Изменить бюджет", "Изменить город", "Сбросить все"]\n' +
      '3. НЕ генерируй новые события! НЕ показывай мероприятия!\n' +
      '4. Сосредоточься ТОЛЬКО на уточнении, что пользователь хочет изменить.\n\n' +
      'Пример правильного ответа: "Хорошо, давайте изменим ваши предпочтения. Что именно вы хотите изменить?"\n\n';

    if (prompt.includes('{slotsInfo}')) {
      prompt = prompt.replace('{slotsInfo}', slotsInfo);
    } else {
      prompt = `${slotsInfo}\n\n${prompt}`;
    }

    prompt = changePreferencesInstruction + prompt;

    console.log(`📝 [${requestType}] Используется промпт: changePreferencesClarification`);
    return withOfftopicRules(prompt);
  }
  if (noResultsDetected) {
    let prompt = getPromptTemplate(getNoResultsPrompt);
    if (!prompt || prompt.trim().length === 0) {
      console.warn('⚠️ noResultsPrompt пустой, используем generalDialogPrompt');
      prompt = getPromptTemplate(getGeneralDialogPrompt);
    }
    prompt = prompt.replace('{slotsInfo}', slotsInfo);
    console.log(`📝 [${requestType}] Используется промпт: noResultsPrompt`);
    return withOfftopicRules(prompt);
  }

  // Сценарий: пользователь просит детальную информацию о конкретном событии
  if (
    userIntent.eventDetailsRequest &&
    eventDetailsContext &&
    Array.isArray(eventDetailsContext.events) &&
    eventDetailsContext.events.length > 0
  ) {
    if (userIntent.eventDetailsRequest.isBuyTicketAction) {
      let prompt = getGeneralDialogPrompt();
      prompt = compactPromptTemplate(prompt);

      const buyTicketInstruction =
        `\n\nПользователь хочет купить билет на выбранное мероприятие.\n\n` +
        `Твоя задача — естественно и без шаблонных фраз помочь с покупкой: коротко сообщить ключевые детали события (название, дата, время, площадка, цены) и мягко предложить перейти к оформлению.\n\n` +
        `Тон должен быть дружелюбным, уверенным и ненавязчивым. Не начинай ответ с фраз вроде "Отличный выбор!", "Прекрасный выбор!" или других одинаково рекламных оценок.\n` +
        `Ответ должен быть коротким, по делу и звучать как живой ассистент, а не как заготовленный шаблон.\n` +
        `ОБЯЗАТЕЛЬНО добавь кнопки ["Купить билет", "Показать другие варианты"] в массив buttons.\n\n` +
        `ПРЕДОСТАВЛЕННОЕ СОБЫТИЕ:\n`;

      const eventsForDetailsPrompt = eventDetailsContext.selectedEvent
        ? [eventDetailsContext.selectedEvent]
        : eventDetailsContext.events;

      const eventDetailsJson = formatEventDetailsForPrompt(
        eventsForDetailsPrompt,
        eventDetailsContext.originalEvents || null
      );

      prompt =
        buyTicketInstruction + eventDetailsJson + '\n\n' + prompt.replace('{slotsInfo}', slotsInfo);

      console.log(
        `📝 [${requestType}] Используется промпт: buyTicketPrompt (событий: ${eventsForDetailsPrompt.length})`
      );
      return withOfftopicRules(prompt);
    }

    let prompt = getPromptTemplate(getEventDetailsPrompt);
    if (!prompt || prompt.trim().length === 0) {
      console.warn('⚠️ eventDetailsPrompt пустой, используем generalDialogPrompt');
      prompt = getPromptTemplate(getGeneralDialogPrompt);
    }

    prompt = prompt.replace('{slotsInfo}', slotsInfo);
    prompt = prompt.replace('{userMessage}', userMessage);
    const referenceText = eventDetailsContext.reference
      ? String(eventDetailsContext.reference)
      : 'не указано';
    prompt = prompt.replace('{eventReference}', referenceText);

    const eventsForDetailsPrompt = eventDetailsContext.selectedEvent
      ? [eventDetailsContext.selectedEvent]
      : eventDetailsContext.events;

    const eventDetailsJson = formatEventDetailsForPrompt(
      eventsForDetailsPrompt,
      eventDetailsContext.originalEvents || null
    );
    prompt = prompt.replace('{eventDetails}', eventDetailsJson);

    console.log(
      `📝 [${requestType}] Используется промпт: eventDetailsPrompt (событий: ${eventsForDetailsPrompt.length})`
    );
    return withOfftopicRules(prompt, { responseMode: 'detailed' });
  }

  // Сценарий 3: Есть готовые события от AI Tools - используем промпт для отправки предложения
  // Если событий нет, переходим к общему диалогу или выявлению недостающих данных
  // КРИТИЧЕСКИ ВАЖНО: Проверяем, что offerEvents это массив с элементами, а не null, undefined или пустой массив
  if (Array.isArray(offerEvents) && offerEvents.length > 0) {
    let prompt = getPromptTemplate(getOfferDeliveryPrompt);

    const sanitizeDescriptionForPrompt = (value) => {
      if (!value || typeof value !== 'string') {
        return null;
      }
      const text = value.replace(/\s+/g, ' ').trim();
      if (!text) return null;

      const cleanTruncatedTail = (input) => {
        let out = String(input || '').trim();
        if (!out) return out;

        // Убираем зависшие знаки препинания/разделители.
        out = out.replace(/[\s,;:–—-]+$/u, '').trim();

        // Убираем оборванные 1–2 буквенные хвосты ("в", "и", "на", "по", "и т.п."),
        // которые появляются из-за обрезки по длине.
        const tailWordPattern = /\s+(и|а|но|или|да|в|на|с|к|о|у|от|до|по|за|об|из|для)\.?$/iu;
        while (tailWordPattern.test(out)) {
          out = out.replace(tailWordPattern, '').trim();
          out = out.replace(/[\s,;:–—-]+$/u, '').trim();
        }

        // Если всё равно оборвали на одиночной букве перед точкой ("..., в.")
        out = out.replace(/\s+[A-Za-zА-Яа-яЁё]\.$/u, '').trim();

        // Финальная точка, если нет завершения предложения.
        if (out && !/[.!?…]$/u.test(out)) {
          out = `${out}.`;
        }

        return out || null;
      };

      // Сжимаем description до короткой выжимки, чтобы LLM не "цитировала простыню"
      // и не переносила в ответ обрезанные куски вида "…".
      const withoutTrailingEllipsis = text.replace(/(?:\s*(?:\.{3}|…)\s*)+$/u, '').trim();
      const base = withoutTrailingEllipsis || text;

      const sentences = base
        .split(/[.!?…]+/u)
        .map((s) => s.trim())
        .filter(Boolean);

      const takeSentences = [];
      for (const sentence of sentences) {
        if (takeSentences.length >= 2) break;
        takeSentences.push(sentence);
      }

      const combined = takeSentences.length > 0 ? `${takeSentences.join('. ')}.` : base;

      const MAX_CHARS = 420;
      if (combined.length <= MAX_CHARS) {
        return cleanTruncatedTail(combined);
      }

      const slice = combined.slice(0, MAX_CHARS);
      const lastSpace = slice.lastIndexOf(' ');
      const trimmed = (lastSpace > 120 ? slice.slice(0, lastSpace) : slice).trim();
      return cleanTruncatedTail(trimmed.replace(/(?:\s*(?:\.{3}|…)\s*)+$/u, '').trim());
    };

    // Формируем список реальных событий для подстановки в промпт
    // Инструкции и правила находятся в файле промпта, здесь только динамический список событий
    const eventsJson = JSON.stringify(
      offerEvents.map((event) => ({
        title: event.title || null,
        activityTitle: event.activityTitle || null,
        date: event.date || null,
        time: event.time || null,
        venue: event.venue || null,
        address: event.address || null,
        city: event.city || null,
        ageRestriction: event.ageRestriction || null,
        durationMinutes: event.durationMinutes ?? null,
        priceMin: event.priceMin ?? null,
        priceMax: event.priceMax ?? null,
        url: event.url || null,
        // Передаем описание из результата поиска Kassir API, чтобы LLM могла опираться на него.
        // LLM должна ПЕРЕФРАЗИРОВАТЬ и не добавлять фактов, которых нет в данных.
        description: sanitizeDescriptionForPrompt(event.description),
        posterImage: event.posterImage || null,
        genre: event.genre || null,
        category: event.category || null,
        extraCategories: event.extraCategories || null,
        mood: event.mood || null,
        artists: event.artists || null,
      })),
      null,
      2
    );

    // Формируем явный список названий событий для дополнительной строгости
    const eventTitlesList = offerEvents
      .map((e, idx) => `${idx + 1}. "${e.title || 'Без названия'}"`)
      .join('\n');

    // В промпте плейсхолдеры встречаются много раз — важно заменять ВСЕ вхождения,
    // иначе LLM видит "{eventsCount}" и может игнорировать правила количества/формата.
    prompt = prompt.replaceAll('{offerText}', eventsJson);
    prompt = prompt.replaceAll('{eventsCount}', String(offerEvents.length));
    prompt = prompt.replaceAll('{slotsInfo}', slotsInfo);
    prompt = prompt.replaceAll('{eventTitlesList}', eventTitlesList);

    // Description может содержать служебные блоки (правила прохода, ограничения и т.п.).
    // В ответе пользователю нужен короткий смысл мероприятия без "регламента".
    const descriptionGuard =
      `\n\nВАЖНО ПРО ОПИСАНИЯ:\n` +
      `- "description" (если есть) используй только как источник фактов о программе/формате.\n` +
      `- Если "description" лишь повторяет название события или шаблон вроде "Событие ... на площадке ...", считай, что нормального описания нет.\n` +
      `- НЕ копируй и НЕ пересказывай правила прохода/ограничения/регламент.\n` +
      `- Если "description" нет, НЕ выдумывай детали — дай нейтральное описание по полям title/activityTitle/venue/city/category/extraCategories/ageRestriction/durationMinutes.\n` +
      `- НЕ пиши фразы вида "Укажите/сообщите/напишите, если хотите больше информации" — это запрещено.\n` +
      `  Вместо этого: 1 короткая фраза (например: "Рок-концерт на площадке <venue>." / "Концерт <title> на <venue>.").\n\n`;
    const pricingGuard =
      `\n\nВАЖНО ПРО ЦЕНЫ:\n` +
      `- Если priceMin = 0 и (priceMax = 0 или null) — пиши строку: "Цена: бесплатно".\n` +
      `- Если priceMin и priceMax = null — НЕ выдумывай цену и не добавляй строку "Цена".\n\n`;
    prompt = descriptionGuard + pricingGuard + prompt;

    // КРИТИЧЕСКИ ВАЖНО: Если город валиден и события найдены, добавляем краткое указание,
    // что город определен правильно, если в истории была опечатка
    // Это предотвращает ситуацию, когда LLM видит опечатку в истории и думает, что город не определен
    if (hasValidCity && citySlot && citySlot.value) {
      const normalizedCity = String(citySlot.value).trim();
      // Краткое подтверждение города без избыточных инструкций
      const cityConfirmation =
        `\n\n✅ ГОРОД: "${normalizedCity}" (события найдены)\n\n` +
        `Твоя задача - описать ВСЕ ${offerEvents.length} событий из списка JSON выше.\n\n`;
      prompt = cityConfirmation + prompt;
    }

    console.log(
      `📝 [${requestType}] Используется промпт: offerDeliveryPrompt (${offerEvents.length} событий)`
    );
    console.log(
      `📋 [${requestType}] События для промпта (первые 3):`,
      offerEvents.slice(0, 3).map((e) => ({
        id: e.id,
        title: e.title,
        date: e.date,
        venue: e.venue,
      }))
    );
    console.log(
      `📋 [${requestType}] ВСЕ события для промпта (названия):`,
      offerEvents.map((e) => e.title || 'Без названия')
    );

    return withOfftopicRules(prompt, { responseMode: 'detailed' });
  }

  // Получаем обязательные слоты для типа запроса
  const requiredSlots = await getRequiredSlots(requestType);
  const userSlotNames = new Set(slots.map((slot) => slot.name));

  // Определяем недостающие обязательные слоты
  const missingRequiredSlots = requiredSlots.filter((slotName) => !userSlotNames.has(slotName));

  // Сценарий 2: Есть недостающие обязательные слоты - используем промпт для выявления недостающих данных
  if (missingRequiredSlots.length > 0) {
    let prompt = getPromptTemplate(getMissingDataPrompt);

    // Проверяем, есть ли слот "все" (пользователь нажал "Покажи все")
    const hasShowAllSlot = slots.some(
      (slot) =>
        slot &&
        slot.name === 'поисковый_запрос' &&
        slot.value &&
        String(slot.value).toLowerCase().trim() === 'все'
    );

    // Формируем информацию о недостающих данных
    let missingSlotsInfo = `\nСледующие обязательные данные еще НЕ собраны: ${missingRequiredSlots.join(', ')}\n\n`;
    missingSlotsInfo += 'НЕДОСТАЮЩИЕ ДАННЫЕ (задай вопросы для их сбора):\n';
    missingRequiredSlots.forEach((slotName) => {
      if (slotName === 'город') {
        let cityInstruction = `- город: обязательно уточни город пользователя (например: "В каком городе вы хотите посетить мероприятие?" или "Укажите, пожалуйста, город")\n`;
        cityInstruction += `⚠️ КРИТИЧЕСКИ ВАЖНО: НЕ говори фразы типа "я не поддерживаю поиск в других городах", "я не могу искать в городах кроме тех что в кнопках", "я не поддерживаю города кроме указанных в кнопках" и т.д.!\n`;
        cityInstruction += `Вместо этого просто вежливо попроси выбрать город из предложенных.\n`;
        cityInstruction += `⚠️ КРИТИЧЕСКИ ВАЖНО: Пока город не указан, тебе РАЗРЕШЕНО только попросить выбрать город. НЕЛЬЗЯ писать, что концерты/спектакли уже найдены, нельзя упоминать исполнителей, даты, площадки, билеты, цены, "другие варианты" или "посмотреть ещё".\n`;
        if (hasSelectedOtherCity) {
          cityInstruction += `⚠️ КРИТИЧЕСКИ ВАЖНО: Пользователь УЖЕ выбирал "Другой город" ранее! ОБЯЗАТЕЛЬНО покажи кнопки с городами в массиве buttons! НЕ показывай кнопку "Другой город"! Показывай ТОЛЬКО кнопки с конкретными городами: "Москва", "Санкт-Петербург", "Екатеринбург", "Новосибирск", "Казань", "Нижний Новгород" и т.д. НЕ оставляй массив buttons пустым!\n`;
        }
        missingSlotsInfo += cityInstruction;
      } else if (slotName === 'дата_события') {
        missingSlotsInfo += `- дата_события: обязательно уточни дату или период события (например: "На какую дату вы планируете мероприятие?" или "Когда вам удобно?" или "На какой день?")\n`;
      } else if (slotName === 'поисковый_запрос') {
        // КРИТИЧЕСКИ ВАЖНО: Если пользователь нажал "Покажи все", не спрашиваем тип мероприятия
        if (hasShowAllSlot) {
          // Пользователь уже выбрал "Покажи все", поэтому не нужно спрашивать тип мероприятия
          // Этот слот не должен быть в missingRequiredSlots, но на всякий случай проверяем
          return; // Пропускаем этот слот
        }
        missingSlotsInfo += `- поисковый запрос: КРИТИЧЕСКИ ВАЖНО! Уточни, что именно ищет пользователь. НЕ начинай поиск без этой информации! Спроси про тип события (концерт, театр, выставка и т.д.), жанр, исполнителя или конкретное мероприятие. Используй кнопки для выбора категорий: "Концерты", "Театры", "Выставки", "Музеи", "Кино", "Покажи все". Примеры вопросов: "Какое мероприятие вас интересует? Концерт, театр, выставка или что-то другое?" или "Расскажите, что именно вы хотите посетить? Можно назвать тип события, жанр или исполнителя."\n`;
        missingSlotsInfo += `КРИТИЧЕСКИ ВАЖНО: НЕ перечисляй названия кнопок (варианты ответа) в самом тексте сообщения! Они будут показаны под текстом автоматически.\n`;
      } else {
        missingSlotsInfo += `- ${slotName}: обязательно уточни эту информацию\n`;
      }
    });

    prompt = prompt.replace('{missingSlotsInfo}', missingSlotsInfo);
    prompt = prompt.replace('{slotsInfo}', slotsInfo);

    // КРИТИЧЕСКИ ВАЖНО: Добавляем явное предупреждение о том, что события НЕ предоставлены
    // Это должно быть в самом начале промпта, чтобы LLM точно это увидел
    const noEventsWarning =
      `\n\n⚠️ В контексте нет списка событий в формате JSON. Сейчас можно только собрать недостающие данные.\n` +
      `РАЗРЕШЕНО только: 1) задать ОДИН уточняющий вопрос по ближайшему недостающему слоту; 2) предложить короткие безопасные buttons для этого уточнения.\n` +
      `ЗАПРЕЩЕНО: перечислять конкретные мероприятия, упоминать будто что-то найдено, предлагать "другие варианты", писать про даты/площадки/цены/билеты без списка событий в JSON.\n` +
      `ЗАПРЕЩЕННЫЕ паттерны из прошлых ошибок: "Вот несколько концертов ...", "Вот несколько вариантов ...", "Для 25 ноября ... есть концерты ...", "На 25 ноября ... билеты уже можно приобрести", "Выберите дату и место", "Хотите увидеть другие варианты?".\n\n`;

    // Если пользователь уже выбирал "Другой город" и нужно спросить город, добавляем явное указание о кнопках
    let buttonsWarning = '';
    if (hasSelectedOtherCity && missingRequiredSlots.includes('город')) {
      buttonsWarning =
        `\n\n🔴🔴🔴 КРИТИЧЕСКИ ВАЖНО ДЛЯ КНОПОК: Пользователь УЖЕ выбирал "Другой город"!\n\n` +
        `ОБЯЗАТЕЛЬНО включи в массив buttons кнопки с городами: ["Москва", "Санкт-Петербург", "Екатеринбург", "Новосибирск", "Казань", "Нижний Новгород"]\n\n` +
        `НЕ оставляй массив buttons пустым! НЕ добавляй "Другой город" в кнопки!\n\n`;
    }

    let cityOnlyWarning = '';
    if (missingRequiredSlots.includes('город')) {
      cityOnlyWarning =
        `\n\n🔴 СЕЙЧАС НЕ ХВАТАЕТ ГОРОДА. ЭТО ЖЕСТКИЙ СЦЕНАРИЙ "УТОЧНИ ГОРОД".\n` +
        `Твой ответ должен делать только одно: попросить выбрать город.\n` +
        `Допустимый смысл ответа: "Чтобы продолжить подбор, мне нужен город. В каком городе вы хотите посетить событие?"\n` +
        `Недопустимый смысл ответа: любые найденные концерты, даты, площадки, билеты, "похожие варианты", "другие варианты", "посмотреть ещё".\n` +
        `Если в history есть названия событий, дат или площадок, ИГНОРИРУЙ их, пока в текущем контексте нет валидного города и списка событий JSON.\n\n`;
    }

    prompt = cityOnlyWarning + buttonsWarning + noEventsWarning + prompt;

    // Удаляем инструкцию о приветствии, если это не первое сообщение
    if (!isFirstMessage) {
      // Заменяем инструкцию о приветствии на инструкцию без приветствия
      prompt = prompt.replace(
        /КРИТИЧЕСКИ ВАЖНО: Приветствуй пользователя ТОЛЬКО если это первое сообщение в диалоге\. Если диалог уже начался \(в истории есть сообщения ассистента\), НЕ здоровайся снова - просто уточняй детали/,
        'ВАЖНО: Диалог уже начался. НЕ здоровайся снова - просто уточняй детали'
      );
    }

    console.log(
      `📝 [${requestType}] Используется промпт: missingDataPrompt (недостающие: ${missingRequiredSlots.join(', ')}, первое сообщение: ${isFirstMessage})`
    );
    console.log(
      `⚠️ [${requestType}] ВАЖНО: События НЕ предоставлены в контексте, LLM должен ТОЛЬКО собирать данные!`
    );
    return withOfftopicRules(prompt);
  }

  // КРИТИЧЕСКИ ВАЖНО: Если все слоты собраны, но событий нет - используем noResultsPrompt
  // Это предотвращает выдумывание событий LLM
  // НО: только если это НЕ запрос на детали события и НЕ жалоба на здоровье (они обрабатываются выше)
  const requiredSlotsForCheck = await getRequiredSlots(requestType);
  const userSlotNamesForCheck = new Set(slots.map((slot) => slot.name));
  const allRequiredCollected = requiredSlotsForCheck.every((slotName) =>
    userSlotNamesForCheck.has(slotName)
  );

  // Проверяем, что offerEvents это пустой массив (поиск запускался, но вернул 0 событий)
  // offerEvents === null/undefined означает, что поиск мог вообще не запускаться.
  // noResultsPrompt используем только когда поиск запускался и вернул 0 событий.
  const hasNoEvents = Array.isArray(offerEvents) && offerEvents.length === 0;

  // Используем noResultsPrompt только если:
  // 1. Все обязательные слоты собраны
  // 2. Событий нет
  // 3. Это НЕ запрос на детали события (он обрабатывается выше)
  // 4. noResultsDetected еще не установлен (иначе первая проверка уже сработала)
  if (
    allRequiredCollected &&
    hasNoEvents &&
    !noResultsDetected &&
    !userIntent.eventDetailsRequest
  ) {
    console.log(
      `⚠️ [${requestType}] Все обязательные слоты собраны, но событий нет. Использую noResultsPrompt для предотвращения выдумывания событий.`
    );
    let prompt = getPromptTemplate(getNoResultsPrompt);
    if (!prompt || prompt.trim().length === 0) {
      console.warn(
        '⚠️ noResultsPrompt пустой, используем generalDialogPrompt с усиленными запретами'
      );
      prompt = getPromptTemplate(getGeneralDialogPrompt);
      // Добавляем усиленное предупреждение
      const strictWarning = `\n\n⚠️⚠️⚠️ КРИТИЧЕСКИ ВАЖНО: В КОНТЕКСТЕ НЕТ СПИСКА СОБЫТИЙ В ФОРМАТЕ JSON! ⚠️⚠️⚠️
НИ В КОЕМ СЛУЧАЕ НЕ ГЕНЕРИРУЙ ВЫДУМАННЫЕ СОБЫТИЯ! НЕ ПЕРЕЧИСЛЯЙ КОНКРЕТНЫЕ НАЗВАНИЯ МЕРОПРИЯТИЙ!
ЗАПРЕЩЕНО описывать события с нумерацией (1., 2., 3. и т.д.), если они не предоставлены в контексте!
ЗАПРЕЩЕНО создавать кнопки типа "Выбрать 1", "Выбрать 2" для несуществующих событий!
ЗАПРЕЩЕНО писать фразы вроде "Вот несколько вариантов...", так как вариантов не найдено!
ТВОЯ ЗАДАЧА - сообщить, что ничего не найдено, и предложить скорректировать запрос!\n\n`;
      prompt = strictWarning + prompt;
    }
    prompt = prompt.replace('{slotsInfo}', slotsInfo);
    console.log(
      `📝 [${requestType}] Используется промпт: noResultsPrompt (все слоты собраны, но событий нет)`
    );
    return withLanguageGuard(prompt);
  }

  // Сценарий 1: Общий диалог - используется в начале и после быстрого предложения
  let prompt = getPromptTemplate(getGeneralDialogPrompt);

  // КРИТИЧЕСКИ ВАЖНО: Добавляем усиленное предупреждение о запрете выдумывания событий
  // Это должно быть в самом начале промпта
  const noEventsWarning = `\n\n⚠️⚠️⚠️ КРИТИЧЕСКИ ВАЖНО: В КОНТЕКСТЕ НЕТ СПИСКА СОБЫТИЙ В ФОРМАТЕ JSON! ⚠️⚠️⚠️
НИ В КОЕМ СЛУЧАЕ НЕ ГЕНЕРИРУЙ ВЫДУМАННЫЕ СОБЫТИЯ! НЕ ПЕРЕЧИСЛЯЙ КОНКРЕТНЫЕ НАЗВАНИЯ МЕРОПРИЯТИЙ!
ЗАПРЕЩЕНО описывать события с нумерацией (1., 2., 3. и т.д.), если они не предоставлены в контексте!
ЗАПРЕЩЕНО создавать кнопки типа "Выбрать 1", "Выбрать 2", "Выбрать 3" для несуществующих событий!
ЗАПРЕЩЕНО упоминать конкретные даты, места, цены для несуществующих событий!
ЗАПРЕЩЕНО писать фразы вроде "Вот несколько вариантов...", "Есть несколько вариантов..." или обещать показать события, если их нет в контексте!
ЗАПРЕЩЕНЫ конкретные паттерны из прошлых ошибок: "Вот несколько концертов ...", "Для 25 ноября ... есть концерты ...", "Билет на 25 ноября", "Оформить билет", "Выберите дату и место", "Хотите увидеть другие варианты?".
Если события не предоставлены в контексте - ТОЛЬКО уточняй недостающие детали или сообщай, что ничего не найдено!\n\n`;
  prompt = noEventsWarning + prompt;

  prompt = prompt.replace('{slotsInfo}', slotsInfo);

  // Удаляем инструкцию о приветствии, если это не первое сообщение
  if (!isFirstMessage) {
    // Заменяем инструкцию о приветствии на инструкцию без приветствия
    prompt = prompt.replace(
      /КРИТИЧЕСКИ ВАЖНО: Приветствуй пользователя ТОЛЬКО если это первое сообщение в диалоге\. Если диалог уже начался \(в истории есть сообщения ассистента\), НЕ здоровайся снова - просто уточняй детали/,
      'ВАЖНО: Диалог уже начался. НЕ здоровайся снова - просто уточняй детали'
    );
  }

  console.log(
    `📝 [${requestType}] Используется промпт: generalDialogPrompt (первое сообщение: ${isFirstMessage})`
  );

  return withOfftopicRules(prompt);
}
