// Примерная оценка токенов для 5 мероприятий в формате JSON с описаниями

// Пример одного мероприятия (на основе реальной структуры)
const exampleEvent = {
  basics: [
    {
      key: 'object.title',
      value: '[NS] Мероприятие для СБП билеты по 1р',
      description:
        'Название события. Это первое, что ищет пользователь, чтобы понять, о каком мероприятии идет речь.',
    },
    {
      key: 'object.description',
      value: '[NS] Мероприятие для СБП билеты по 1р',
      description:
        'Краткое описание содержания мероприятия. Помогает быстро понять формат, жанр и особенности и решить, интересно ли.',
    },
    {
      key: 'object.category.name',
      value: 'Концерт',
      description:
        'Основная категория события (например, Концерт, Театр). Нужна для фильтрации и навигации по интересующему типу мероприятий.',
    },
    {
      key: 'object.extraCategories[].name',
      value: ['Рок'],
      description:
        'Дополнительные подкатегории/жанры. Уточняют жанр (например, Рок, Классика) и помогают точнее искать и сравнивать.',
    },
    {
      key: 'type',
      value: 'activity',
      description:
        'Тип карточки сущности (например, событие/активность). Полезно, чтобы отличать мероприятия от площадок или коллекций и применять нужные фильтры/вид отображения.',
    },
  ],
  dates: [
    {
      key: 'object.dateRange.beginsAt',
      value: '2025-10-24T19:00:00+00:00',
      description:
        'Дата и время начала периода проведения мероприятия. Чтобы понять, с какой даты можно пойти и когда ближайшая дата.',
    },
    {
      key: 'object.dateRange.endsAt',
      value: '2027-09-18T15:00:00+00:00',
      description:
        'Дата и время окончания периода проведения. Нужно для планирования: до какого числа можно успеть купить билеты и посетить.',
    },
    {
      key: 'object.isMultiDay',
      value: true,
      description:
        'Признак, что мероприятие идет в несколько дат/сеансов. Если дат много, пользователь ожидает выбор конкретной даты и времени.',
    },
    {
      key: 'object.eventDurationRange',
      value: null,
      description:
        'Оценочная длительность события. Нужно для планирования времени дороги, ужина, позднего возвращения и пр.',
    },
  ],
  pricing: [
    {
      key: 'object.priceRange.min',
      value: 1,
      description:
        'Минимальная цена билета. Помогает понять «входной порог» и подходит ли событие под бюджет.',
    },
    {
      key: 'object.priceRange.max',
      value: 300,
      description:
        'Максимальная цена билета. Важно для оценки доступности лучших мест и общего диапазона стоимости.',
    },
  ],
  availability: [],
  venue: [
    {
      key: 'object.venues[0].name',
      value: 'Новые схемы',
      description:
        'Название площадки. Ориентир для понимания уровня и расположения места проведения.',
    },
    {
      key: 'object.venues[0].address.addressString',
      value: 'Санкт-Петербург, Московский проспект, 2/6',
      description:
        'Полный адрес площадки одной строкой. Нужен для навигации и оценки логистики — далеко или близко, какой район.',
    },
    {
      key: 'object.venues[0].address.city',
      value: null,
      description:
        'Город проведения. Ключевой фильтр для пользователей, выбирающих события в своем городе.',
    },
    {
      key: 'object.venues[0].address.subways',
      value: null,
      description:
        'Ближайшие станции метро. Помогает оценить удобство добирания общественным транспортом.',
    },
  ],
  restrictions: [
    {
      key: 'object.ageGroups',
      value: [],
      description:
        'Возрастные ограничения или рекомендованные группы. Важно для посещения с детьми и соблюдения правил допуска.',
    },
    {
      key: 'object.isPushkin',
      value: false,
      description:
        'Поддерживается ли оплата по Пушкинской карте. Студентам и школьникам это критично для выбора мероприятия.',
    },
    {
      key: 'object.needPersonalData',
      value: false,
      description:
        'Потребуются ли персональные данные (паспорт и т. п.) при покупке или входе. Чтобы заранее подготовить документы и избежать отказа во входе.',
    },
  ],
  media: [
    {
      key: 'object.posterImage',
      value: 'https://cdn.kassir.ru/msk/poster/1a/1a0c5f83986a6e799c6c49b4ef5b81e3.jpg',
      description:
        'Ссылка на постер мероприятия. Визуальная идентификация повышает доверие и помогает запомнить событие.',
    },
  ],
  links: [
    {
      key: 'object.url',
      value: 'https://msk.stg.kassirdev.ru/koncert/ns-meropriyatie-dlya-sbp-biletyi-po-1r',
      description:
        'Полная ссылка на страницу события. Главная точка входа для покупки билетов и детальной информации.',
    },
  ],
};

