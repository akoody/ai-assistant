import { generateSearchQuery } from '../llmSearchService.js';
import {
  RAP_EQUIVALENTS,
  isTrivialKeyword,
  detectShortMusicGenre,
  findMusicEventTypeHint,
} from './keywordPolicy.js';
import {
  ROOT_CATEGORY_SEARCH_SLUGS,
  DEFAULT_PAGE_KIT_SLUG,
  isCategoryKeywordToken,
  shouldPreserveCategoryPhrase,
  normalizePageKitSlug,
  shouldSkipGeneratedKeywordForSlug,
  shouldApplyMoodKeywordFallback,
  inferMoodValueFromText,
  getFirstSlotValue,
  buildStrictSearchResolution,
  buildQuerySuggestionFromParams,
  shouldPreserveFullKeywordForNamedTarget,
  hasExplicitDateConstraint,
} from './searchRouting.js';
import { buildArtistKeywordFallbacks } from './artistAliases.js';
import { selectRelevantItems } from './relevanceSelection.js';
import { fetchPageKitWithResolvedSlugs } from './kassirClient.js';
import { extractShownEventsContext, isDuplicateEvent } from './eventIdentity.js';

async function searchEvents(params = {}) {
  const {
    context = {},
    slug = '/category/',
    keyword,
    date_from,
    date_to,
    price_from,
    price_to,
    domain = 'msk.kassir.ru',
    sort = 0,
    platformState = 'website',
    page,
    pageSize,
    skipLlmFilter = false,
    maxSelections = 6,
    userPreferences = null, // Предпочтения пользователя
    allowPreferenceKeywordExpansion = false,
    isBroadSearch = false,
  } = params;

  const { history = [], lastUserMessage = '', slots = [], requestId = '' } = context;
  const tracePrefix = requestId ? `[${requestId}] ` : '';
  const shownEventsContext = extractShownEventsContext(context);

  const normalizedRequestedSlug = normalizePageKitSlug(slug);
  const keywordFromParams = typeof keyword === 'string' ? keyword.trim() : '';
  const shouldSkipGeneratedKeywordForSpecificSlug = shouldSkipGeneratedKeywordForSlug(
    slug,
    keywordFromParams
  );
  const shouldForceBroadSearchWithoutKeyword = Boolean(
    isBroadSearch && normalizedRequestedSlug === DEFAULT_PAGE_KIT_SLUG && !keywordFromParams
  );

  const querySuggestion = keywordFromParams
    ? buildQuerySuggestionFromParams({
        keyword: keywordFromParams,
        slots,
        lastUserMessage,
      })
    : shouldSkipGeneratedKeywordForSpecificSlug
      ? buildQuerySuggestionFromParams({
          keyword: '',
          slots,
          lastUserMessage,
        })
      : shouldForceBroadSearchWithoutKeyword
        ? buildQuerySuggestionFromParams({
            keyword: '',
            slots,
            lastUserMessage,
          })
        : await generateSearchQuery({
            history,
            lastUserMessage,
            fallbackQuery: '', // отключаем заранее подготовленный fallback-ключ
            slots,
          });

  if (keywordFromParams) {
    console.log(
      `⚡ [KassirAPI] Пропускаю generateSearchQuery: planner уже передал keyword "${keywordFromParams}" ` +
        `(intent=${querySuggestion.intent}, context=${querySuggestion.context || 'none'})`
    );
  } else if (shouldSkipGeneratedKeywordForSpecificSlug) {
    console.log(
      `⚡ [KassirAPI] Пропускаю generateSearchQuery: planner уже передал конкретный slug "${normalizedRequestedSlug}", ` +
        'поэтому выполняю поиск без автосгенерированного keyword'
    );
  } else if (shouldForceBroadSearchWithoutKeyword) {
    console.log(
      `🌐 [KassirAPI] Broad search для "${normalizedRequestedSlug}": ` +
        'пропускаю generateSearchQuery и выполняю поиск без keyword'
    );
  }

  const hasMoodSlot = Array.isArray(slots) && slots.some((s) => s && s.name === 'настроение');
  const moodValueFromSlot = hasMoodSlot
    ? String(slots.find((s) => s && s.name === 'настроение')?.value || '')
        .toLowerCase()
        .trim()
    : '';

  const query = {
    slug,
    domain,
    platformState,
    sort,
  };

  const keywordSource = keywordFromParams
    ? 'params'
    : shouldSkipGeneratedKeywordForSpecificSlug
      ? 'specific-slug'
      : shouldForceBroadSearchWithoutKeyword
        ? 'broad-search'
        : 'llm';
  let effectiveKeyword = shouldForceBroadSearchWithoutKeyword
    ? ''
    : keywordFromParams || querySuggestion.searchQuery || '';
  const originalKeyword = effectiveKeyword; // Сохраняем для проверки жанра
  let usedPreferences = false;
  let detectedShortGenre = null;
  const inferredMoodValue =
    moodValueFromSlot ||
    inferMoodValueFromText(effectiveKeyword) ||
    inferMoodValueFromText(lastUserMessage);
  const hasMoodSignal = Boolean(inferredMoodValue);
  let moodValue = inferredMoodValue;

  const shouldForceMoodIntent = Boolean(
    hasMoodSignal && (querySuggestion.intent === 'generic' || querySuggestion.intent === 'unknown')
  );
  let effectiveIntent = shouldForceMoodIntent ? 'mood' : querySuggestion.intent;
  const hasExplicitDateInContext = hasExplicitDateConstraint(slots);
  let effectiveDateFrom = date_from;
  let effectiveDateTo = date_to;

  if (shouldForceMoodIntent) {
    console.log(
      `🎭 [KassirAPI] Обнаружен mood-сигнал, форсирую intent=mood (was: ${querySuggestion.intent}) для LLM-фильтра`
    );
    if (!hasMoodSlot && moodValue) {
      console.log(`🎭 [KassirAPI] Mood восстановлен эвристикой из текста: "${moodValue}"`);
    }
  }

  if (
    effectiveIntent === 'artist' &&
    !hasExplicitDateInContext &&
    (effectiveDateFrom || effectiveDateTo)
  ) {
    console.log(
      `🗓️ [KassirAPI] intent=artist без явной даты в текущем запросе: убираю date_from/date_to ` +
        `(${effectiveDateFrom || '∅'} - ${effectiveDateTo || '∅'})`
    );
    effectiveDateFrom = undefined;
    effectiveDateTo = undefined;
  }

  // Проверяем, есть ли у пользователя предпочтения
  if (userPreferences && allowPreferenceKeywordExpansion && !shouldForceBroadSearchWithoutKeyword) {
    console.log(`🧠 [KassirAPI] Проверка предпочтений пользователя для улучшения запроса`);

    // Определяем, указал ли пользователь жанр/артиста в текущем запросе
    const hasGenreInSlots = slots.some(
      (s) => s.name === 'жанр' || s.name === 'жанр_музыки' || s.name === 'предпочтения_жанры'
    );
    const hasArtistInSlots = slots.some((s) => s.name === 'исполнитель' || s.name === 'артист');

    // Определяем тип текущего запроса (общий тип события без конкретики)
    const isGeneralEventType =
      effectiveKeyword &&
      (effectiveKeyword.toLowerCase().includes('концерт') ||
        effectiveKeyword.toLowerCase().includes('театр') ||
        effectiveKeyword.toLowerCase().includes('выставк') ||
        effectiveKeyword.toLowerCase().includes('спектакл') ||
        effectiveKeyword.toLowerCase().includes('фестиваль') ||
        effectiveKeyword.toLowerCase().includes('кино'));

    // Определяем МУЗЫКАЛЬНЫЕ типы событий (к которым применяется жанр)
    const isMusicEvent =
      effectiveKeyword &&
      (effectiveKeyword.toLowerCase().includes('концерт') ||
        effectiveKeyword.toLowerCase().includes('фестиваль'));

    // Применяем предпочтения если:
    // 1. Запрос пустой или очень общий (< 3 символов)
    // 2. ИЛИ запрос содержит только общий тип события (концерт, театр и т.д.) БЕЗ конкретного жанра/артиста
    const shouldApplyPreferences =
      !effectiveKeyword ||
      effectiveKeyword.length < 3 ||
      (isGeneralEventType && !hasGenreInSlots && !hasArtistInSlots);

    if (shouldApplyPreferences) {
      // Приоритет: жанры > артисты > типы событий
      // ВАЖНО: Жанр и артисты применяем ТОЛЬКО к музыкальным событиям (концерт, фестиваль)
      // или когда тип события еще не определен (пустой запрос)

      if (userPreferences.genres && userPreferences.genres.length > 0 && isMusicEvent) {
        // Жанр применяем ТОЛЬКО к музыкальным событиям
        const preferredGenre = userPreferences.genres[userPreferences.genres.length - 1];

        if (effectiveKeyword) {
          effectiveKeyword = `${preferredGenre} ${effectiveKeyword}`;
          console.log(
            `🎵 [KassirAPI] Дополнен запрос предпочитаемым жанром: "${effectiveKeyword}"`
          );
        } else {
          effectiveKeyword = preferredGenre;
          console.log(
            `🎵 [KassirAPI] Применен предпочитаемый жанр из истории: "${effectiveKeyword}"`
          );
        }
        usedPreferences = true;
      } else if (userPreferences.artists && userPreferences.artists.length > 0) {
        // Артисты применяем ТОЛЬКО если:
        // 1. Это музыкальное событие (концерт, фестиваль)
        // 2. ИЛИ запрос совсем пустой/очень короткий (еще не определен тип события)
        const canApplyArtist = isMusicEvent || !effectiveKeyword || effectiveKeyword.length < 3;

        if (canApplyArtist) {
          effectiveKeyword = userPreferences.artists[userPreferences.artists.length - 1];
          usedPreferences = true;
          console.log(
            `🎤 [KassirAPI] Применен предпочитаемый артист из истории: "${effectiveKeyword}"`
          );
        } else {
          console.log(
            `ℹ️ [KassirAPI] Артист НЕ применен: это не музыкальное событие (${effectiveKeyword})`
          );
        }
      } else if (
        userPreferences.eventTypes &&
        userPreferences.eventTypes.length > 0 &&
        !effectiveKeyword
      ) {
        // Типы событий используем только если запрос совсем пустой
        effectiveKeyword = userPreferences.eventTypes[userPreferences.eventTypes.length - 1];
        usedPreferences = true;
        console.log(
          `🎭 [KassirAPI] Применен предпочитаемый тип события из истории: "${effectiveKeyword}"`
        );
      }
    } else {
      console.log(
        `ℹ️ [KassirAPI] Предпочтения не применяются: запрос специфичен (hasGenre: ${hasGenreInSlots}, hasArtist: ${hasArtistInSlots}, isGeneral: ${isGeneralEventType})`
      );
    }
  } else if (userPreferences && !allowPreferenceKeywordExpansion) {
    console.log(
      `ℹ️ [KassirAPI] Позитивные предпочтения не подмешиваются в keyword без явного запроса пользователя`
    );
  }

  console.log(
    `🔍 [KassirAPI] ${tracePrefix}Исходный запрос (${keywordSource}): "${effectiveKeyword}" (intent: ${effectiveIntent}, usedPreferences: ${usedPreferences})`
  );

  // Если были применены предпочтения, НЕ фильтруем слова - оставляем весь запрос как есть
  if (!usedPreferences && effectiveKeyword.includes(' ')) {
    const parts = effectiveKeyword
      .split(/\s+/)
      .map((part) => part.trim())
      .filter(Boolean);

    if (parts.length > 0) {
      // Для именованных целей оставляем все слова: название события из нескольких слов
      // нельзя схлопывать до первого токена ("Летучий корабль" -> "летучий").
      if (shouldPreserveFullKeywordForNamedTarget(querySuggestion, slots)) {
        effectiveKeyword = parts.join(' ');
      } else {
        // Для остальных intent'ов фильтруем тривиальные слова
        const importantParts = parts.filter((part) => !isTrivialKeyword(part));
        if (importantParts.length > 0) {
          // Музыкальные жанры - приоритет для поиска
          const musicGenresSet = new Set([
            'поп',
            'рок',
            'джаз',
            'рэп',
            'хип-хоп',
            'хипхоп',
            'блюз',
            'фолк',
            'метал',
            'металл',
            'инди',
            'регги',
            'соул',
            'фанк',
            'k-pop',
            'kpop',
            'электро',
            'техно',
            'хаус',
            'транс',
            'рейв',
            'панк',
            'гранж',
            'альтернатива',
            'классика',
            'опера',
            'шансон',
            'кантри',
            'r&b',
            'rnb',
          ]);

          // Ищем жанр среди слов
          const genrePart = importantParts.find((part) => musicGenresSet.has(part.toLowerCase()));

          if (genrePart) {
            // Если нашли жанр, стараемся сохранить и тип музыкального события (концерт/фестиваль/вечеринка),
            // иначе keyword получается слишком широким и Kassir возвращает нерелевантные события.
            const eventTypeHint = findMusicEventTypeHint({ parts: importantParts, slots });
            if (eventTypeHint) {
              effectiveKeyword = `${genrePart} ${eventTypeHint}`;
              console.log(
                `🎵 [KassirAPI] Найден жанр "${genrePart}" + тип "${eventTypeHint}" в запросе "${parts.join(' ')}", использую keyword "${effectiveKeyword}"`
              );
            } else {
              effectiveKeyword = genrePart;
              console.log(
                `🎵 [KassirAPI] Найден музыкальный жанр "${genrePart}" в запросе "${parts.join(' ')}", использую его как keyword`
              );
            }
          } else if (querySuggestion.intent === 'category') {
            // Для intent=category предпочитаем явный токен категории (театр/выставка/концерт/...),
            // чтобы "артист + категория" не схлопывалось в артиста (например: "Тетары театр" -> "Тетары").
            const categoryPart = importantParts.find((part) => isCategoryKeywordToken(part));

            if (categoryPart) {
              if (
                shouldPreserveCategoryPhrase({ importantParts, categoryPart, slots, keywordSource })
              ) {
                effectiveKeyword = importantParts.join(' ');
                console.log(
                  `🎭 [KassirAPI] intent=category: найден токен категории "${categoryPart}" и уточнение в "${parts.join(' ')}", сохраняю полный keyword "${effectiveKeyword}"`
                );
              } else {
                effectiveKeyword = categoryPart;
                console.log(
                  `🎭 [KassirAPI] intent=category: найден токен категории "${categoryPart}" в "${parts.join(' ')}", использую его как keyword`
                );
              }
            } else {
              // Если категории нет, берём первое важное слово как раньше
              effectiveKeyword = importantParts[0];
            }
          } else {
            const shouldSkipSingleWordKeyword =
              keywordSource !== 'params' &&
              (effectiveIntent === 'generic' || effectiveIntent === 'unknown');

            if (shouldSkipSingleWordKeyword) {
              console.log(
                `🧠 [KassirAPI] intent=${effectiveIntent}, keywordSource=${keywordSource}: ` +
                  `не сужаю keyword до одного слова, использую поиск без keyword`
              );
              effectiveKeyword = '';
            } else {
              // Если жанра нет, берём первое важное слово
              effectiveKeyword = importantParts[0];
            }
          }
        } else {
          // Если все слова тривиальные, очищаем запрос
          effectiveKeyword = '';
        }
      }
    }
  } else if (usedPreferences) {
    console.log(
      `🧠 [KassirAPI] Предпочтения применены, сохраняю полный запрос: "${effectiveKeyword}"`
    );
  }

  // Финальная проверка на тривиальность
  if (isTrivialKeyword(effectiveKeyword)) {
    console.log(`⚠️ [KassirAPI] ${tracePrefix}Запрос тривиальный, очищаю keyword`);
    effectiveKeyword = '';
  }

  if (effectiveIntent === 'mood' && keywordSource === 'params' && effectiveKeyword) {
    console.log(
      `🎭 [KassirAPI] Для mood-запроса из params очищаю текстовый keyword "${effectiveKeyword}", ` +
        'использую mood-keyword fallback'
    );
    effectiveKeyword = '';
  }

  // Функция вычисления mood-keyword по значению настроения
  function getMoodKeyword(m) {
    if (!m) return '';
    // Энергия / актив
    if (/(энерг|актив|драйв|динамич)/i.test(m)) return 'концерт';
    // Веселье
    if (/(весел|повесел|смеш|юмор|комед)/i.test(m)) return 'стендап';
    // Спокойствие
    if (/(спокой|расслаб|тих|уют)/i.test(m)) return 'театр';
    // Интеллект
    if (/(интеллект|умн|позн|узнат|культур|образов|лекц)/i.test(m)) return 'выставка';
    // Новое / необычное
    if (/(необыч|нов(ое|ый)?|нестандарт|эксперимент|иммерсив|перформ)/i.test(m)) return 'фестиваль';
    // Романтика
    if (/(романт|для\s*двоих|свидани)/i.test(m)) return 'джаз';
    // Грусть / тоска
    if (/(груст|тоск|грустн|хандр|печаль)/i.test(m)) return 'стендап';
    // Усталость
    if (/(уставш|устал|усталость)/i.test(m)) return 'джаз';
    // Злость
    if (/(^злой$|злость|ярость|гнев)/i.test(m)) return 'спорт';
    // Скука
    if (/(скуча|скука|скучно)/i.test(m)) return 'фестиваль';
    // Влюбленность
    if (/(влюблен|любовь|любл)/i.test(m)) return 'джаз';
    return '';
  }

  // Также проверяем контекст события (свидание) для определения романтического настроения
  const contextSlot = Array.isArray(slots)
    ? slots.find((s) => s && s.name === 'контекст_события')
    : null;
  const contextValue = contextSlot
    ? String(contextSlot.value || '')
        .toLowerCase()
        .trim()
    : '';
  const isRomanticContext =
    /(романт|свидани|для\s*двоих|влюблен)/i.test(moodValue) ||
    /(романт|свидани)/i.test(contextValue);

  if (
    shouldApplyMoodKeywordFallback({
      hasMoodSlot: hasMoodSignal,
      moodValue,
      effectiveIntent,
      effectiveKeyword,
      keywordSource,
      allowParamMoodKeyword: keywordSource === 'params' && !hasMoodSlot && hasMoodSignal,
      shouldSkipGeneratedKeywordForSpecificSlug,
      isRomanticContext,
    })
  ) {
    const moodKeyword = getMoodKeyword(moodValue);
    if (moodKeyword) {
      if (isRomanticContext && effectiveKeyword && effectiveKeyword !== moodKeyword) {
        console.log(
          `💕 [KassirAPI] Романтический контекст: заменяю keyword "${effectiveKeyword}" -> mood-keyword "${moodKeyword}"`
        );
      } else if (isRomanticContext) {
        console.log(`🎭 [KassirAPI] Mood="${moodValue}": использую mood-keyword "${moodKeyword}"`);
      } else if (shouldSkipGeneratedKeywordForSpecificSlug) {
        console.log(
          `🛑 [KassirAPI] Mood="${moodValue}": не подмешиваю mood-keyword "${moodKeyword}" ` +
            `для конкретного slug "${normalizedRequestedSlug}"`
        );
        // defensive branch; по текущей логике сюда не попадём из-за shouldApplyMoodKeywordFallback
        effectiveKeyword = '';
      } else {
        console.log(
          `🎭 [KassirAPI] Mood="${moodValue}": keyword пустой, использую mood-keyword "${moodKeyword}"`
        );
      }
      effectiveKeyword = moodKeyword;
    }
  } else if (
    hasMoodSlot &&
    moodValue &&
    shouldSkipGeneratedKeywordForSpecificSlug &&
    !effectiveKeyword
  ) {
    console.log(
      `🎭 [KassirAPI] Mood="${moodValue}": planner передал конкретный slug "${normalizedRequestedSlug}", ` +
        'оставляю keyword пустым для широкой витринной выборки'
    );
  }

  if (shouldForceBroadSearchWithoutKeyword && effectiveKeyword) {
    console.log(
      `🌐 [KassirAPI] Broad search: очищаю keyword "${effectiveKeyword}", ` +
        'чтобы общая афиша не сужалась до одной категории'
    );
    effectiveKeyword = '';
  }

  // Детектируем короткий жанр после всех модификаций keyword (включая preferences).
  detectedShortGenre = detectShortMusicGenre(effectiveKeyword);

  // Для коротких жанров стараемся держать keyword достаточно "музыкальным":
  // добавляем тип события из слотов (концерт/фестиваль/вечеринка), чтобы Kassir не возвращал слишком широкий мусор.
  // Исключение: если slug уже кодирует эту категорию (например /bilety-na-koncert/),
  // добавлять тип в keyword бессмысленно — Kassir уже фильтрует по категории через slug.
  const shortMusicGenres = [
    'поп',
    'рок',
    'джаз',
    'рэп',
    'блюз',
    'фолк',
    'метал',
    'инди',
    'регги',
    'соул',
    'фанк',
  ];
  const rootCategorySlugs = new Set(Object.values(ROOT_CATEGORY_SEARCH_SLUGS));
  const slugAlreadyCoversCategory = rootCategorySlugs.has(normalizedRequestedSlug);

  if (detectedShortGenre && shortMusicGenres.includes(detectedShortGenre)) {
    const hint = findMusicEventTypeHint({ parts: [], slots });
    const keywordLower = String(effectiveKeyword || '').toLowerCase();
    if (hint && !keywordLower.includes(hint) && !slugAlreadyCoversCategory) {
      effectiveKeyword = `${effectiveKeyword} ${hint}`.trim();
      console.log(
        `🎵 [KassirAPI] Короткий жанр "${detectedShortGenre}": добавляю тип "${hint}" из слотов -> keyword="${effectiveKeyword}"`
      );
    } else if (hint && slugAlreadyCoversCategory) {
      console.log(
        `🎵 [KassirAPI] Короткий жанр "${detectedShortGenre}": slug "${normalizedRequestedSlug}" уже покрывает категорию "${hint}", оставляю keyword="${effectiveKeyword}"`
      );
    }
  }

  // Добавляем keyword только если он не пустой
  if (effectiveKeyword) {
    query.keyword = effectiveKeyword;
    console.log(`✅ [KassirAPI] Используется keyword: "${effectiveKeyword}"`);
  } else {
    console.log(
      `ℹ️ [KassirAPI] Keyword пустой, поиск будет выполняться без фильтрации по ключевому слову`
    );
  }

  if (effectiveDateFrom) {
    query.date_from = effectiveDateFrom;
  }

  if (effectiveDateTo) {
    query.date_to = effectiveDateTo;
  }

  if (price_from) {
    query.price_from = price_from;
  }

  if (price_to) {
    query.price_to = price_to;
  }

  if (page) {
    query.page = page;
  }

  if (pageSize) {
    query.page_size = pageSize;
  }

  let { apiData, items, pagination, slugStrategy } = await fetchPageKitWithResolvedSlugs({
    query,
    effectiveKeyword,
    querySuggestion,
    slots,
    lastUserMessage,
    isBroadSearch,
  });

  const requestedPage = page ? Number(page) : 1;
  const isFirstPage = !page || Number.isNaN(requestedPage) || requestedPage === 1;

  // если Kassir вернул 0 событий, пробуем более широкий keyword.
  // Это помогает для коротких жанров (например, "рок концерты"), когда у афиш нет явного жанрового маркера в keyword.
  if (isFirstPage && Array.isArray(items) && items.length === 0) {
    const keywordCandidates = [];
    const seen = new Set();
    const strictArtistValue = getFirstSlotValue(slots, ['исполнитель', 'артист']);

    const pushKeywordCandidate = (value, label) => {
      const candidate = typeof value === 'string' ? value.trim() : '';
      if (!candidate) return;
      if (isTrivialKeyword(candidate)) return;
      const key = candidate.toLowerCase();
      if (seen.has(key)) return;
      keywordCandidates.push({ keyword: candidate, label });
      seen.add(key);
    };

    pushKeywordCandidate(query.keyword || '', 'primary');
    pushKeywordCandidate(originalKeyword || '', 'original');

    if (strictArtistValue) {
      pushKeywordCandidate(strictArtistValue, 'artist-slot');
      buildArtistKeywordFallbacks(strictArtistValue).forEach(({ keyword, label }) => {
        pushKeywordCandidate(keyword, label);
      });
    } else if (effectiveIntent === 'artist') {
      buildArtistKeywordFallbacks(
        query.keyword || effectiveKeyword || originalKeyword || ''
      ).forEach(({ keyword, label }) => {
        pushKeywordCandidate(keyword, label);
      });
    }

    const shortMusicGenres = [
      'поп',
      'рок',
      'джаз',
      'рэп',
      'блюз',
      'фолк',
      'метал',
      'инди',
      'регги',
      'соул',
      'фанк',
    ];
    if (
      detectedShortGenre &&
      shortMusicGenres.includes(detectedShortGenre) &&
      !slugAlreadyCoversCategory
    ) {
      // Добавляем тип как fallback только если slug не покрывает категорию.
      // Если slug уже /bilety-na-koncert/ — поиск с keyword="концерт" вернёт все концерты без жанра, что хуже нулевого результата.
      pushKeywordCandidate(findMusicEventTypeHint({ parts: [], slots }) || '', 'event-type-hint');
    }

    if (keywordCandidates.length > 1) {
      const primary = keywordCandidates[0];
      console.log(
        `🛟 [KassirAPI] Пустой ответ для keyword="${primary.keyword}". Пробую fallback keywords: ` +
          keywordCandidates
            .slice(1)
            .map(({ keyword, label }) => `"${keyword}"(${label})`)
            .join(', ')
      );

      for (let index = 1; index < keywordCandidates.length; index += 1) {
        const { keyword: fallbackKeyword, label } = keywordCandidates[index];
        const fallbackQuery = { ...query, keyword: fallbackKeyword };
        const fallbackResult = await fetchPageKitWithResolvedSlugs({
          query: fallbackQuery,
          effectiveKeyword: fallbackKeyword,
          querySuggestion,
          slots,
          lastUserMessage,
          isBroadSearch,
        });
        const fallbackApiData = fallbackResult.apiData;
        const fallbackSearchResult = fallbackResult.searchResult || {};
        const fallbackItems = fallbackResult.items || [];
        if (Array.isArray(fallbackItems) && fallbackItems.length > 0) {
          console.log(
            `🛟 [KassirAPI] Fallback keyword сработал: "${fallbackKeyword}" (${label}), items=${fallbackItems.length}`
          );
          apiData = fallbackApiData;
          items = fallbackItems;
          pagination = fallbackResult.pagination || fallbackSearchResult.pagination || null;
          slugStrategy = fallbackResult.slugStrategy || slugStrategy;
          query.keyword = fallbackKeyword;
          break;
        }
      }
    }
  }

  // Для рэп/хип-хоп расширяем пул кандидатов: Kassir может сильно различать keyword "рэп" и "хип-хоп"
  if (detectedShortGenre && RAP_EQUIVALENTS.has(detectedShortGenre) && query.keyword) {
    const altKeyword = detectedShortGenre === 'рэп' ? 'хип-хоп' : 'рэп';
    if (altKeyword && altKeyword !== query.keyword) {
      const altQuery = {
        ...query,
        keyword: altKeyword,
      };
      console.log(
        `🔁 [KassirAPI] Расширяю поиск для жанра "${detectedShortGenre}": доп. keyword "${altKeyword}"`
      );
      const altResult = await fetchPageKitWithResolvedSlugs({
        query: altQuery,
        effectiveKeyword: altKeyword,
        querySuggestion,
        slots,
        lastUserMessage,
        isBroadSearch,
      });
      const altItems = altResult.items || [];
      const altPagination = altResult.pagination || null;

      if (Array.isArray(altItems) && altItems.length > 0) {
        items = items.concat(altItems);
        console.log(
          `🔁 [KassirAPI] Доп. keyword "${altKeyword}": добавлено кандидатов: ${altItems.length} (итого до дедупа: ${items.length})`
        );
      }

      if (pagination && altPagination) {
        const basePages = typeof pagination.pagesCount === 'number' ? pagination.pagesCount : null;
        const altPages =
          typeof altPagination.pagesCount === 'number' ? altPagination.pagesCount : null;
        const baseTotal = typeof pagination.totalCount === 'number' ? pagination.totalCount : null;
        const altTotal =
          typeof altPagination.totalCount === 'number' ? altPagination.totalCount : null;

        pagination = {
          ...pagination,
          pagesCount:
            basePages !== null && altPages !== null
              ? Math.max(basePages, altPages)
              : (basePages ?? altPages ?? pagination.pagesCount),
          totalCount:
            baseTotal !== null && altTotal !== null
              ? Math.max(baseTotal, altTotal)
              : (baseTotal ?? altTotal ?? pagination.totalCount),
        };
      } else {
        pagination = pagination || altPagination || null;
      }
    }
  }

  if (slugStrategy?.broadSearch) {
    console.log(
      `🧩 [KassirAPI] Итог broad-search по slug'ам: ${slugStrategy.slugs.length} витрин, ` +
        `собрано кандидатов до дедупликации: ${Array.isArray(items) ? items.length : 0}`
    );
  }

  const strictSearchResolution = buildStrictSearchResolution({
    slots,
    effectiveKeyword,
    originalKeyword,
  });

  if (strictSearchResolution.strictQuerySuppressed) {
    console.log(
      `⚠️ [KassirAPI] Строгий поиск по ${strictSearchResolution.strictSource}="${strictSearchResolution.strictValue}" ` +
        `отключён: appliedKeyword="${strictSearchResolution.appliedKeyword || '[empty]'}", ` +
        `reason=${strictSearchResolution.suppressionReason}`
    );
  }

  const knownEvents = shownEventsContext.knownEvents;
  const excludeIds = new Set(shownEventsContext.excludeIds);
  const excludeSignatures = new Set(shownEventsContext.excludeSignatures);
  const dedupedItems = [];

  items.forEach((item) => {
    if (!isDuplicateEvent(item, excludeIds, excludeSignatures)) {
      dedupedItems.push(item);
    }
  });

  if (dedupedItems.length !== items.length) {
    console.log(
      `♻️ [KassirAPI] Удалено дубликатов/уже показанных: ${items.length - dedupedItems.length}`
    );
  }

  const { baseCandidates, filteredItems, filterInfo } = await selectRelevantItems({
    candidates: dedupedItems,
    effectiveKeyword,
    querySuggestion,
    effectiveIntent,
    detectedShortGenre,
    hasMoodSlot,
    moodValue,
    lastUserMessage,
    history,
    knownEvents,
    slots,
    allowLlmFilter: !skipLlmFilter,
    maxSelections,
    isBroadSearch:
      shouldForceBroadSearchWithoutKeyword ||
      Boolean(slugStrategy?.reason === 'forced-broad-search'),
  });

  return {
    items: filteredItems,
    pagination: pagination,
    total: pagination?.totalCount ?? items.length,
    meta: {
      llmQuery: querySuggestion,
      filtered: filterInfo,
      sourceCounts: {
        rawItems: Array.isArray(items) ? items.length : 0,
        // Backward-compatible: "uniqueItems" historically meant "после дедупликации".
        uniqueItems: Array.isArray(dedupedItems) ? dedupedItems.length : 0,
        dedupedItems: Array.isArray(dedupedItems) ? dedupedItems.length : 0,
        baseCandidates: Array.isArray(baseCandidates) ? baseCandidates.length : 0,
      },
      searchResolution: {
        requestedKeyword: keywordFromParams || querySuggestion.searchQuery || '',
        appliedKeyword: effectiveKeyword,
        strictSource: strictSearchResolution.strictSource,
        strictValue: strictSearchResolution.strictValue,
        strictQuerySuppressed: strictSearchResolution.strictQuerySuppressed,
        suppressionReason: strictSearchResolution.suppressionReason,
        slugStrategyReason: slugStrategy?.reason || null,
        broadSearch: Boolean(slugStrategy?.broadSearch),
      },
      usedPreferences: usedPreferences, // Флаг использования предпочтений
    },
    raw: apiData,
  };
}

export { searchEvents };
