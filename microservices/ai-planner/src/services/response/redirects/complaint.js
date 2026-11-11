import { hashToIndex, normalizeComplaintText } from '../textUtils.js';
import {
  containsNonCyrillic,
  containsAwkwardRussianPhrasing,
  hasForbiddenAssistantFeminineSelfReference,
} from '../../llm/assistantResponseUtils.js';

const COMPLAINT_STYLE_VARIANTS = Object.freeze([
  {
    key: 'warm',
    label: 'тёплый и собранный',
    instruction:
      'Звучите по-человечески, мягко и уверенно. В ответе должно чувствоваться, что вам не все равно и вы хотите исправить впечатление.',
  },
  {
    key: 'brisk',
    label: 'живой и быстрый',
    instruction:
      'Переходите к сути без лишних вводных, но сохраняйте участие и естественный ритм живого диалога.',
  },
  {
    key: 'curator',
    label: 'деликатный куратор',
    instruction:
      'Говорите как внимательный культурный помощник: спокойно, уважительно и без однотипных клише.',
  },
  {
    key: 'empathetic',
    label: 'вовлечённый и тактичный',
    instruction:
      'Сначала деликатно признайте неудачный опыт пользователя, затем уверенно ведите к следующему шагу без сухих служебных фраз.',
  },
]);

const COMPLAINT_BANNED_OPENINGS = Object.freeze([
  'жаль, что прошлый подбор не попал в ожидания',
  'понял',
  'спасибо, учту',
  'давайте попробуем новый подбор',
  'напишите, пожалуйста',
]);

function pickComplaintStyleVariant(seed = '', excludeKey = '') {
  const variants = COMPLAINT_STYLE_VARIANTS.filter((item) => item && item.key !== excludeKey);
  if (variants.length === 0) {
    return COMPLAINT_STYLE_VARIANTS[0];
  }
  return variants[hashToIndex(seed, variants.length)] || variants[0];
}

function hasBannedComplaintOpening(text = '') {
  const normalized = normalizeComplaintText(text);
  if (!normalized) return false;
  return COMPLAINT_BANNED_OPENINGS.some((opening) => normalized.startsWith(opening));
}

function isComplaintFlowReplyAligned(text = '', replyKind = '') {
  const normalized = normalizeComplaintText(text);
  if (!normalized) return false;

  if (replyKind === 'complaint_start') {
    const asksAboutReason =
      /что\s+именно\s+не\s+подош/u.test(normalized) ||
      /что\s+именно\s+не\s+понрав/u.test(normalized) ||
      /что\s+именно\s+не\s+заш/u.test(normalized) ||
      /какой\s+именно\s+(?:момент|аспект)\s+(?:не\s+подош|смутил|не\s+понрав|не\s+заш)/u.test(
        normalized
      ) ||
      /что\s+именно\s+(?:вас\s+)?смутил/u.test(normalized) ||
      /что\s+именно\s+(?:вас\s+)?смущал/u.test(normalized) ||
      /что\s+именно\s+(?:вас\s+)?не\s+устроил/u.test(normalized) ||
      /что\s+именно\s+смутил/u.test(normalized) ||
      /что\s+именно\s+оказал(?:ось|ся)\s+не\s+так/u.test(normalized) ||
      /чем\s+(?:именно|конкретно)\s+(?:не\s+подош|не\s+заш|смутил|смутило|не\s+устроил|не\s+понрав)/u.test(
        normalized
      ) ||
      /что\s+конкретно\s+(?:вас\s+)?(?:расстроил|расстроило|смущал|смущало)/u.test(normalized) ||
      /что\s+(?:вас\s+)?(?:расстроил|расстроило|смущал|смущало)/u.test(normalized) ||
      /в\s+чем(?:\s+именно|\s+конкретно)?\s+(?:проблема|дело|загвоздка)/u.test(normalized) ||
      /в\s+чем\s+была\s+проблема/u.test(normalized) ||
      /из(?:-|\s)?за\s+чего\s+(?:не\s+заш|не\s+подош|не\s+понрав)/u.test(normalized) ||
      /что\s+смутил/u.test(normalized) ||
      /что\s+было\s+не\s+так/u.test(normalized) ||
      /что\s+именно\s+оказал/u.test(normalized) ||
      /это\s+из(?:-|\s)?за\s+(?:жанра|цены|формата)/u.test(normalized) ||
      /не\s+подош(?:ел|ли)\s+(?:жанр|цена)/u.test(normalized) ||
      /жанр(?:\s+или|\s*,\s*|\s+\/\s*)цена/u.test(normalized);
    const driftsIntoNewSuggestions =
      /как\s+насчет/u.test(normalized) ||
      /могу\s+предлож/u.test(normalized) ||
      /предлагаю/u.test(normalized) ||
      /давайте\s+попробуем\s+найти\s+что/u.test(normalized) ||
      /какой(?:-|\s)?то\s+конкретный\s+жанр/u.test(normalized) ||
      /вы\s+ищете\s+что(?:-|\s)?то/u.test(normalized) ||
      /вам\s+нужен\s+другой\s+жанр/u.test(normalized) ||
      /интересует\s+какой(?:-|\s)?то\s+конкретный\s+жанр/u.test(normalized) ||
      /комеди/u.test(normalized) ||
      /музыкальн(?:ого|ых|ые|ым)\s+шоу/u.test(normalized);
    const praisesRejectedOptions =
      /(?:отличн|хорош|интересн|сильн)[а-я\s]{0,24}(?:вариант|варианты|событи|мероприяти)/u.test(
        normalized
      );

    return asksAboutReason && !driftsIntoNewSuggestions && !praisesRejectedOptions;
  }

  return true;
}

function isSafeComplaintFlowText(text = '', { replyKind = '' } = {}) {
  const value = String(text || '').trim();
  if (!value) return false;
  if (value.length > 340) return false;
  if (containsNonCyrillic(value)) return false;
  if (containsAwkwardRussianPhrasing(value)) return false;
  if (hasForbiddenAssistantFeminineSelfReference(value)) return false;

  const normalized = normalizeComplaintText(value);
  if (!normalized) return false;
  if (
    /(?<![A-Za-zА-Яа-яЁё0-9_])бот(?![A-Za-zА-Яа-яЁё0-9_])|(?<![A-Za-zА-Яа-яЁё0-9_])openai(?![A-Za-zА-Яа-яЁё0-9_])|(?<![A-Za-zА-Яа-яЁё0-9_])chatgpt(?![A-Za-zА-Яа-яЁё0-9_])|(?<![A-Za-zА-Яа-яЁё0-9_])gpt(?![A-Za-zА-Яа-яЁё0-9_])|(?<![A-Za-zА-Яа-яЁё0-9_])llm(?![A-Za-zА-Яа-яЁё0-9_])|(?<![A-Za-zА-Яа-яЁё0-9_])prompt(?![A-Za-zА-Яа-яЁё0-9_])/u.test(
      normalized
    )
  )
    return false;
  if (
    /(?<![A-Za-zА-Яа-яЁё0-9_])не удалось сформировать ответ(?![A-Za-zА-Яа-яЁё0-9_])/u.test(
      normalized
    )
  )
    return false;
  if (hasBannedComplaintOpening(value)) return false;
  if (!isComplaintFlowReplyAligned(value, replyKind)) return false;

  return true;
}

export { COMPLAINT_BANNED_OPENINGS, pickComplaintStyleVariant, isSafeComplaintFlowText };
