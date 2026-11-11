/**
 * Декодирует HTML-сущности в тексте
 * @param {string} text - Текст с HTML-сущностями
 * @returns {string} Текст с декодированными сущностями
 */
function decodeHtmlEntities(text) {
  if (!text || typeof text !== 'string') {
    return text;
  }

  const entityMap = {
    '&laquo;': '«',
    '&raquo;': '»',
    '&ldquo;': '“',
    '&rdquo;': '”',
    '&lsquo;': '‘',
    '&rsquo;': '’',
    '&quot;': '"',
    '&apos;': "'",
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&mdash;': '—',
    '&ndash;': '–',
    '&nbsp;': ' ',
    '&hellip;': '…',
    '&copy;': '©',
    '&reg;': '®',
    '&trade;': '™',
    '&euro;': '€',
    '&pound;': '£',
    '&yen;': '¥',
    '&cent;': '¢',
  };

  // Сначала декодируем именованные сущности
  let decoded = text;
  for (const [entity, char] of Object.entries(entityMap)) {
    decoded = decoded.replace(new RegExp(entity, 'gi'), char);
  }

  // Затем декодируем числовые сущности (&#123; и &#x1F;)
  decoded = decoded.replace(/&#(\d+);/g, (match, num) => {
    return String.fromCharCode(parseInt(num, 10));
  });

  decoded = decoded.replace(/&#x([0-9A-Fa-f]+);/g, (match, hex) => {
    return String.fromCharCode(parseInt(hex, 16));
  });

  return decoded;
}

/**
 * Формирует структурированную информацию о событии из исходного объекта
 * @param {Object} rawEvent - Исходное событие из API (может быть нормализованное или из истории)
 * @param {Object} originalEvent - Оригинальное событие из API (если доступно)
 * @returns {Object} Структурированная информация
 */
export function structureEventInfo(rawEvent, originalEvent = null) {
  // Если есть оригинальное событие (из API), используем его полную структуру
  // Иначе используем нормализованное событие (rawEvent)
  const eventObj = originalEvent?.object || null;

  // Извлекаем категорию (из оригинального или из нормализованного - нет в нормализованном)
  const categoryName = eventObj?.category?.name || null;
  const extraCategories = eventObj?.extraCategories?.map((cat) => cat.name) || [];

  // Извлекаем информацию о площадках
  let venuesInfo = [];
  if (eventObj?.venues && Array.isArray(eventObj.venues)) {
    venuesInfo = eventObj.venues.map((venue) => ({
      name: venue.name || null,
      address: {
        addressString: venue.address?.addressString || null,
        city: venue.address?.city || rawEvent.city || null, // Используем city из нормализованного
        subways: venue.address?.subways || null,
      },
    }));
  } else if (rawEvent.venue) {
    // Если есть только нормализованное поле venue (строка)
    venuesInfo = [
      {
        name: rawEvent.venue,
        address: {
          addressString: null,
          city: rawEvent.city || null,
          subways: null,
        },
      },
    ];
  }

  // Извлекаем возрастные ограничения (только из оригинального)
  const ageGroups = eventObj?.ageGroups || [];

  return {
    basics: [
      {
        key: 'object.title',
        value: eventObj?.title || rawEvent.title || null,
        description:
          'Название события. Это первое, что ищет пользователь, чтобы понять, о каком мероприятии идет речь.',
      },
      {
        key: 'object.description',
        value: eventObj?.description || rawEvent.description || null,
        description:
          'Краткое описание содержания мероприятия. Помогает быстро понять формат, жанр и особенности и решить, интересно ли.',
      },
      {
        key: 'object.category.name',
        value: categoryName,
        description:
          'Основная категория события (например, Концерт, Театр). Нужна для фильтрации и навигации по интересующему типу мероприятий.',
      },
      {
        key: 'object.extraCategories[].name',
        value: extraCategories,
        description:
          'Дополнительные подкатегории/жанры. Уточняют жанр (например, Рок, Классика) и помогают точнее искать и сравнивать.',
      },
      {
        key: 'type',
        value: originalEvent?.type || 'event',
        description:
          'Тип карточки сущности (например, событие/активность). Полезно, чтобы отличать мероприятия от площадок или коллекций и применять нужные фильтры/вид отображения.',
      },
    ],
    dates: [
      {
        key: 'object.dateRange.beginsAt',
        value:
          eventObj?.dateRange?.beginsAt ||
          eventObj?.beginsAt ||
          (rawEvent.date
            ? `${rawEvent.date}${rawEvent.time ? 'T' + rawEvent.time + ':00' : ''}`
            : null) ||
          null,
        description:
          'Дата и время начала периода проведения мероприятия. Чтобы понять, с какой даты можно пойти и когда ближайшая дата.',
      },
      {
        key: 'object.dateRange.endsAt',
        value: eventObj?.dateRange?.endsAt || eventObj?.endsAt || null,
        description:
          'Дата и время окончания периода проведения. Нужно для планирования: до какого числа можно успеть купить билеты и посетить.',
      },
      {
        key: 'object.isMultiDay',
        value: eventObj?.isMultiDay || false,
        description:
          'Признак, что мероприятие идет в несколько дат/сеансов. Если дат много, пользователь ожидает выбор конкретной даты и времени.',
      },
      {
        key: 'object.eventDurationRange',
        value: eventObj?.eventDurationRange || null,
        description:
          'Оценочная длительность события. Нужно для планирования времени дороги, ужина, позднего возвращения и пр.',
      },
    ],
    pricing: [
      {
        key: 'object.priceRange.min',
        value: eventObj?.priceRange?.min ?? rawEvent.priceMin ?? null,
        description:
          'Минимальная цена билета. Помогает понять «входной порог» и подходит ли событие под бюджет.',
      },
      {
        key: 'object.priceRange.max',
        value: eventObj?.priceRange?.max ?? rawEvent.priceMax ?? null,
        description:
          'Максимальная цена билета. Важно для оценки доступности лучших мест и общего диапазона стоимости.',
      },
    ],
    availability: [],
    venue: venuesInfo
      .map((venue, idx) => [
        {
          key: `object.venues[${idx}].name`,
          value: venue.name,
          description:
            'Название площадки. Ориентир для понимания уровня и расположения места проведения.',
        },
        {
          key: `object.venues[${idx}].address.addressString`,
          value: venue.address.addressString,
          description:
            'Полный адрес площадки одной строкой. Нужен для навигации и оценки логистики — далеко или близко, какой район.',
        },
        {
          key: `object.venues[${idx}].address.city`,
          value: venue.address.city,
          description:
            'Город проведения. Ключевой фильтр для пользователей, выбирающих события в своем городе.',
        },
        {
          key: `object.venues[${idx}].address.subways`,
          value: venue.address.subways,
          description:
            'Ближайшие станции метро. Помогает оценить удобство добирания общественным транспортом.',
        },
      ])
      .flat(),
    restrictions: [
      {
        key: 'object.ageGroups',
        value: ageGroups,
        description:
          'Возрастные ограничения или рекомендованные группы. Важно для посещения с детьми и соблюдения правил допуска.',
      },
      {
        key: 'object.isPushkin',
        value: eventObj?.isPushkin || false,
        description:
          'Поддерживается ли оплата по Пушкинской карте. Студентам и школьникам это критично для выбора мероприятия.',
      },
      {
        key: 'object.needPersonalData',
        value: eventObj?.needPersonalData || false,
        description:
          'Потребуются ли персональные данные (паспорт и т. п.) при покупке или входе. Чтобы заранее подготовить документы и избежать отказа во входе.',
      },
    ],
    media: [
      {
        key: 'object.posterImage',
        value: eventObj?.posterImage || rawEvent.posterImage || null,
        description:
          'Ссылка на постер мероприятия. Визуальная идентификация повышает доверие и помогает запомнить событие.',
      },
    ],
    links: [
      {
        key: 'object.url',
        value: eventObj?.url || rawEvent.url || null,
        description:
          'Полная ссылка на страницу события. Главная точка входа для покупки билетов и детальной информации.',
      },
    ],
  };
}

