import { getKnownDateValue } from '../slotUtils.js';
import {
  resolveAmbiguousGenreCategoryChoice,
  getAmbiguousGenreContextSlot,
} from '../categoryRouting.js';
import { inferClarificationTarget } from '../clarificationTarget.js';
import { requestAssistantMessage } from '../gatewayClient.js';
import { shouldUsePopularSelectionCategoryClarification } from './buttons.js';
import {
  getExpectedKnownClarificationContextScore,
  getKnownClarificationContextScore,
  resolveClarificationPlan,
} from './planning.js';
import { buildKnownCityClarificationFallbackResult } from './fallbacks.js';
import {
  isClarificationTextSpecificForTarget,
  areClarificationButtonsCompatible,
  normalizeClarificationButtonsForPlan,
  isClarificationCandidateAligned,
  shouldReplaceClarificationWithFallback,
  isSafeKnownCityClarificationText,
} from './validation.js';

async function buildKnownCityClarificationResponseViaLlm({
  userId,
  sessionId,
  userMessage,
  requestId,
  knownCity = '',
  slots = [],
  vagueRequestInfo = null,
  targetHint = '',
  originalText = '',
  originalButtons = [],
  history = [],
  userPreferences = null,
}) {
  const seed = `${userId}|${sessionId}|${userMessage}|${knownCity}`;
  const inferredTarget =
    targetHint || inferClarificationTarget({ buttons: originalButtons, text: originalText });
  const preferPopularSelectionCategories = shouldUsePopularSelectionCategoryClarification({
    userMessage,
    slots,
    knownCity,
  });
  const plan = resolveClarificationPlan({
    slots,
    vagueRequestInfo,
    seed,
    targetHint: inferredTarget,
    userPreferences,
    preferPopularSelectionCategories,
  });
  const knownDate = getKnownDateValue(slots);
  const ambiguousGenre =
    plan.target === 'ambiguous_category'
      ? String(
          resolveAmbiguousGenreCategoryChoice({ slots, userMessage: '' })?.genre ||
            getAmbiguousGenreContextSlot(slots)?.value ||
            ''
        ).trim()
      : '';
  const safeKnownDateForValidation = plan.target === 'date' ? '' : knownDate;
  const fallback = buildKnownCityClarificationFallbackResult({
    originalText,
    originalButtons,
    buttons: plan.buttons,
    target: plan.target,
    knownEventType: plan.knownEventType,
    ambiguousGenre,
    userPreferences,
    slots,
    knownCity,
    knownDate,
    history,
    preferPopularSelectionCategories,
    clarificationSeed: seed,
  });
  const safeCity = knownCity || 'текущий город';
  const safeEventType = plan.knownEventType || 'мероприятия';
  const buttonsJson = JSON.stringify(plan.buttons);
  const lastAssistantText = Array.isArray(history)
    ? [...history].reverse().find((item) => item?.role === 'assistant' && item?.content)?.content ||
      ''
    : '';
  const hasKnownEventType = Boolean(plan.knownEventType);

  const focusInstruction = (() => {
    if (plan.target === 'ambiguous_category') {
      return ambiguousGenre
        ? `Пользователь назвал жанр "${ambiguousGenre}", но он встречается в нескольких категориях. Спроси только о том, какая категория для этого жанра ближе. В вопросе явно сохрани смысл жанра "${ambiguousGenre}" и выбора между категориями. Не сужай варианты до двух собственных формулировок и не подменяй кнопки своими интерпретациями вроде "театрализованное представление" или "музыкальный концерт".`
        : 'Спроси только о том, какая категория мероприятия ближе пользователю. Не задавай слишком общий вопрос.';
    }
    if (plan.target === 'genre') {
      return hasKnownEventType
        ? `Тип мероприятия уже известен: "${safeEventType}". Спроси только о предпочитаемом жанре и явно назови жанр или тип мероприятия в вопросе. Нельзя заменять это общим вопросом вроде "Что именно вас интересует?".`
        : 'Спроси только о предпочитаемом жанре мероприятия и явно назови жанр в вопросе. Нельзя заменять это общим вопросом вроде "Что именно вас интересует?".';
    }
    if (plan.target === 'budget') {
      return hasKnownEventType
        ? `Тип мероприятия уже известен: "${safeEventType}". Спроси только о бюджете на билет.`
        : 'Спроси только о максимальном бюджете на билет или мероприятие.';
    }
    if (plan.target === 'time') {
      return hasKnownEventType
        ? `Тип мероприятия уже известен: "${safeEventType}". Спроси только о предпочтительном времени начала.`
        : 'Спроси только о предпочтительном времени начала мероприятия.';
    }
    if (plan.target === 'date') {
      return hasKnownEventType
        ? `Тип мероприятия уже известен: "${safeEventType}". Спроси только о дате или периоде посещения.`
        : 'Спроси только о дате или периоде посещения мероприятия.';
    }
    if (preferPopularSelectionCategories) {
      return 'Спроси только о категории популярных событий. Вопрос должен явно предлагать выбрать направление популярной афиши, а не запускать поиск сразу.';
    }
    return 'Спроси только о категории мероприятия. Не задавай слишком общий вопрос вроде "Что именно вас интересует?": должно быть ясно, что речь о категории или формате досуга.';
  })();

  const dateHint = (() => {
    if (plan.target === 'date') {
      if (knownDate) {
        return `Сейчас уже есть дата/период: "${knownDate}", но пользователь хочет уточнить или изменить её. Спроси только о новой дате или периоде, не цепляйся за старое значение.`;
      }
      return 'Пользователь хочет уточнить дату. Спроси только о дате или периоде посещения.';
    }

    if (knownDate) {
      return `Уже учтена дата/период: "${knownDate}". Ненавязчиво сохрани этот контекст в вопросе. Не сужай этот период до конкретных чисел и не придумывай диапазон дней, если пользователь его не называл.`;
    }

    return 'Дата не указана, но сейчас не спрашивай её: сначала уточни текущую целевую деталь.';
  })();

  const knownContextInstruction =
    plan.target === 'date'
      ? '- Если известен город, можешь естественно упомянуть его, но не обязан повторять старую дату.\n'
      : '- Если известны город и дата/период, естественно упомяни их в тексте ответа.\n';

  const historyHint = lastAssistantText
    ? `Последняя реплика ассистента в этом диалоге: "${String(lastAssistantText).replace(/\s+/g, ' ').trim()}". НЕ повторяй её лексику, первые слова, ритм и конструкцию предложения.`
    : 'Сформулируй реплику свежо и не опирайся на один и тот же шаблон.';

  const systemPrompt =
    `Ты ассистент Kassir.ru по подбору мероприятий.\n` +
    `Город уже известен: "${safeCity}".\n` +
    `${dateHint}\n` +
    `${focusInstruction}\n` +
    `${historyHint}\n\n` +
    `КРИТИЧЕСКИ ВАЖНО:\n` +
    `- ЗАПРЕЩЕНО спрашивать город, предлагать выбор города или писать "город уже учтён".\n` +
    `- ЗАПРЕЩЕНО спрашивать район, округ, метро, часть города, место встречи или любую другую географию ниже уровня города.\n` +
    `- ЗАПРЕЩЕНО писать, что ничего не найдено, что поиск не дал результатов или что нужно менять несколько параметров сразу.\n` +
    `- ЗАПРЕЩЕНО перечислять ранее показанные события, цены, площадки или пересказывать прошлую подборку.\n` +
    knownContextInstruction +
    `- Пиши живо и по-человечески, без служебных формулировок вроде "учитываю дату", "город уже известен", "продолжаем подбор".\n` +
    `- Пиши литературным русским языком: проверяй падежи, управление и обращение на "вы". Нельзя: "Какую дату интересует?", "чем именно вас интересует", "Что тебя больше интересует?", "по интересующему вас направлению".\n` +
    `- Правильный тип формулировок: "Какая дата вас интересует?", "Что именно вас интересует?", "Что вам больше интересно?", "Какой жанр вам ближе?".\n` +
    `- Если упоминаешь уже известную дату/период, используй корректный предлог и падеж: "в следующем месяце", "в мае", "на выходных". Нельзя механически вставлять сырой слот вроде "следующий месяц" без предлога.\n` +
    `- Если известная дата/период задана месяцем или широким периодом, запрещено заменять её конкретными числами внутри периода.\n` +
    `- Не используй один и тот же заход в духе "Подберу...", "Смотрю..." или "Чтобы сузить варианты..." как постоянный шаблон.\n` +
    `- Можно сохранить смысл прошлой реплики, но выражай его новыми словами.\n` +
    `- Не используй кавычки вокруг типа мероприятия и не строй фразы вроде "для концерты".\n` +
    (plan.target === 'ambiguous_category'
      ? `- Для неоднозначного жанра не перечисляй в тексте свои версии вариантов и не своди выбор к двум пунктам. Кнопки уже заданы отдельно; текст должен оставаться нейтральным и коротким.\n`
      : '') +
    `- 1 короткий вопрос, максимум 2 предложения.\n` +
    `- Не перечисляй кнопки и варианты выбора в тексте: они уже будут отдельно в "buttons".\n` +
    `- Только русский язык (кириллица), без латиницы и служебного текста.\n` +
    `- Верни строго JSON: {"text":"...","buttons":[...]}.\n` +
    `- Используй ТОЛЬКО эти кнопки: ${buttonsJson}\n`;

  const baseUserMessage = String(userMessage || '').trim() || 'Подбери мне мероприятие.';
  let messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: baseUserMessage },
  ];
  let bestCandidate = null;
  const requiredContextScore = getExpectedKnownClarificationContextScore({
    knownCity,
    knownDate: safeKnownDateForValidation,
    target: plan.target,
  });

  try {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const normalized = await requestAssistantMessage(
        messages,
        userId,
        sessionId,
        'clarification_city_known_fallback',
        attempt,
        attempt === 1 ? 0.85 : 0.65,
        requestId,
        220
      );

      const text = String(normalized?.text || '').trim();
      const resolvedButtons = normalizeClarificationButtonsForPlan(
        Array.isArray(normalized?.buttons) && normalized.buttons.length > 0
          ? normalized.buttons
          : plan.buttons,
        plan.buttons
      );
      const contextScore = getKnownClarificationContextScore(text, {
        knownCity,
        knownDate: safeKnownDateForValidation,
        target: plan.target,
      });

      if (
        plan.target === 'ambiguous_category' &&
        normalized?.parsedFromJson &&
        text &&
        isSafeKnownCityClarificationText(text, {
          knownCity: safeCity,
          knownDate: safeKnownDateForValidation,
        }) &&
        areClarificationButtonsCompatible(resolvedButtons, plan.buttons)
      ) {
        return {
          message: text,
          buttons: resolvedButtons.length > 0 ? resolvedButtons : [...plan.buttons],
          offer: null,
        };
      }

      if (
        normalized?.parsedFromJson &&
        isSafeKnownCityClarificationText(text, {
          knownCity: safeCity,
          knownDate: safeKnownDateForValidation,
        }) &&
        isClarificationTextSpecificForTarget(text, {
          target: plan.target,
          knownEventType: plan.knownEventType,
          ambiguousGenre,
        }) &&
        isClarificationCandidateAligned({
          text,
          buttons: resolvedButtons,
          target: plan.target,
          expectedButtons: plan.buttons,
        })
      ) {
        if (!bestCandidate || contextScore > bestCandidate.contextScore) {
          bestCandidate = {
            message: text,
            buttons: resolvedButtons,
            offer: null,
            contextScore,
          };
        }
      }

      if (
        normalized?.parsedFromJson &&
        isSafeKnownCityClarificationText(text, {
          knownCity: safeCity,
          knownDate: safeKnownDateForValidation,
        }) &&
        isClarificationTextSpecificForTarget(text, {
          target: plan.target,
          knownEventType: plan.knownEventType,
          ambiguousGenre,
        }) &&
        isClarificationCandidateAligned({
          text,
          buttons: resolvedButtons,
          target: plan.target,
          expectedButtons: plan.buttons,
        }) &&
        contextScore >= requiredContextScore &&
        !shouldReplaceClarificationWithFallback(text, history, {
          knownCity: safeCity,
          knownDate: safeKnownDateForValidation,
        })
      ) {
        return {
          message: text,
          buttons: resolvedButtons,
          offer: null,
        };
      }

      if (attempt < maxAttempts) {
        const correctionInstruction =
          `Ответ не подходит: он либо слишком похож на предыдущую реплику ассистента, либо звучит шаблонно, либо неестественно проговаривает уже известные параметры. ` +
          `Перепиши ответ свежо и коротко: естественно упомяни город${knownDate && plan.target !== 'date' ? ' и дату/период' : ''}, не спрашивай лишние параметры заново, не используй фразы "учитываю дату", "город уже известен", "продолжаем подбор", "Чтобы сузить варианты". ` +
          (knownDate
            ? `Если упоминаешь известную дату/период "${knownDate}", не сужай её до конкретных чисел и не добавляй диапазон дней. `
            : '') +
          `Не повторяй лексику и синтаксис предыдущей реплики ассистента. ` +
          `${plan.target === 'ambiguous_category' ? 'Не своди выбор к двум своим формулировкам и не подменяй кнопки текстом вроде "театрализованное представление" или "музыкальный концерт". ' : ''}` +
          `Сохрани тот же смысл уточнения, не меняй вопрос с ${plan.target === 'ambiguous_category' ? `выбора категории для жанра "${ambiguousGenre || 'этого жанра'}"` : plan.target === 'genre' ? 'жанра' : plan.target === 'budget' ? 'бюджета' : plan.target === 'time' ? 'времени' : plan.target === 'date' ? 'даты' : 'категории'} на другую тему. ` +
          `Верни 1 короткий уточняющий вопрос на русском и кнопки только ${buttonsJson}.`;
        messages = [
          ...messages,
          {
            role: 'assistant',
            content: JSON.stringify({ text: text || '', buttons: normalized?.buttons || [] }),
          },
          { role: 'user', content: correctionInstruction },
        ];
      }
    }
  } catch (error) {
    console.warn(
      `⚠️ [${userId}][${sessionId}] CLARIFICATION_CITY_KNOWN_FALLBACK: ошибка при генерации через LLM, использую fallback`,
      error
    );
  }

  if (bestCandidate && bestCandidate.contextScore >= requiredContextScore) {
    return {
      message: bestCandidate.message,
      buttons: bestCandidate.buttons,
      offer: null,
    };
  }

  return fallback;
}

export { buildKnownCityClarificationResponseViaLlm };
