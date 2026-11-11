// Тест фильтра цен Kassir API через AI Tools
// Проверяет, приходят ли события дороже заданного порога в текущем формате сбора

import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Локальный импорт через динамический путь (ESM)
import { getAiToolsUrl, getAiToolsApiKey } from '../src/services/configService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Порог цены в рублях (ожидается, что события не должны превышать его)
const PRICE_THRESHOLD = 1000;

// Параметры запроса из кейса пользователя
const params = {
  keyword: 'концерт',
  date_from: '05.11.2025',
  domain: 'msk.kassir.ru',
  slug: '/category/',
  sort: 0,
  platformState: 'website',
  page: 1,
  price_to: 2, // до 1000 рублей
};

function extractPriceRange(item) {
  // Пытаемся вытащить цены из разных возможных мест
  const obj = item.object || item;
  const activity = obj.activity || {};

  let min = null;
  let max = null;

  if (obj.priceRange) {
    min = obj.priceRange.min ?? min;
    max = obj.priceRange.max ?? max;
  }
  if ((min == null || max == null) && activity.priceRange) {
    min = activity.priceRange.min ?? min;
    max = activity.priceRange.max ?? max;
  }
  if ((min == null || max == null) && item.priceRange) {
    min = item.priceRange.min ?? min;
    max = item.priceRange.max ?? max;
  }

  // Иногда цена приходит внутри venue.priceRange — проигнорируем для задачи фильтра событий
  return { min, max };
}

function extractTitle(item) {
  const obj = item.object || item;
  return (
    obj.title ||
    obj.name ||
    obj.activity?.title ||
    obj.activity?.name ||
    item.title ||
    item.name ||
    'Без названия'
  );
}

function extractBeginsAt(item) {
  const obj = item.object || item;
  return (
    obj.dateRange?.beginsAt ||
    obj.beginsAt ||
    obj.activity?.dateRange?.beginsAt ||
    item.dateRange?.beginsAt ||
    null
  );
}

async function main() {
  const aiToolsUrl = getAiToolsUrl();
  const apiKey = getAiToolsApiKey();

  console.log('🔎 Тест фильтра цен Kassir API');
  console.log('🌐 AI Tools:', aiToolsUrl);
  console.log('🧪 Параметры:', JSON.stringify(params));
  console.log('💰 Порог цены:', PRICE_THRESHOLD);

  const resp = await fetch(`${aiToolsUrl}/api/tools/kassir-api/search`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(params),
  });

  if (!resp.ok) {
    const err = await resp.text();
    console.error('❌ Ошибка AI Tools:', resp.status, err);
    process.exit(1);
  }

  const data = await resp.json();
  const items = data?.data?.items || [];
  console.log(`✅ Получено событий: ${items.length}`);

  // Проверяем нарушения по цене
  const violations = [];
  const report = items.map((it, idx) => {
    const { min, max } = extractPriceRange(it);
    const beginsAt = extractBeginsAt(it);
    const title = extractTitle(it);

    const overMin = min != null && min > PRICE_THRESHOLD;
    const overMax = max != null && max > PRICE_THRESHOLD;

    if (overMin || overMax) {
      violations.push({ index: idx + 1, title, min, max, beginsAt });
    }

    return { index: idx + 1, title, min, max, beginsAt };
  });

  console.log('\n📄 Отчет по событиям (цены):');
  report.forEach((r) => {
    console.log(
      `  ${r.index}. ${r.title} | min: ${r.min ?? '—'} | max: ${r.max ?? '—'} | beginsAt: ${r.beginsAt ?? '—'}`
    );
  });

  console.log('\n🚦 Нарушения (цена > порога):', violations.length);
  if (violations.length > 0) {
    violations.slice(0, 5).forEach((v) => {
      console.log(
        `  ⚠️ ${v.index}. ${v.title} | min: ${v.min ?? '—'} | max: ${v.max ?? '—'} | beginsAt: ${v.beginsAt ?? '—'}`
      );
    });
  }

  // Итог
  if (violations.length === 0) {
    console.log(
      '\n✅ Kassir API (через AI Tools) не вернул событий дороже порога по явным полям priceRange.'
    );
  } else {
    console.log(
      '\n❗ Kassir API (через AI Tools) вернул события с ценой выше порога. Требуется уточнить серверные фильтры или клиентскую фильтрацию.'
    );
  }
}

main().catch((err) => {
  console.error('❌ Ошибка выполнения теста:', err);
  process.exit(1);
});
