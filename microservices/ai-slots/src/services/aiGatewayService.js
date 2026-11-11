import { getAiGatewayApiKey, getAiGatewayUrl, getSlotExtractionPrompt } from './configService.js';
import { getSlots } from './slotsService.js';

export async function callAiGateway(
  messages,
  temperature = null,
  requestType = 'slots-extraction'
) {
  try {
    const gatewayUrl = getAiGatewayUrl();
    const apiKey = getAiGatewayApiKey();

    const requestBody = {
      messages,
      type: requestType,
    };

    if (temperature !== null) {
      requestBody.temperature = temperature;
    }

    const response = await fetch(`${gatewayUrl}/api/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(
        `AI Gateway ошибка: ${response.status} - ${error.message || response.statusText}`
      );
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Ошибка при вызове AI Gateway:', error);
    throw error;
  }
}

export async function extractSlotsFromText(text) {
  // Получаем слоты и промпт из конфигурации
  const slots = getSlots();
  const basePrompt = getSlotExtractionPrompt();

  const slotsDescriptions = slots.map((slot) => `- ${slot.name}: ${slot.description}`).join('\n');

  // Формируем финальный промпт с подстановкой описаний слотов
  const systemPrompt = basePrompt.replace('{SLOTS_DESCRIPTIONS}', slotsDescriptions);

  // КРИТИЧЕСКИ ВАЖНО: форсим верхнеуровневый JSON-ОБЪЕКТ, иначе при ответе массивом
  // intents (включая off_topic) теряются при парсинге/нормализации.
  const strictEnvelope =
    `‼️ КРИТИЧЕСКИ ВАЖНО: верни строго JSON-ОБЪЕКТ (НЕ массив) следующего вида:\n` +
    `{"slots":[{"name":"...","value":"...","confidence":0.0,"isNegative":false,"preferencePolarity":"positive"}],"intents":[{"name":"...","confidence":0.0}]}\n` +
    `Любой верхнеуровневый массив — НЕКОРРЕКТЕН.\n` +
    `КРИТИЧЕСКОЕ ПРАВИЛО ПОЛЯРНОСТИ ПРЕДПОЧТЕНИЙ: для вкусовых слотов (жанр, жанр_музыки, исполнитель, тип_мероприятия), когда пользователь выражает отношение "нравится / люблю / хочу такое" или "не нравится / не люблю / не хочу / избегаю", ОБЯЗАТЕЛЬНО укажи полярность в самом слоте.\n` +
    `Если отношение положительное, верни "isNegative": false и по возможности "preferencePolarity": "positive". Если отношение отрицательное, верни "isNegative": true и "preferencePolarity": "negative". Не оставляй полярность на догадку эвристике, если смысл понятен из фразы пользователя.\n` +
    `КРИТИЧЕСКОЕ ПРАВИЛО ИНТЕНТОВ: расплывчатые досуговые запросы ("хочу что-нибудь интересное", "хочу куда-нибудь сходить", "чем заняться", "куда выбраться") — это recommendations_request, НЕ off_topic.\n` +
    `КРИТИЧЕСКОЕ ПРАВИЛО ИНТЕНТОВ: вопросы про курсы валют/финансы ("курс доллара", "курс евро", "биткоин", "акции", "ипотека", "кредит", "налоги") — это off_topic, НЕ recommendations_request.\n` +
    `КРИТИЧЕСКОЕ РАЗДЕЛЕНИЕ НЕГАТИВНЫХ СЦЕНАРИЕВ:\n` +
    `- Обычный off_topic: вопрос не про мероприятия/билеты и не про прошлую выдачу, и не является критикой ассистента.\n` +
    `- assistant_criticism: пользователь ругает именно ассистента или его работу без явной ссылки на конкретный прошлый вариант ("ты плохо подбираешь", "подбираешь какую-то фигню", "ты бесполезный"). Это НЕ off_topic и НЕ negative_event_feedback.\n` +
    `- recommendation_complaint: пользователь жалуется на прошлую выдачу/подбор/рекомендации целиком ("в прошлый раз ты подобрал мимо", "предыдущая подборка была так себе", "подбор не попал в ожидания"), даже если конкретное событие не названо. Это НЕ off_topic.\n` +
    `- Для assistant_criticism по возможности добавляй в intent поля criticismType, intensity и replyStyleHint.\n` +
    `  * criticismType: "tone_style" | "competence" | "trust" | "hostility" | "generic"\n` +
    `  * intensity: "low" | "medium" | "high"\n` +
    `  * replyStyleHint: "calmer" | "direct" | "grounded" | "deescalating" | "neutral"\n` +
    `  * Примеры: "ты мне не нравишься" -> assistant_criticism + criticismType="generic"; "мне не нравится твой тон" -> criticismType="tone_style"; "ты бесполезный" -> criticismType="competence" или "hostility" по тону; "я тебе не доверяю" -> criticismType="trust".\n` +
    `- Для recommendation_complaint по возможности добавляй в intent поля complaintType и intensity.\n` +
    `  * complaintType: "genre" | "price" | "relevance" | "location" | "time" | "generic"\n` +
    `  * intensity: "low" | "medium" | "high"\n` +
    `  * Примеры: "слишком дорого" -> complaintType="price"; "не тот жанр" -> complaintType="genre"; "совсем мимо" -> complaintType="relevance"; "слишком далеко" -> complaintType="location".\n` +
    `КРИТИЧЕСКОЕ ПРАВИЛО ИНТЕНТОВ: негативный отзыв о ранее обсужденном событии ("не понравилось", "не зашло", "не подошло") — это negative_event_feedback, НЕ positive_feedback и НЕ off_topic.\n` +
    `КРИТИЧЕСКОЕ УТОЧНЕНИЕ ДЛЯ negative_event_feedback: добавляй его ТОЛЬКО если есть явная ссылка на ранее предложенное событие/вариант ("этот вариант", "предыдущий подбор", "тот спектакль", название события, номер варианта).\n` +
    `КРИТИЧЕСКОЕ УТОЧНЕНИЕ ДЛЯ recommendation_complaint: используй этот intent, когда есть негатив к предыдущей выдаче или подбору, но нет точной привязки к одному конкретному событию.\n` +
    `Фразы про текущее состояние пользователя ("я злой", "мне грустно", "хочу успокоиться") и запросы "предложи/подбери/покажи" без ссылки на прошлый вариант — это recommendations_request (и при необходимости слот "настроение"), НЕ negative_event_feedback.\n` +
    `КРИТИЧЕСКОЕ ПРАВИЛО ГОРОДА/ИСПОЛНИТЕЛЯ: фразы вида "в <городе>", "на <город>", "из <города>" — это слот "город", НИКОГДА не "исполнитель".\n` +
    `КРИТИЧЕСКОЕ ПРАВИЛО СЛОТА "исполнитель": НЕ извлекай "исполнитель" из бюджетных/ценовых формулировок (например "за 1000р", "до 3000", "от 1500"), жанров (например "рок", "рэп", "джаз") и категорий (например "концерты", "театры", "выставки").\n` +
    `Фразы-ссылки на сохранённые предпочтения ("моего любимого жанра", "по моим предпочтениям", "по моему вкусу", "то, что мне нравится", "что я люблю") тоже НИКОГДА не являются "исполнитель": это обращение к preference_memory_reference.\n` +
    `КРИТИЧЕСКОЕ ПРАВИЛО ОДНОСЛОВНЫХ ИМЕН: одиночные имена артистов, групп, композиторов или авторов ("Вивальди", "Чайковский", "Баста", "Maneskin") — это запрос в домене афиши, НЕ off_topic; верни recommendations_request и слот "исполнитель" или, если тип неясен, "поисковый_запрос".\n` +
    `КРИТИЧЕСКОЕ ПРАВИЛО ДАТЫ ПРОТИВ ИСПОЛНИТЕЛЯ: временные формулировки ("на следующих выходных", "в выходные", "на следующей неделе", "в субботу", "вечером", "в 19:00", "через неделю", "через месяц", "через год", "через 2 недели") — это слот даты/времени, НИКОГДА не "исполнитель".\n` +
    `Пример: "Хочу на следующих выходных на какой-нибудь спектакль" -> {"name":"тип_мероприятия","value":"театры"} + {"name":"дата_события","value":"следующие выходные"} и НЕТ слота "исполнитель".\n` +
    `Пример: "Реп концерт через месяц" -> {"name":"жанр_музыки","value":"рэп"} + {"name":"тип_мероприятия","value":"концерты"} + {"name":"дата_события","value":"через месяц"} и НЕТ слота "исполнитель".\n` +
    `Пример: "Концерт моего любимого жанра" -> {"name":"тип_мероприятия","value":"концерты"} + intent "preference_memory_reference" и НЕТ слота "исполнитель".\n` +
    `КРИТИЧЕСКОЕ ПРАВИЛО ДЕТСКОГО ВОЗРАСТА: если пользователь ищет детские мероприятия и указывает возраст в любой форме ("6+", "6 плюс", "6 лет", "от 6 лет", "с 6 лет", "старше 6 лет", "до 6 лет", "по 6 лет", "шестилетний"), ОБЯЗАТЕЛЬНО верни слот {"name":"возраст_ребенка","value":"<число>"} вместе с {"name":"возрастное_ограничение","value":"дети"}. Значение возраста — только число без плюса и без слова "лет".\n` +
    `Пример: "Представления для детей 6+" -> {"name":"возрастное_ограничение","value":"дети"} + {"name":"возраст_ребенка","value":"6"}.\n` +
    `Возрастные фрагменты вроде "6+", "6+, можно 4 года", "от 6 лет", "до 6 лет" НИКОГДА не являются "исполнитель", "артист", "название_мероприятия" или "поисковый_запрос".\n` +
    `КРИТИЧЕСКОЕ ПРАВИЛО СЛОТА "поисковый_запрос": НЕ заполняй его словами родства/контекста/возраста/местоимений ("с отцом", "с мамой", "с родителями", "ему 56", "ей 40", "ему", "ей", "нам", "куда-нибудь", "что-нибудь").\n` +
    `Фразы-ссылки на сохранённые предпочтения ("из любимого", "по моим предпочтениям", "по моему вкусу", "то, что мне нравится", "покажи то, что я люблю", "на мои любимые жанры") тоже НЕЛЬЗЯ превращать в слот "поисковый_запрос".\n` +
    `Если после извлечения профильных слотов остаются только такие шумовые или memory-reference слова, НЕ добавляй слот "поисковый_запрос".\n` +
    `КРИТИЧЕСКОЕ ПРАВИЛО ДЛЯ ССЫЛОК НА ПАМЯТЬ: фразы вроде "мои любимые жанры", "свои любимые жанры", "мой жанр", "мои жанры", "то, что мне нравится", "по моим предпочтениям" НЕ являются буквальным значением слота жанра.\n` +
    `В таких случаях НЕЛЬЗЯ возвращать слот жанра со значением "любимые", "мои", "свои", "предпочтения" и т.п. И НЕЛЬЗЯ возвращать "поисковый_запрос" со значениями "из любимого" или "по моим предпочтениям". Если конкретные жанры в тексте не названы, оставь слот жанра пустым и извлеки только реально названные профильные слоты, например "тип_мероприятия=театры".\n` +
    `КРИТИЧЕСКОЕ ПРАВИЛО ИНТЕНТА ПАМЯТИ: если пользователь явно ссылается на сохранённые вкусы/предпочтения ("мои любимые жанры", "свои любимые жанры", "то, что мне нравится", "по моим предпочтениям"), ОБЯЗАТЕЛЬНО добавь intent "preference_memory_reference". Если понятен тип памяти, добавь поле "memoryType": "genre" | "taste" | "budget" | "general".\n` +
    `Пример: "Найди что-то из любимого" -> intent "recommendations_request" + intent "preference_memory_reference", БЕЗ слота "поисковый_запрос".\n` +
    `КРИТИЧЕСКОЕ ПРАВИЛО СМЕНЫ ДАТЫ: если пользователь снимает старую дату или разрешает любую новую ("не хочу 21 апреля", "любая дата", "по дате не важно"), ОБЯЗАТЕЛЬНО отрази это в самих слотах даты. Старую отвергнутую дату верни как слот "дата_события" с "isNegative": true. Сброс фильтра по дате верни как слот {"name":"дата_события","value":"любая"} и добавь intent "change_date". Не оставляй эту семантику на внешние эвристики.\n` +
    `КРИТИЧЕСКОЕ ПРАВИЛО РАЗГОВОРНОГО ЗАПРОСА: "куда сходить поорать/проораться/оторваться/выпустить пар" = настроение "энергичный"/"веселье"; НЕ преобразовывай это в "погулять" и НЕ извлекай "контекст_события=свидание" без явных романтических маркеров.\n` +
    `Если в тексте только бюджет/жанр/категория, используй соответствующие слоты ("бюджет", "жанр_музыки"/"жанр", "тип_мероприятия"), но НЕ "исполнитель".\n\n`;

  const finalSystemPrompt = `${strictEnvelope}${systemPrompt}`;

  const messages = [
    { role: 'system', content: finalSystemPrompt },
    { role: 'user', content: text },
  ];

  const parseContent = (raw) => {
    const content = raw || '{}';
    const cleanContent = String(content)
      .replace(/```json\s*/g, '')
      .replace(/```\s*/g, '')
      .trim();
    const parsed = JSON.parse(cleanContent);

    if (Array.isArray(parsed)) {
      return { kind: 'array', slots: parsed, intents: [] };
    }

    if (parsed && typeof parsed === 'object') {
      return {
        kind: 'object',
        slots: Array.isArray(parsed.slots) ? parsed.slots : [],
        intents: Array.isArray(parsed.intents) ? parsed.intents : [],
      };
    }

    return { kind: 'other', slots: [], intents: [] };
  };

  const normalizePreferencePolarity = (slot = {}) => {
    if (!slot || typeof slot !== 'object') {
      return slot;
    }

    const normalized = { ...slot };
    const rawPolarity =
      typeof slot.preferencePolarity === 'string'
        ? slot.preferencePolarity.trim().toLowerCase()
        : '';

    if (typeof normalized.isNegative !== 'boolean') {
      if (rawPolarity === 'negative') {
        normalized.isNegative = true;
      } else if (rawPolarity === 'positive' || rawPolarity === 'neutral') {
        normalized.isNegative = false;
      }
    }

    if (!rawPolarity) {
      if (normalized.isNegative === true) {
        normalized.preferencePolarity = 'negative';
      } else if (normalized.isNegative === false) {
        normalized.preferencePolarity = 'positive';
      }
    } else if (['positive', 'negative', 'neutral'].includes(rawPolarity)) {
      normalized.preferencePolarity = rawPolarity;
    } else {
      delete normalized.preferencePolarity;
    }

    return normalized;
  };

  const normalizeSlots = (slots = []) => {
    if (!Array.isArray(slots)) {
      return [];
    }

    return slots
      .filter((slot) => slot && typeof slot === 'object')
      .map((slot) => normalizePreferencePolarity(slot));
  };

  const normalizeIntents = (intents = []) => {
    if (!Array.isArray(intents)) {
      return [];
    }

    return intents
      .filter((intent) => intent && typeof intent === 'object')
      .map((intent) => ({
        ...intent,
        source: typeof intent.source === 'string' && intent.source.trim() ? intent.source : 'llm',
      }));
  };

  const response = await callAiGateway(messages, 0.3);
  const firstContent = response.choices?.[0]?.message?.content || '{}';

  try {
    const firstParsed = parseContent(firstContent);

    // Если LLM всё равно вернул верхнеуровневый массив — повторяем запрос с ещё более жёстким требованием.
    if (firstParsed.kind === 'array') {
      const retryMessages = messages.map((msg, idx) => {
        if (idx === 0 && msg.role === 'system') {
          return {
            ...msg,
            content: `‼️ Ответ должен быть ТОЛЬКО JSON-ОБЪЕКТОМ {\"slots\":[],\"intents\":[]} (НЕ массив!).\n\n${msg.content}`,
          };
        }
        return msg;
      });

      const retry = await callAiGateway(retryMessages, 0.2);
      const retryContent = retry.choices?.[0]?.message?.content || '{}';
      const retryParsed = parseContent(retryContent);
      return {
        slots: normalizeSlots(retryParsed.slots),
        intents: normalizeIntents(retryParsed.intents),
      };
    }

    return {
      slots: normalizeSlots(firstParsed.slots),
      intents: normalizeIntents(firstParsed.intents),
    };
  } catch (parseError) {
    console.error('Ошибка парсинга ответа LLM:', parseError);
    console.error('Содержимое:', firstContent);
    return { slots: [], intents: [] };
  }
}
