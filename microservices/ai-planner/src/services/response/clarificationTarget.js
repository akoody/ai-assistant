import { isPopularSelectionCategoryButton } from '../../../../../shared/popularSelectionCategories.js';
import { normalizeAssistantButtonLabel } from './buttonLabels.js';
import { normalizeClarificationTextForMatch } from './textUtils.js';
import { normalizeComparableCategoryValue, CATEGORY_BUTTON_LABELS } from './categoryDefinitions.js';

function inferClarificationTarget({ buttons = [], text = '' } = {}) {
  const normalizedButtons = Array.isArray(buttons)
    ? buttons
        .map((item) => normalizeClarificationTextForMatch(normalizeAssistantButtonLabel(item)))
        .filter(Boolean)
    : [];
  const normalizedText = normalizeClarificationTextForMatch(text);
  const genreIndicators = [
    'рок',
    'поп',
    'джаз',
    'классика',
    'хип хоп',
    'комедия',
    'драма',
    'мюзикл',
    'детский',
    'опера',
    'балет',
    'танец',
    'кукольный театр',
    'спектакли',
    'гастроли',
    'мелодрама',
    'сказка',
    'трагикомедия',
    'иммерсивный спектакль',
    'моноспектакли',
    'цирк',
    'цирк клоунада',
    'спортивное шоу',
    'юмор',
    'другое',
    'стендап',
    'пешеходные',
    'автобусные',
    'необычные',
    'обзорные',
    'детям',
    'театрализованная экскурсия',
    'экскурсия в особняк',
    'дополнительное образование',
    'вебинары',
    'лекции',
    'конференции',
    'мастер классы',
    'футбол',
    'единоборства',
    'баскетбол',
    'автоспорт',
    'сольный',
    'женский',
    'заповедники',
    'мемориальные',
    'квартиры исторические',
    'археологические',
    'естественнонаучные',
    'краеведческие',
    'литературные',
    'отраслевые',
    'художественные',
    'выставки',
    'архитектурные',
    'исторические',
    'комплексные',
    'технические',
    'искусствоведческие',
    'фотографии',
    'экскурсии',
    'активный отдых',
    'музыкальные фестивали',
    'опен эйр',
  ];
  const hasAmbiguousCategoryPrompt =
    /в\s+какой\s+категор|встреча(?:ется|ются)\s+в\s+нескольких\s+категори|что\s+вам\s+ближе\s+или\s+показать\s+все/u.test(
      normalizedText
    );
  const hasAmbiguousCategoryButtons = normalizedButtons.some((item) => {
    const normalizedCategory = normalizeComparableCategoryValue(item);
    return CATEGORY_BUTTON_LABELS.has(normalizedCategory) || isPopularSelectionCategoryButton(item);
  });

  if (hasAmbiguousCategoryPrompt && hasAmbiguousCategoryButtons) {
    return 'ambiguous_category';
  }

  if (
    normalizedButtons.some((item) =>
      ['концерты', 'театры', 'выставки', 'музеи', 'стендап'].includes(item)
    ) ||
    normalizedButtons.some((item) => isPopularSelectionCategoryButton(item))
  ) {
    return 'category';
  }
  if (normalizedButtons.some((item) => genreIndicators.includes(item))) {
    return 'genre';
  }
  if (
    normalizedButtons.some(
      (item) =>
        item.includes('малыш') ||
        item.includes('среднего возраста') ||
        item.includes('старшего возраста') ||
        item.includes('детские спектакли') ||
        item.includes('детские концерты') ||
        item.includes('детские мюзиклы') ||
        item.includes('цирк') ||
        item.includes('клоунад') ||
        item.includes('детские шоу') ||
        item === 'другое'
    )
  ) {
    return 'genre';
  }
  if (normalizedButtons.some((item) => ['музыкальные фестивали', 'опен эйр'].includes(item))) {
    return 'genre';
  }
  if (
    normalizedButtons.some(
      (item) =>
        item.includes('1000') || item.includes('3000') || item.includes('5000') || item === 'любой'
    )
  ) {
    return 'budget';
  }
  if (
    normalizedButtons.some(
      (item) =>
        item.includes('утр') ||
        item.includes('днем') ||
        item.includes('вечер') ||
        item.includes('ноч')
    )
  ) {
    return 'time';
  }
  if (
    normalizedButtons.some(
      (item) =>
        item.includes('сегодня') ||
        item.includes('завтра') ||
        item.includes('выходн') ||
        item.includes('неделе') ||
        item === 'любая'
    )
  ) {
    return 'date';
  }

  if (
    normalizedButtons.some((item) =>
      ['веселое', 'романтичное', 'спокойное', 'энергичное', 'необычное'].includes(item)
    )
  ) {
    return 'настроение';
  }
  if (normalizedText.includes('жанр')) return 'genre';
  if (normalizedText.includes('бюджет') || normalizedText.includes('стоимость')) return 'budget';
  if (
    normalizedText.includes('время') ||
    normalizedText.includes('утром') ||
    normalizedText.includes('вечером')
  )
    return 'time';
  if (normalizedText.includes('дат')) return 'date';
  if (
    normalizedText.includes('концерты') ||
    normalizedText.includes('театры') ||
    normalizedText.includes('выставки')
  )
    return 'category';
  if (
    normalizedText.includes('настроени') ||
    normalizedText.includes('весел') ||
    normalizedText.includes('романт')
  )
    return 'настроение';

  return '';
}

export { inferClarificationTarget };
