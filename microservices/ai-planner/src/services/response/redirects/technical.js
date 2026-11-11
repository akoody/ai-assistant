import { hashToIndex } from '../textUtils.js';
import { requestAssistantMessage } from '../gatewayClient.js';
import { getTechnicalMetaRedirectPrompt } from '../../configService.js';
import {
  buildTechnicalRedirectResponse,
  isSafeTechnicalRedirectText,
  TECHNICAL_REDIRECT_BUTTONS,
} from '../../technicalQuestionService.js';

const TECHNICAL_META_INTENT_NAME = 'technical_meta_question';

const TECHNICAL_META_CONFIDENCE_THRESHOLD = 0.7;

const TECHNICAL_STYLE_VARIANTS = Object.freeze([
  {
    key: 'curator',
    label: 'культурный куратор',
    instruction:
      'Говорите как живой куратор афиши: легко, собранно, без оправданий и без технических штампов.',
  },
  {
    key: 'concise',
    label: 'лаконичный сервисный',
    instruction:
      'Дайте очень короткий, уверенный ответ в 2 предложениях. Сразу ведите к следующему полезному действию.',
  },
  {
    key: 'warm',
    label: 'тёплый навигатор',
    instruction:
      'Сделайте ответ мягким и дружелюбным, как у понимающего персонального помощника, но без сюсюканья и без повторяющихся заготовок.',
  },
  {
    key: 'polished',
    label: 'спокойный интеллигентный',
    instruction:
      'Сохраняйте культурный, уверенный тон и более гладкий ритм, будто это ответ хорошего консьержа.',
  },
  {
    key: 'brisk',
    label: 'живой быстрый',
    instruction:
      'Держите бодрый темп, меньше вводных слов, быстрее переходите к выбору мероприятия.',
  },
  {
    key: 'empathetic',
    label: 'понимающий ассистент',
    instruction:
      'Отвечайте как внимательный живой помощник, который уловил настроение пользователя. Избегайте тона интерфейса, call-центра и рекламных формул.',
  },
]);

const TECHNICAL_BANNED_OPENINGS = Object.freeze([
  'в технические подробности вдаваться не буду',
  'о внутреннем устройстве сейчас говорить не буду',
  'технические детали я не раскрываю',
  'подробности о модели я не обсуждаю',
  'на чем именно я реализован',
  'на чём именно я реализован',
]);

const TECHNICAL_RESPONSE_FRAMES = Object.freeze([
  {
    key: 'ml',
    instruction:
      'В первой части ответа мягко упомяните технологии машинного обучения и то, что они помогают понимать пожелания пользователя и подбирать события. Не копируйте одну и ту же формулировку.',
  },
  {
    key: 'ai_assistant',
    instruction:
      'В первой части ответа коротко подайте себя как виртуальный помощника, который помогает понимать интересы пользователя и подбирать события по афише, без деталей реализации и без сухого тона.',
  },
  {
    key: 'preference',
    instruction:
      'В первой части ответа сделайте акцент на том, что ИИ помогает вам понимать интересы пользователя и предлагать подходящие мероприятия.',
  },
  {
    key: 'helper',
    instruction:
      'В первой части ответа подчеркните практическую пользу, но через общий безопасный заход про ИИ или технологии машинного обучения, а не через фразы вроде "моя роль" или "я навигатор".',
  },
]);