/**
 * Формирует JSON информацию о событиях
 * @param {Array} events - Массив событий (нормализованных или из истории)
 * @param {Array} originalEvents - Массив оригинальных событий из API (если доступны)
 * @returns {string} Форматированная строка с JSON
 */
export function formatEventsJsonInfo(events, originalEvents = null) {
  if (!events || events.length === 0) {
    return '';
  }

  let eventsJsonInfo = '\n\nПолная информация о мероприятиях (если пользователь спросил):\n\n';

  events.forEach((event, index) => {
    // Если есть оригинальные события, используем их для получения полной структуры
    const originalEvent = originalEvents && originalEvents[index] ? originalEvents[index] : null;

    const structuredInfo = structureEventInfo(event, originalEvent);

    eventsJsonInfo += `Мероприятие ${index + 1}:\n`;
    eventsJsonInfo += '```json\n';
    eventsJsonInfo += JSON.stringify(structuredInfo, null, 2);
    eventsJsonInfo += '\n```\n\n';
  });

  return eventsJsonInfo;
}

/**
 * Формирует компактный JSON со сведениями о событиях для промпта детализации
 * @param {Array} events - Нормализованные события (из offerService)
 * @param {Array|null} originalEvents - Оригинальные события из API (если доступны)
 * @returns {string} JSON-строка
 */
export function formatEventDetailsForPrompt(events, originalEvents = null) {
  if (!events || events.length === 0) {
    return '[]';
  }

  const payload = events.map((event, index) => {
    const baseInfo = {
      index: index + 1,
      id: event.id ?? null,
      title: event.title ?? null,
      date: event.date ?? null,
      time: event.time ?? null,
      venue: event.venue ?? null,
      city: event.city ?? null,
      priceMin: event.priceMin ?? null,
      priceMax: event.priceMax ?? null,
      url: event.url ?? null,
      description: event.description ?? null,
      posterImage: event.posterImage ?? null,
    };

    const originalWrapper = originalEvents && originalEvents[index] ? originalEvents[index] : null;
    const original = originalWrapper?.object || originalWrapper || null;

    if (original) {
      if (original.description && typeof original.description === 'string') {
        const cleanDescription = decodeHtmlEntities(
          original.description.replace(/<[^>]*>/g, '').trim()
        );
        if (cleanDescription && cleanDescription.length > 0) {
          baseInfo.description = cleanDescription;
        }
      }

      baseInfo.ageRestriction =
        original.ageRestriction ||
        original.ageLimit ||
        (Array.isArray(original.ageGroups) && original.ageGroups.length > 0
          ? original.ageGroups[0]?.code || original.ageGroups[0]?.value
          : null) ||
        null;
      baseInfo.duration = original.eventDurationRange || original.duration || null;
      baseInfo.isPushkinCard = original.isPushkin ?? original.pushkinCard ?? null;

      if (Array.isArray(original.venues) && original.venues.length > 0) {
        const venue = original.venues[0];
        baseInfo.venueFullName = venue.name || null;
        baseInfo.venueAddress = venue.address?.addressString || null;
        baseInfo.venueSubways = venue.address?.subways || null;
      }
    }

    return baseInfo;
  });

  return JSON.stringify(payload, null, 2);
}
