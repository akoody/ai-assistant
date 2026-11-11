import { TECHNICAL_REDIRECT_BUTTONS } from './technicalQuestionService.js';
import {
  containsNonCyrillic,
  hasForbiddenAssistantFeminineSelfReference,
} from './llm/assistantResponseUtils.js';

const BOT_ENTITY_PATTERN = '(?:бот|ботяра|ботяр[аеуы]|ботик|ботина)';
const HUMAN_ENTITY_PATTERN = '(?:человек|живой(?:\\s+человек)?|челик|чел)';
const IDENTITY_ADDRESS_TAIL_PATTERN =
  '(?:так(?:ой|ая|ие)|вообще|здесь|тут|молодой|родной|дружище|уважаемый|помощник|ассистент)';

function normalizeIdentityQuestionText(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+([!?.,:;])/gu, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function hashToIndex(value, modulo) {
  if (!modulo || modulo <= 0) return 0;
  const text = String(value ?? '');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash % modulo;
}

function normalizeIdentityFallbackText(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

function isIdentityFallbackTooClose(candidate = '', reference = '') {
  const left = normalizeIdentityFallbackText(candidate);
  const right = normalizeIdentityFallbackText(reference);
  if (!left || !right) return false;
  if (left === right) return true;

  const leftLead = left.split(/[.!?]+/u)[0]?.trim() || '';
  const rightLead = right.split(/[.!?]+/u)[0]?.trim() || '';
  if (leftLead && rightLead && leftLead === rightLead) return true;

  const leftWords = new Set(
    left
      .split(' ')
      .filter((word) => word.length >= 5)
      .map((word) => word.slice(0, 8))
  );
  const rightWords = new Set(
    right
      .split(' ')
      .filter((word) => word.length >= 5)
      .map((word) => word.slice(0, 8))
  );
  if (leftWords.size === 0 || rightWords.size === 0) return false;

  let intersection = 0;
  leftWords.forEach((word) => {
    if (rightWords.has(word)) intersection += 1;
  });

  return intersection / Math.min(leftWords.size, rightWords.size) >= 0.6;
}

function pickAssistantIdentityFallback(seed = '', excludeText = '') {
  const variants = [
    'Я виртуальный помощник Kassir.ru. Помогаю сузить афишу по жанру, настроению, дате или поводу.\n\nОт какого ориентира начнём?',
    'Я цифровой помощник Kassir.ru по афише и билетам. Могу быстро перевести общее желание куда-то выбраться в понятный подбор событий.\n\nЧто важнее сейчас, формат, настроение или жанр?',
    'Я виртуальный помощник Kassir.ru. Можно начать с простого желания: спокойно провести вечер, увидеть что-то новое или выбрать понятный формат досуга.\n\nКакой вариант вам ближе?',
    'Я виртуальный помощник Kassir.ru по афише. Когда есть хотя бы один ориентир, я быстрее отсекаю лишнее и оставляю подходящие события.\n\nС чего удобнее начать?',
    'Я цифровой помощник Kassir.ru. Помогаю искать события не только по названию, но и по настроению, формату или поводу.\n\nКакой ориентир взять первым?',
    'Я виртуальный помощник Kassir.ru по событиям и билетам. Давайте сначала поймём, нужен спокойный вечер, яркий выход или новый культурный опыт.\n\nЧто ближе сейчас?',
    'Я виртуальный помощник Kassir.ru. Если описать настроение или повод, я превращу это в понятный поиск по афише.\n\nЧто хочется устроить?',
    'Я цифровой помощник Kassir.ru для выбора досуга. Можно пойти от любимого жанра, даты, бюджета или общего настроения.\n\nС какого пункта начнём?',
    'Я виртуальный помощник Kassir.ru по афише. Хороший выбор начинается с простого ориентира, например формата вечера или желания увидеть что-то новое.\n\nКакой сценарий вам сейчас ближе?',
    'Я виртуальный помощник Kassir.ru. Помогаю быстро превратить общее настроение в конкретные события и билеты.\n\nЧто будем искать?',
  ];

  const candidates = variants.filter(
    (variant) => !isIdentityFallbackTooClose(variant, excludeText)
  );
  const pool = candidates.length > 0 ? candidates : variants;
  const randomIndex = Math.floor(Math.random() * pool.length);
  const mixedIndex = (hashToIndex(seed, pool.length) + randomIndex) % pool.length;
  return pool[mixedIndex] || pool[0];
}

export function isAssistantIdentityQuestion(text) {
  const normalized = normalizeIdentityQuestionText(text);
  if (!normalized) return false;

  if (
    new RegExp(`(?:${HUMAN_ENTITY_PATTERN})\\s+или\\s+(?:${BOT_ENTITY_PATTERN})`, 'u').test(
      normalized
    )
  )
    return true;
  if (
    new RegExp(`(?:${BOT_ENTITY_PATTERN})\\s+или\\s+(?:${HUMAN_ENTITY_PATTERN})`, 'u').test(
      normalized
    )
  )
    return true;
  if (
    new RegExp(
      `(?:вы|ты)\\s+(?:${BOT_ENTITY_PATTERN}|${HUMAN_ENTITY_PATTERN})\\b.*\\bили\\b.*\\b(?:${BOT_ENTITY_PATTERN}|${HUMAN_ENTITY_PATTERN})\\b`,
      'u'
    ).test(normalized)
  )
    return true;
  if (
    new RegExp(`\\b(?:это|тут)\\s+(?:${BOT_ENTITY_PATTERN}|${HUMAN_ENTITY_PATTERN})\\b`, 'u').test(
      normalized
    )
  )
    return true;
  if (
    new RegExp(
      `^(?:(?:а|ну|слушай|скажите|скажи)\\s+)*(?:(?:кто|кем)\\s+(?:ты|вы)|(?:ты|вы)\\s+(?:кто|кем))(?:\\s+${IDENTITY_ADDRESS_TAIL_PATTERN})*[!?.,]*$`,
      'u'
    ).test(normalized)
  )
    return true;
  if (
    /^(?:(?:а|ну|слушай|скажите|скажи)\s+)*(?:что\s+(?:ты|вы)\s+такое|(?:ты|вы)\s+что\s+такое)[!?.,]*$/u.test(
      normalized
    )
  )
    return true;
  if (/(вы|ты)\s+человек[!?.,]*$/u.test(normalized)) return true;
  if (new RegExp(`(?:вы|ты)\\s+${BOT_ENTITY_PATTERN}[!?.,]*$`, 'u').test(normalized)) return true;
  if (/(?:вы|ты)\s+жив(?:ой|ая)[!?.,]*$/u.test(normalized)) return true;
  if (/(?:с\s+вами|со\s+мной)\s+разговаривает\s+человек/u.test(normalized)) return true;
  if (
    new RegExp(
      `я\\s+с\\s+(?:бот(?:ом)?|ботяр(?:ой|ою)?|человек(?:ом)?|челик(?:ом)?)\\s+говорю`,
      'u'
    ).test(normalized)
  )
    return true;
  if (/(вы|ты)\s+настоящ(?:ий|ая)[!?.,]*$/u.test(normalized)) return true;
  if (/(вы|ты)\s+реальн(?:ый|ая)[!?.,]*$/u.test(normalized)) return true;

  return false;
}

export function buildAssistantIdentityFallbackResponse({ seed = '', excludeText = '' } = {}) {
  return {
    message: pickAssistantIdentityFallback(seed, excludeText),
    buttons: [...TECHNICAL_REDIRECT_BUTTONS],
    offer: null,
  };
}

export function isSafeAssistantIdentityText(text) {
  const value = String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е');
  if (!value) return false;

  // нельзя использовать слово бот.
  if (/(?<![A-Za-zА-Яа-яЁё0-9_])бот(?![A-Za-zА-Яа-яЁё0-9_])/u.test(value)) return false;

  // нельзя на ты.
  const forbiddenSecondPerson = [
    /(?<![A-Za-zА-Яа-яЁё0-9_])ты(?![A-Za-zА-Яа-яЁё0-9_])/u,
    /(?<![A-Za-zА-Яа-яЁё0-9_])тебе(?![A-Za-zА-Яа-яЁё0-9_])/u,
    /(?<![A-Za-zА-Яа-яЁё0-9_])тебя(?![A-Za-zА-Яа-яЁё0-9_])/u,
    /(?<![A-Za-zА-Яа-яЁё0-9_])тобой(?![A-Za-zА-Яа-яЁё0-9_])/u,
    /(?<![A-Za-zА-Яа-яЁё0-9_])твой(?![A-Za-zА-Яа-яЁё0-9_])/u,
    /(?<![A-Za-zА-Яа-яЁё0-9_])твоя(?![A-Za-zА-Яа-яЁё0-9_])/u,
    /(?<![A-Za-zА-Яа-яЁё0-9_])тво[её](?![A-Za-zА-Яа-яЁё0-9_])/u,
    /(?<![A-Za-zА-Яа-яЁё0-9_])твои(?![A-Za-zА-Яа-яЁё0-9_])/u,
  ];
  if (forbiddenSecondPerson.some((re) => re.test(value))) return false;

  // запрещаем любые попытки раскрыть реальный стек/модель/провайдера.
  const forbiddenTech = [
    /\bpython\b/u,
    /\bjava\b/u,
    /java\s*script|\bjs\b/u,
    /type\s*script|\bts\b/u,
    /\bnode\.?js\b|\bnodejs\b/u,
    /\breact\b|\bvue\b|\bangular\b/u,
    /\brust\b|\bgolang\b|\bgo\b/u,
    /\bphp\b|\bruby\b/u,
    /c\+\+|c#|csharp/u,
    /\bpostgres\b|\bpostgresql\b|\bmysql\b|\bmongodb\b|\bredis\b|\bkafka\b/u,
    /\bdocker\b|\bkubernetes\b|\bk8s\b/u,
    /\baws\b|\bgcp\b|\bazure\b/u,
    /\bopenai\b|\bchatgpt\b|\bgpt-?\d\b|\bllama\b|\bgemini\b/u,
    /написан\s+на|реализован\s+на|стек\s*:/u,
  ];
  if (forbiddenTech.some((re) => re.test(value))) return false;

  if (hasForbiddenAssistantFeminineSelfReference(value)) return false;

  // Должно быть тепло + 1 вопрос, чтобы вернуть к подбору.
  if (!/[?？]/u.test(value)) return false;

  // только кириллица и не должно быть запрещенных символов
  if (containsNonCyrillic(text)) return false;

  return true;
}
