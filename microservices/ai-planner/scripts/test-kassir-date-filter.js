import { loadRootEnv, resolveInternalApiKey } from '../../../shared/runtimeEnv.js';
loadRootEnv(import.meta.url);
import iconv from 'iconv-lite';

const fetchFn = fetch;
const MOJIBAKE_PATTERN = /(?:Ð|Ñ|Р|С)[\u0430-\u045f]/;

function fixCliEncoding(value) {
  if (!value || typeof value !== 'string') {
    return value;
  }

  if (!MOJIBAKE_PATTERN.test(value)) {
    return value;
  }

  try {
    const decoded = iconv.decode(iconv.encode(value, 'cp1251'), 'utf8');
    return decoded || value;
  } catch (error) {
    console.warn(
      '⚠️  Не удалось нормализовать строку CLI, возвращаю исходное значение:',
      value,
      error.message
    );
    return value;
  }
}

const AI_TOOLS_URL = process.env.AI_TOOLS_URL || 'http://localhost:3003';
const AI_TOOLS_API_KEY = resolveInternalApiKey({
  serviceName: 'ai-tools client',
  settingName: 'testApiKey',
  envName: 'AI_TOOLS_API_KEY',
});

const CITY_DOMAIN_MAP = {
  Москва: 'msk.kassir.ru',
  москва: 'msk.kassir.ru',
  moskva: 'msk.kassir.ru',
  moscow: 'msk.kassir.ru',
  'Санкт-Петербург': 'spb.kassir.ru',
  санктпетербург: 'spb.kassir.ru',
  spb: 'spb.kassir.ru',
  stpetersburg: 'spb.kassir.ru',
};

const DEFAULT_DOMAIN = 'msk.kassir.ru';
const DEFAULT_SLUG = '/category/';
const DEFAULT_PLATFORM_STATE = 'website';
const DEFAULT_SORT = 0;
const DEFAULT_KEYWORD = 'концерт';

function normalizeCityKey(value = '') {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return '';
  }
  return trimmed
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]/gi, '');
}

function normalizeDateInput(raw) {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(trimmed)) {
    return trimmed;
  }

  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${day}.${month}.${year}`;
  }

  const date = new Date(trimmed);
  if (!Number.isNaN(date.getTime())) {
    return formatDateForKassir(date);
  }

  return undefined;
}

function formatDateForKassir(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return undefined;
  }
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}.${month}.${year}`;
}

function parseDateForComparison(raw) {
  if (!raw) return undefined;
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(raw)) {
    const [day, month, year] = raw.split('.').map(Number);
    return new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed;
  }

  return undefined;
}