// Формируем текст для одного мероприятия
const header = 'Мероприятие 1:\n```json\n';
const footer = '\n```\n\n';

const jsonString = JSON.stringify(exampleEvent, null, 2);
const oneEventText = header + jsonString + footer;

// Подсчитываем размеры
const oneEventChars = oneEventText.length;
const oneEventWords = oneEventText.split(/\s+/).length;

// Для 5 мероприятий
const fiveEventsText =
  'Полная информация о мероприятиях (если пользователь спросил):\n\n' +
  oneEventText.replace('1', '1') +
  oneEventText.replace('1', '2') +
  oneEventText.replace('1', '3') +
  oneEventText.replace('1', '4') +
  oneEventText.replace('1', '5');

const fiveEventsChars = fiveEventsText.length;
const fiveEventsWords = fiveEventsText.split(/\s+/).length;

// Оценка токенов:
// - Для английского: ~1 токен = 4 символа или 0.75 слова
// - Для русского: ~1 токен = 2-3 символа или 0.5-0.7 слова (из-за кириллицы)
// - JSON структура: ~1 токен = 3-4 символа

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📊 ОЦЕНКА ТОКЕНОВ ДЛЯ 5 МЕРОПРИЯТИЙ');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

console.log('Одно мероприятие:');
console.log(`  - Символов: ${oneEventChars.toLocaleString()}`);
console.log(`  - Слов: ${oneEventWords.toLocaleString()}`);
console.log(`  - Токенов (по символам, русский): ~${Math.round(oneEventChars / 2.5)}`);
console.log(`  - Токенов (по словам, русский): ~${Math.round(oneEventWords / 0.6)}`);
console.log(`  - Токенов (JSON структура): ~${Math.round(oneEventChars / 3.5)}\n`);

console.log('Пять мероприятий:');
console.log(`  - Символов: ${fiveEventsChars.toLocaleString()}`);
console.log(`  - Слов: ${fiveEventsWords.toLocaleString()}`);
console.log(`  - Токенов (по символам, русский): ~${Math.round(fiveEventsChars / 2.5)}`);
console.log(`  - Токенов (по словам, русский): ~${Math.round(fiveEventsWords / 0.6)}`);
console.log(`  - Токенов (JSON структура): ~${Math.round(fiveEventsChars / 3.5)}\n`);

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📋 ИТОГОВАЯ ОЦЕНКА:');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

const avgTokens = Math.round(
  (fiveEventsChars / 2.5 + fiveEventsWords / 0.6 + fiveEventsChars / 3.5) / 3
);
console.log(
  `Примерное количество токенов для 5 мероприятий: ~${avgTokens.toLocaleString()} токенов`
);
console.log(
  `(диапазон: ${Math.round(fiveEventsChars / 3.5).toLocaleString()} - ${Math.round(fiveEventsChars / 2.5).toLocaleString()} токенов)\n`
);

console.log('Пример первых 500 символов JSON для одного мероприятия:');
console.log(jsonString.substring(0, 500) + '...\n');