function normalizeTechnicalRedirectText(text = '') {
  return String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^а-я0-9\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function pickTechnicalStyleVariant(seed = '', excludeKey = '') {
  const variants = TECHNICAL_STYLE_VARIANTS.filter((item) => item && item.key !== excludeKey);
  if (variants.length === 0) {
    return TECHNICAL_STYLE_VARIANTS[0];
  }
  return variants[hashToIndex(seed, variants.length)] || variants[0];
}

function pickTechnicalResponseFrame(seed = '', excludeKey = '') {
  const frames = TECHNICAL_RESPONSE_FRAMES.filter((item) => item && item.key !== excludeKey);
  if (frames.length === 0) {
    return TECHNICAL_RESPONSE_FRAMES[0];
  }
  return frames[hashToIndex(seed, frames.length)] || frames[0];
}

function extractTechnicalLeadWords(text = '', limit = 8) {
  return normalizeTechnicalRedirectText(text).split(' ').filter(Boolean).slice(0, limit).join(' ');
}

function areTechnicalRedirectsTooSimilar(candidate = '', reference = '') {
  const left = normalizeTechnicalRedirectText(candidate);
  const right = normalizeTechnicalRedirectText(reference);
  if (!left || !right) return false;
  if (left === right) return true;

  const leftLead = extractTechnicalLeadWords(left);
  const rightLead = extractTechnicalLeadWords(right);
  if (leftLead && rightLead && leftLead === rightLead) return true;

  const leftWords = new Set(
    left
      .split(' ')
      .filter((word) => word.length >= 4)
      .map((word) => word.slice(0, 7))
  );
  const rightWords = new Set(
    right
      .split(' ')
      .filter((word) => word.length >= 4)
      .map((word) => word.slice(0, 7))
  );
  if (leftWords.size === 0 || rightWords.size === 0) return false;

  let intersection = 0;
  leftWords.forEach((word) => {
    if (rightWords.has(word)) intersection += 1;
  });

  const overlap = intersection / Math.max(leftWords.size, rightWords.size);
  return overlap >= 0.72;
}

function hasBannedTechnicalOpening(text = '') {
  const normalized = normalizeTechnicalRedirectText(text);
  if (!normalized) return false;
  return TECHNICAL_BANNED_OPENINGS.some((opening) => normalized.startsWith(opening));
}

async function buildTechnicalRedirectResponseViaLlm({ userId, sessionId, userMessage, requestId }) {
  const prompt = getTechnicalMetaRedirectPrompt();
  const systemPrompt = String(prompt || '').trim();
  if (!systemPrompt) {
    return buildTechnicalRedirectResponse({ userId, sessionId, userMessage });
  }

  const styleSeed = `${userId}|${sessionId}|${requestId || ''}|${userMessage}|${Date.now()}`;
  const primaryStyle = pickTechnicalStyleVariant(`${styleSeed}|primary`);
  const repairStyle = pickTechnicalStyleVariant(`${styleSeed}|repair`, primaryStyle?.key);
  const primaryFrame = pickTechnicalResponseFrame(`${styleSeed}|frame-primary`);
  const repairFrame = pickTechnicalResponseFrame(`${styleSeed}|frame-repair`, primaryFrame?.key);
  const bannedOpeningsHint = TECHNICAL_BANNED_OPENINGS.map((item) => `"${item}"`).join(', ');

  const baseMessages = [
    {
      role: 'system',
      content:
        `${systemPrompt}\n\n` +
        'Дополнительная установка на этот ответ:\n' +
        `- Стиль подачи: ${primaryStyle.label}. ${primaryStyle.instruction}\n` +
        `- Смысловая рамка: ${primaryFrame.instruction}\n` +
        '- Тон всегда уважительный, спокойный и доброжелательный. Не обесценивай вопрос пользователя, не отвечай свысока и не используй фразы "меня это не интересует", "не моя тема", "это не важно".\n' +
        '- Первое предложение обязательно должно прямо обозначать отказ по техническому вопросу, но разными словами. Не используй двоеточие и не начинай почти каждый ответ с "С таким вопросом я не помогу".\n' +
        '- Ответ должен состоять строго из 2 или 3 коротких абзацев. Не дели отказ, пользу, переход и финальный вопрос на 4 абзаца.\n' +
        `- Не начинай ответ с таких фраз: ${bannedOpeningsHint}.\n` +
        '- Не отвечай "да" или "нет" на технический вопрос.\n' +
        '- Не повторяй термины из технического вопроса пользователя и не перефразируй их.\n' +
        '- Не давай определений в формате "<термин> — это ..." или "<тема> означает ...".\n' +
        '- Не выдумывай объяснения про внутреннюю реализацию, инструменты создания или работу команды разработки.\n' +
        '- Не используй фразы "мы используем", "мы сделали", "специальные инструменты" и подобные.\n' +
        '- Не звучи как интерфейс, call-центр или автоответчик. Ответ должен ощущаться как реплика понимающего ассистента.\n' +
        '- Ответ должен заметно отличаться по первой фразе и ритму от типовых технических редиректов.\n' +
        '- Вопрос в конце тоже делай живым и не однотипным.',
    },
    { role: 'user', content: String(userMessage || '').trim() || 'Технический вопрос.' },
  ];

  try {
    const normalized = await requestAssistantMessage(
      baseMessages,
      userId,
      sessionId,
      'technical_meta_redirect',
      1,
      0.7,
      requestId,
      220
    );

    const text = String(normalized?.text || '').trim();
    if (text && isSafeTechnicalRedirectText(text) && !hasBannedTechnicalOpening(text)) {
      return {
        message: text,
        buttons: [...TECHNICAL_REDIRECT_BUTTONS],
        offer: null,
      };
    }

    console.warn(
      `⚠️ [${userId}][${sessionId}] TECH_REDIRECT: первый ответ LLM не подошёл, запрашиваю перегенерацию`
    );

    const repairMessages = [
      {
        role: 'system',
        content:
          `${systemPrompt}\n\n` +
          'Исправьте ответ, если он нарушает ограничения. Верните только корректный JSON. ' +
          'Первое предложение должно прямо обозначать отказ по техническому вопросу, но без двоеточия и без повторения шаблона "С таким вопросом я не помогу". Не раскрывайте технические детали, не используйте слово "бот", обращайтесь только на "вы", завершите коротким вопросом по подбору мероприятий. Ответ должен быть строго в 2 или 3 коротких абзацах.\n' +
          '- Тон должен быть уважительным и доброжелательным. Нельзя писать свысока, раздраженно или безразлично.\n' +
          `- Используйте ДРУГОЙ стиль подачи: ${repairStyle.label}. ${repairStyle.instruction}\n` +
          `- Используйте ДРУГУЮ смысловую рамку: ${repairFrame.instruction}\n` +
          `- Не начинайте ответ с фраз: ${bannedOpeningsHint}.\n` +
          '- Не отвечайте "да" или "нет" на технический вопрос.\n' +
          '- Не повторяйте термины из технического вопроса пользователя и не перефразируйте их.\n' +
          '- Не давайте определений в формате "<термин> — это ..." или "<тема> означает ...".\n' +
          '- Не придумывайте объяснения про внутреннюю реализацию, специальные инструменты или команду разработки.\n' +
          '- Исключите фразы "мы используем", "мы сделали", "специальные инструменты" и близкие по смыслу.\n' +
          '- Не звучите как интерфейс, call-центр или автоответчик.\n' +
          '- Новый ответ должен заметно отличаться от предыдущего по первой фразе, ритму и последнему вопросу.',
      },
      { role: 'user', content: String(userMessage || '').trim() || 'Технический вопрос.' },
      ...(normalized?.raw ? [{ role: 'assistant', content: String(normalized.raw) }] : []),
      {
        role: 'user',
        content:
          'Сформулируйте ответ заново более естественно и без шаблонных фраз. ' +
          `Не повторяйте начало "${extractTechnicalLeadWords(text, 9)}". ` +
          'Нужен короткий живой редирект к подбору мероприятий.',
      },
    ];

    const repaired = await requestAssistantMessage(
      repairMessages,
      userId,
      sessionId,
      'technical_meta_redirect_repair',
      1,
      0.45,
      requestId,
      220
    );

    const repairedText = String(repaired?.text || '').trim();
    if (
      repairedText &&
      isSafeTechnicalRedirectText(repairedText) &&
      !hasBannedTechnicalOpening(repairedText) &&
      !areTechnicalRedirectsTooSimilar(repairedText, text)
    ) {
      return {
        message: repairedText,
        buttons: [...TECHNICAL_REDIRECT_BUTTONS],
        offer: null,
      };
    }

    console.warn(
      `⚠️ [${userId}][${sessionId}] TECH_REDIRECT: ответы LLM не прошли проверку, использую аварийный fallback`
    );
    return buildTechnicalRedirectResponse({ userId, sessionId, userMessage });
  } catch (error) {
    console.warn(
      `⚠️ [${userId}][${sessionId}] TECH_REDIRECT: ошибка при генерации через LLM, использую аварийный fallback`,
      error
    );
    return buildTechnicalRedirectResponse({ userId, sessionId, userMessage });
  }
}

export {
  TECHNICAL_META_INTENT_NAME,
  TECHNICAL_META_CONFIDENCE_THRESHOLD,
  buildTechnicalRedirectResponseViaLlm,
};
