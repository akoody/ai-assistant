import { CITY_NORMALIZATION_MAP, CITY_DOMAIN_MAP, DEFAULT_DOMAIN } from './searchDefinitions.js';

function getCityKey(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]/gi, '');
}

function normalizeCityValue(value = '') {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return '';
  }
  const key = getCityKey(trimmed);
  return CITY_NORMALIZATION_MAP[key] || trimmed;
}

function transliterateToLatin(text) {
  const transliterationMap = {
    а: 'a',
    б: 'b',
    в: 'v',
    г: 'g',
    д: 'd',
    е: 'e',
    ё: 'e',
    ж: 'zh',
    з: 'z',
    и: 'i',
    й: 'y',
    к: 'k',
    л: 'l',
    м: 'm',
    н: 'n',
    о: 'o',
    п: 'p',
    р: 'r',
    с: 's',
    т: 't',
    у: 'u',
    ф: 'f',
    х: 'h',
    ц: 'ts',
    ч: 'ch',
    ш: 'sh',
    щ: 'sch',
    ъ: '',
    ы: 'y',
    ь: '',
    э: 'e',
    ю: 'yu',
    я: 'ya',
  };

  return text
    .toLowerCase()
    .split('')
    .map((char) => transliterationMap[char] || char)
    .join('')
    .replace(/[^a-z0-9]/g, '');
}

function generateDomainFromCity(cityName) {
  const transliterated = transliterateToLatin(cityName);
  if (transliterated) {
    return `${transliterated}.kassir.ru`;
  }
  return null;
}

function isRussianCity(cityName) {
  if (!cityName || typeof cityName !== 'string') {
    return false;
  }

  const trimmed = cityName.trim();
  if (!trimmed) {
    return false;
  }

  // КРИТИЧЕСКИ ВАЖНО: "Other city" и его варианты НЕ являются валидным городом
  const otherCityVariants = [
    'other city',
    'othercity',
    'другой город',
    'другом городе',
    'иной город',
    'прочий город',
  ];
  const trimmedLower = trimmed.toLowerCase();
  if (otherCityVariants.some((variant) => trimmedLower.includes(variant))) {
    return false;
  }

  const normalizedCity = normalizeCityValue(cityName);
  if (!normalizedCity) {
    return false;
  }

  // Проверяем, есть ли город в маппинге российских городов
  const key = getCityKey(normalizedCity);
  const mappedCity = CITY_NORMALIZATION_MAP[key] || normalizedCity;

  // Если город есть в CITY_NORMALIZATION_MAP или CITY_DOMAIN_MAP, значит это российский город
  return CITY_NORMALIZATION_MAP[key] !== undefined || CITY_DOMAIN_MAP[mappedCity] !== undefined;
}

function normalizeCityButton(buttonText) {
  if (!buttonText || typeof buttonText !== 'string') {
    return buttonText;
  }

  const trimmed = buttonText.trim();
  if (!trimmed) {
    return buttonText;
  }

  // Только фильтрация "Другой город" и его вариантов на русском языке
  // Пользователи пишут на русском, поэтому английские названия не обрабатываем
  const trimmedLower = trimmed.toLowerCase();

  // Проверяем варианты "Другой город" на русском
  const otherCityVariants = [
    'другой город',
    'другом городе',
    'другого города',
    'другому городу',
    'другим городом',
    'иной город',
    'прочий город',
  ];

  // Если это "Другой город" или его вариант, возвращаем стандартизированный вариант
  if (
    otherCityVariants.some((variant) => trimmedLower === variant || trimmedLower.includes(variant))
  ) {
    return 'Другой город';
  }

  // Для всех остальных случаев возвращаем как есть (пользователи пишут на русском)
  return buttonText;
}

function getDomainForCity(value = '') {
  const normalizedCity = normalizeCityValue(value);
  if (!normalizedCity) {
    return DEFAULT_DOMAIN;
  }

  // Проверяем явный маппинг
  const key = getCityKey(normalizedCity);
  const mappedCity = CITY_NORMALIZATION_MAP[key] || normalizedCity;
  const explicitDomain = CITY_DOMAIN_MAP[mappedCity];

  if (explicitDomain) {
    return explicitDomain;
  }

  // Если города нет в маппинге, генерируем домен через транслитерацию
  const generatedDomain = generateDomainFromCity(mappedCity);
  if (generatedDomain) {
    console.log(
      `🌍 [Domain] Автоматически сгенерирован домен для города "${mappedCity}": ${generatedDomain}`
    );
    return generatedDomain;
  }

  // Fallback на дефолтный домен
  console.warn(
    `⚠️ [Domain] Не удалось определить домен для города "${mappedCity}", используется дефолтный: ${DEFAULT_DOMAIN}`
  );
  return DEFAULT_DOMAIN;
}

export { normalizeCityValue, isRussianCity, normalizeCityButton, getDomainForCity };
