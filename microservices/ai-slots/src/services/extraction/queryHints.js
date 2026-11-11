import { normalizeGuardText } from './timeGrounding.js';
import { SEARCH_QUERY_SLOT_NAME, MOOD_SLOT_NAME } from './policy.js';

function looksLikeTouristRequest(text) {
  const normalized = String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .trim();
  if (!normalized) return false;

  // Не считаем туристическим запросом, если пользователь явно просит экскурсию/тур (это отдельная категория)
  if (/(экскурс|(?:^|\s)тур(?:ы|а|у|ом|е|ов)?(?:$|\s|[.,!?;:\-–—]))/iu.test(normalized)) {
    return false;
  }

  // Не считаем туристическим, если пользователь явно выбрал другую категорию афиши.
  if (
    /(концерт|театр|спектакл|выставк|ст[эе]ндап|standup|кино|фильм|музей|спорт|квест|фестиваль|шоу|цирк|клоунад)/iu.test(
      normalized
    )
  ) {
    return false;
  }

  // Точные туристические маркеры
  if (/(турист|туризм|достопримечательн)/iu.test(normalized)) return true;

  if (/(?:что\s+посмотр[а-яё-]*|что\s+посет[а-яё-]*)\s+в\s+[а-яё-]{3,}/iu.test(normalized))
    return true;

  if (/(?:куда\s+(?:сходить|пойти)|где\s+погулять)\s+в\s+[а-яё-]{3,}/iu.test(normalized))
    return true;

  // Косвенные маркеры приезда/первого раза
  if (
    /(первый\s+раз|впервые|приехал|приехала|приезжаю|приезжаем|прилетел|прилетела|гость\w*)/iu.test(
      normalized
    )
  )
    return true;

  return false;
}

function looksLikeMuseumRequest(text) {
  const normalized = String(text || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .trim();
  if (!normalized) return false;

  const hasMuseumToken = /(музе[йяею]|музеев|музеем|музеях|галере[яеюи]|галерей|планетар)/u.test(
    normalized
  );
  if (!hasMuseumToken) return false;

  if (
    /(концерт|театр|спектакл|выставк|ст[эе]ндап|standup|кино|фильм|спорт|квест|фестиваль|шоу|цирк|клоунад|лекци|семинар|мастер[- ]?класс|экскурс)/u.test(
      normalized
    )
  ) {
    return false;
  }

  return true;
}

function extractHeuristicSearchQuery(text = '') {
  const normalized = normalizeGuardText(text);
  if (!normalized) {
    return null;
  }

  if (/планетар/u.test(normalized)) {
    return 'планетарий';
  }

  // Обобщенный запрос про формат шоу, а не конкретного артиста.
  // Например: "Иллюзионист", "Хочу на иллюзиониста" -> keyword "иллюзионист".
  if (
    /(?:^|[^\p{L}\p{N}_])иллюзионист(?:ы|ов|ам|ами|ах|а|у|ом|е)?(?=$|[^\p{L}\p{N}_])/u.test(
      normalized
    )
  ) {
    return 'иллюзионист';
  }

  return null;
}

function appendHeuristicSearchQuerySlot(slots = [], text = '') {
  const target = Array.isArray(slots) ? slots : [];
  const heuristicQuery = extractHeuristicSearchQuery(text);
  if (!heuristicQuery) {
    return target;
  }

  const hasExistingQuerySlot = target.some((slot) => {
    if (!slot || slot.name !== SEARCH_QUERY_SLOT_NAME) {
      return false;
    }

    return String(slot.value || '').trim() !== '';
  });

  if (hasExistingQuerySlot) {
    return target;
  }

  target.push({
    name: SEARCH_QUERY_SLOT_NAME,
    value: heuristicQuery,
    confidence: 0.95,
    source: 'heuristic',
  });
  console.log(
    `[queueService] Добавлен эвристический поисковый слот: ${SEARCH_QUERY_SLOT_NAME}="${heuristicQuery}"`
  );
  return target;
}

function extractHeuristicMoodValue(text = '') {
  const normalized = normalizeGuardText(text);
  if (!normalized) {
    return null;
  }

  if (/(романт|свидан|для\s*двоих|влюблен|любов)/u.test(normalized)) {
    return 'романтика';
  }

  if (
    /(поднят[а-яё]*\s+настроен|улучш[а-яё]*\s+настроен|поддерж[а-яё]*\s+(?:его\s+)?настроен|для\s+настроени[яе]|развея[а-яё]*|отвлеч[а-яё]*|взбодр[а-яё]*|повесел[а-яё]*|посмея[а-яё]*|рассмеш[а-яё]*|скучн)/u.test(
      normalized
    )
  ) {
    return 'веселье';
  }

  // Явная грусть/тоска без запроса "поднять настроение" — это отдельный mood-сигнал.
  // Дальше в ai-planner он попадет в comfort-профиль.
  if (/(грустн|тоск|хандр|печал)/u.test(normalized)) {
    return 'грустное';
  }

  // "по настроению" / "под настроение" — идиом "как придётся / что захочу":
  // пользователь НЕ указал конкретное настроение, пусть планировщик уточнит.
  if (/(?:^|[^\p{L}\p{N}])(?:по|под)\s+настроени/u.test(normalized)) {
    return null;
  }

  // Позитивный контекст: "хорошее/отличное настроение", "сохранить/поддержать настроение",
  // "настроение [его/это] поддержать" — конкретный сигнал веселья.
  if (
    /(хорош|отличн|прекрасн|замечат|чудесн|позитив|весёл|велик)\S*\s+настроени/u.test(normalized) ||
    /настроени\S*\s+(?:\S+\s+){0,3}(?:поддерж|сохран|продолж|подде|не\s+потерят)/u.test(
      normalized
    ) ||
    /(?:поддерж|сохран)\S*\s+(?:\S+\s+){0,3}настроени/u.test(normalized)
  ) {
    return 'веселье';
  }

  if (
    /(энерг|актив|драйв|подвигат|выплесн[а-яё]*\s+энерг|зарядит[а-яё]*|тус|движ)/u.test(normalized)
  ) {
    return 'энергичный';
  }

  if (/(спокой|расслаб|тих|уют|умиротвор|отдохн|устал|выгорел|перегорел)/u.test(normalized)) {
    return 'спокойный';
  }

  if (/(интеллект|умн|позн|узнат[а-яё]*\s+нов|вдохнов|культур|образов|лекц)/u.test(normalized)) {
    return 'интеллектуальный';
  }

  if (/(необыч|нов(?:ое|ый)|нестандарт|эксперимент|иммерсив|перформ|удив)/u.test(normalized)) {
    return 'новое/необычное';
  }

  return null;
}

function appendHeuristicMoodSlot(slots = [], text = '') {
  const target = Array.isArray(slots) ? slots : [];
  const hasMoodSlot = target.some(
    (slot) => slot && slot.name === MOOD_SLOT_NAME && String(slot.value || '').trim()
  );
  if (hasMoodSlot) {
    return target;
  }

  const moodValue = extractHeuristicMoodValue(text);
  if (!moodValue) {
    return target;
  }

  target.push({
    name: MOOD_SLOT_NAME,
    value: moodValue,
    confidence: 0.93,
    source: 'heuristic_mood',
  });
  console.log(
    `[queueService] Добавлен эвристический слот настроения: ${MOOD_SLOT_NAME}="${moodValue}"`
  );
  return target;
}

export {
  looksLikeTouristRequest,
  looksLikeMuseumRequest,
  appendHeuristicSearchQuerySlot,
  extractHeuristicMoodValue,
  appendHeuristicMoodSlot,
};