function extractEventDate(event) {
  if (!event) return undefined;
  const obj = event.object || event;
  const activity = event.activity || {};

  const candidates = [
    obj?.beginsAt,
    obj?.date,
    obj?.dateStart,
    activity?.dateRange?.beginsAt,
    activity?.dateRange?.startDate,
    obj?.dateRange?.beginsAt,
    obj?.dateRange?.startDate,
  ].filter(Boolean);

  for (const candidate of candidates) {
    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return undefined;
}

async function run() {
  const args = process.argv.slice(2);
  const fromArg = args[0] || '08.11.2025';
  const toArg = args[1];
  const cityArgRaw = args[2];
  const domainArg = args[3];
  const priceFromArg = args[4];
  const priceToArg = args[5];
  const keywordArg = args[6];

  const keywordArgNormalized = keywordArg ? fixCliEncoding(keywordArg) : undefined;
  const cityArg =
    cityArgRaw && cityArgRaw.trim().length > 0 ? fixCliEncoding(cityArgRaw) : undefined;

  const dateFrom = normalizeDateInput(fromArg);
  const dateTo = normalizeDateInput(toArg);

  if (!dateFrom) {
    console.error('❌ Неверный формат dateFrom. Используйте ДД.ММ.ГГГГ или ISO YYYY-MM-DD.');
    process.exit(1);
  }

  const resolvedDomain = (() => {
    if (domainArg && domainArg.trim().length > 0) {
      return domainArg.trim();
    }
    if (cityArg) {
      const normalizedKey = normalizeCityKey(cityArg);
      const mapped =
        CITY_DOMAIN_MAP[cityArg] ||
        CITY_DOMAIN_MAP[cityArg.trim()] ||
        CITY_DOMAIN_MAP[normalizedKey];
      if (mapped) {
        return mapped;
      }
    }
    return DEFAULT_DOMAIN;
  })();

  const payload = {
    slug: DEFAULT_SLUG,
    domain: resolvedDomain,
    platformState: DEFAULT_PLATFORM_STATE,
    sort: DEFAULT_SORT,
    page: 1,
    date_from: dateFrom,
    keyword: keywordArgNormalized || DEFAULT_KEYWORD,
  };

  if (dateTo) {
    payload.date_to = dateTo;
  }

  if (cityArg) {
    payload.city = cityArg;
  }

  const priceFromValue = Number(priceFromArg);
  if (!Number.isNaN(priceFromValue) && priceFromValue > 0) {
    payload.price_from = priceFromValue;
  }

  const priceToValue = Number(priceToArg);
  if (!Number.isNaN(priceToValue) && priceToValue > 0) {
    payload.price_to = priceToValue;
  }

  console.log('➡️  Отправляем запрос в Kassir API через AI Tools:');
  console.log(JSON.stringify(payload, null, 2));

  const kassirBaseUrl = process.env.KASSIR_API_URL || 'https://api.kassir.ru';
  const kassirUrl = new URL('/api/page-kit', kassirBaseUrl);
  const directParams = {
    slug: payload.slug,
    domain: payload.domain,
    platformState: payload.platformState,
    sort: payload.sort,
    page: payload.page,
    keyword: payload.keyword,
    date_from: payload.date_from,
    date_to: payload.date_to,
    price_from: payload.price_from,
    price_to: payload.price_to,
  };

  Object.entries(directParams).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      kassirUrl.searchParams.append(key, value);
    }
  });

  const curlParts = [
    `curl -X GET "${kassirUrl.toString()}"`,
    `-H "Content-Type: application/json"`,
  ];
  const kassirToken = process.env.KASSIR_API_TOKEN;
  if (kassirToken) {
    curlParts.push(`-H "Authorization: Bearer ${kassirToken}"`);
  }

  console.log('\n💻 Прямой curl к Kassir API:');
  console.log(curlParts.join(' '));

  try {
    const response = await fetchFn(`${AI_TOOLS_URL}/api/tools/kassir-api/search`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${AI_TOOLS_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const items = data?.data?.items || [];

    const fromDate = parseDateForComparison(dateFrom);
    const toDate = parseDateForComparison(dateTo);

    const violations = [];
    const parsedItems = items.map((item, index) => {
      const eventDate = extractEventDate(item);
      const passes = checkDateRange(eventDate, fromDate, toDate);

      if (!passes) {
        violations.push({ index: index + 1, eventDate, item });
      }

      return {
        index: index + 1,
        id: item?.object?.id || null,
        title: item?.object?.title || item?.object?.name || item?.activity?.title || 'Без названия',
        eventDate,
        rawDate: eventDate ? eventDate.toISOString() : 'Не удалось определить',
        passes,
      };
    });

    console.log(`\n📊 Получено событий: ${items.length}`);
    console.table(
      parsedItems.map(({ index, title, rawDate, passes }) => ({
        '#': index,
        Название: title,
        Дата: rawDate,
        'В диапазоне': passes ? '✅' : '❌',
      }))
    );

    if (violations.length > 0) {
      console.log('\n⚠️  Найдены события вне указанного диапазона:');
      violations.forEach(({ index, eventDate, item }) => {
        console.log(
          `  ${index}. ${item?.object?.title || 'Без названия'} – ${eventDate ? eventDate.toISOString() : 'дата неизвестна'}`
        );
      });
    } else {
      console.log('\n✅ Все события соответствуют заданному диапазону дат.');
    }
  } catch (error) {
    console.error('❌ Ошибка выполнения запроса:', error.message);
    process.exit(1);
  }
}

function checkDateRange(eventDate, fromDate, toDate) {
  if (!eventDate) return false;
  if (fromDate && eventDate < fromDate) return false;
  if (toDate && eventDate > new Date(toDate.getTime() + 24 * 60 * 60 * 1000)) return false;
  return true;
}

const isMainModule = (() => {
  if (!process.argv[1]) return false;
  const scriptPath = new URL(import.meta.url).pathname;
  const executedPath = new URL(`file://${process.argv[1]}`).pathname;
  return scriptPath === executedPath;
})();

if (isMainModule) {
  run();
}
