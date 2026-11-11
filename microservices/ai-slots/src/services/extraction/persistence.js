import { isLikelyArtistCandidate } from '../artistHeuristics.js';
import { isMetaPreferenceGenreValue } from '../../../../../shared/preferenceRules.js';
import { parseBudgetValue } from '../../../../../shared/moneyUtils.js';
import { isVagueArtistDescriptor } from '../../../../../shared/vagueArtistUtils.js';
import {
  isKnownEventTaxonomyValue,
  resolveEventTaxonomyGenreEntryByValue,
  resolveEventTaxonomyGenreEntryFromText,
} from '../../../../../shared/eventTaxonomy.js';
import {
  EVENT_TYPE_SLOT_NAMES,
  GENRE_SLOT_NAMES,
  BUDGET_PERSISTENCE_SLOT_NAMES,
  ARTIST_SLOT_NAMES,
  SLOT_PLACEHOLDER_VALUES,
  MOOD_SLOT_NAME,
} from './policy.js';
import { isCitySlotGrounded } from './cityGrounding.js';
import { isGenreSlotGrounded } from './genreGrounding.js';
import { normalizeGuardText, isTimeSlotName, isTimeSlotGrounded } from './timeGrounding.js';
import { isEventTypeSlotGrounded } from './eventGrounding.js';
import { isExplicitAnyBudgetValue } from './budget.js';

function sanitizeSlotsForPersistence(slots, sourceText = '') {
  const input = Array.isArray(slots) ? slots : [];
  if (input.length === 0) return [];

  const preferredCategory =
    input.find(
      (slot) =>
        slot &&
        typeof slot === 'object' &&
        EVENT_TYPE_SLOT_NAMES.has(String(slot.name || '').trim()) &&
        String(slot.value || '').trim()
    )?.value || '';

  input.forEach((slot) => {
    if (!slot || typeof slot !== 'object') {
      return;
    }

    const slotName = String(slot.name || '').trim();
    if (!EVENT_TYPE_SLOT_NAMES.has(slotName)) {
      return;
    }

    const taxonomyGenreEntry = resolveEventTaxonomyGenreEntryByValue(slot.value);
    if (!taxonomyGenreEntry) {
      return;
    }

    console.log(
      `[queueService] 🔁 Переназначаю слот ${slotName}="${slot.value}" в ${taxonomyGenreEntry.slotName}="${taxonomyGenreEntry.genre}" ` +
        `— значение похоже на жанр, а не на категорию`
    );
    slot.name = taxonomyGenreEntry.slotName;
    slot.value = taxonomyGenreEntry.genre;
    slot.source = slot.source ? `${slot.source}_taxonomy_rewrite` : 'taxonomy_rewrite';
  });

  input.forEach((slot) => {
    if (!slot || typeof slot !== 'object') {
      return;
    }

    const slotName = String(slot.name || '').trim();
    if (!GENRE_SLOT_NAMES.has(slotName)) {
      return;
    }

    const taxonomyGenreEntry =
      resolveEventTaxonomyGenreEntryByValue(slot.value, { preferredCategory }) ||
      resolveEventTaxonomyGenreEntryFromText(slot.value, { preferredCategory });

    if (!taxonomyGenreEntry) {
      return;
    }

    const normalizedOriginal = normalizeGuardText(slot.value);
    const normalizedGenre = normalizeGuardText(taxonomyGenreEntry.genre);
    const targetSlotName = taxonomyGenreEntry.slotName;
    if (normalizedOriginal === normalizedGenre && slotName === targetSlotName) {
      return;
    }

    console.log(
      `[queueService] 🔁 Нормализую слот ${slotName}="${slot.value}" в ${targetSlotName}="${taxonomyGenreEntry.genre}" ` +
        '— найден канонический жанр в составной фразе'
    );
    slot.name = targetSlotName;
    slot.value = taxonomyGenreEntry.genre;
    slot.source = slot.source
      ? `${slot.source}_taxonomy_phrase_rewrite`
      : 'taxonomy_phrase_rewrite';
  });

  const blockedArtistValues = collectBlockedArtistValues(input);

  return input.filter((slot) => {
    if (!slot || typeof slot !== 'object') {
      return false;
    }

    const slotName = String(slot.name || '').trim();
    if (isTimeSlotName(slotName) || slot.timeRange) {
      if (!isTimeSlotGrounded(slot, sourceText)) {
        console.log(
          `[queueService] 🚫 Игнорирую слот ${slotName}="${slot.value}" — время не подтверждено текстом запроса "${String(sourceText || '').trim()}"`
        );
        return false;
      }
    }

    if (EVENT_TYPE_SLOT_NAMES.has(slotName)) {
      if (!isEventTypeSlotGrounded(slot, sourceText)) {
        console.log(
          `[queueService] 🚫 Игнорирую слот ${slotName}="${slot.value}" — не подтвержден текстом запроса "${String(sourceText || '').trim()}"`
        );
        return false;
      }
    }

    if (GENRE_SLOT_NAMES.has(slotName)) {
      if (isMetaPreferenceGenreValue(slot.value)) {
        console.log(
          `[queueService] 🚫 Игнорирую слот ${slotName}="${slot.value}" — это ссылка на сохранённые предпочтения, а не реальный жанр`
        );
        return false;
      }

      if (!isGenreSlotGrounded(slot, sourceText)) {
        console.log(
          `[queueService] 🚫 Игнорирую слот ${slotName}="${slot.value}" — жанр не подтвержден текстом запроса "${String(sourceText || '').trim()}"`
        );
        return false;
      }
    }

    if (BUDGET_PERSISTENCE_SLOT_NAMES.has(slotName)) {
      if (isExplicitAnyBudgetValue(slot.value)) {
        return true;
      }

      const parsedBudget = parseBudgetValue(slot.value, { sourceText });
      if (!Number.isFinite(parsedBudget) || parsedBudget <= 0) {
        console.log(
          `[queueService] 🚫 Игнорирую слот ${slotName}="${String(slot.value ?? '')}" — значение бюджета невалидно`
        );
        return false;
      }

      slot.value = String(parsedBudget);
      if (slot.name === 'цена') {
        slot.name = 'цена_до';
      }
    }

    if (ARTIST_SLOT_NAMES.has(slotName)) {
      const artistValue = String(slot.value ?? '').trim();
      const normalizedArtistValue = normalizeGuardText(artistValue);
      if (!artistValue || SLOT_PLACEHOLDER_VALUES.has(normalizedArtistValue)) {
        console.log(
          `[queueService] 🚫 Игнорирую слот ${slotName}="${artistValue}" — placeholder вместо исполнителя`
        );
        return false;
      }
      if (isKnownEventTaxonomyValue(artistValue)) {
        console.log(
          `[queueService] 🚫 Игнорирую слот ${slotName}="${artistValue}" — значение совпадает с известным жанром/категорией из таксономии`
        );
        return false;
      }
      if (blockedArtistValues.has(normalizedArtistValue)) {
        console.log(
          `[queueService] 🚫 Игнорирую слот ${slotName}="${artistValue}" — значение конфликтует с датой/временем/жанром/категорией`
        );
        return false;
      }
      if (isVagueArtistDescriptor(artistValue)) {
        console.log(
          `[queueService] 🚫 Игнорирую слот ${slotName}="${artistValue}" — значение слишком расплывчато для конкретного исполнителя`
        );
        return false;
      }
      if (!isLikelyArtistCandidate(artistValue)) {
        console.log(
          `[queueService] 🚫 Игнорирую слот ${slotName}="${artistValue}" — значение похоже на локацию/жанр, а не на исполнителя`
        );
        return false;
      }
    }

    if (slotName !== 'город' || slot.value === undefined || slot.value === null) {
      return true;
    }

    const cityValue = String(slot.value).trim();
    if (!cityValue) {
      return false;
    }

    if (!isCitySlotGrounded(slot, sourceText)) {
      console.log(
        `[queueService] 🚫 Игнорирую слот города "${cityValue}" — город не подтвержден текстом запроса "${String(sourceText || '').trim()}"`
      );
      return false;
    }

    const cityValueLower = cityValue.toLowerCase();

    // Не сохраняем “псевдо-города”, которые означают “используй текущий город”.
    // Реальный город берём из домена/контекста на уровне planner/widget, а не из этого слота.
    const placeholderCityVariants = [
      'текущий город',
      'мой город',
      'моем городе',
      'моём городе',
      'в моем городе',
      'в моём городе',
      'своем городе',
      'своём городе',
      'в своем городе',
      'в своём городе',
      'нашем городе',
      'в нашем городе',
      'у нас в городе',
      'в родном городе',
    ];

    if (
      placeholderCityVariants.some(
        (variant) => cityValueLower === variant || cityValueLower.includes(variant)
      )
    ) {
      console.log(
        `[queueService] 🚫 Игнорирую слот города "${cityValue}" - это плейсхолдер, а не валидный город`
      );
      return false;
    }

    // Проверяем, не является ли это "Другой город" или его вариантами (только на русском)
    const otherCityVariants = [
      'другой город',
      'другом городе',
      'другого города',
      'другому городу',
      'другим городом',
      'иной город',
      'прочий город',
      'другой',
    ];

    if (otherCityVariants.some((variant) => cityValueLower === variant)) {
      console.log(
        `[queueService] 🚫 Игнорирую слот города "${cityValue}" - это не валидный город (точное совпадение)`
      );
      return false;
    }

    if (
      otherCityVariants.some(
        (variant) => cityValueLower.includes(variant) || variant.includes(cityValueLower)
      )
    ) {
      console.log(
        `[queueService] 🚫 Игнорирую слот города "${cityValue}" - это не валидный город (частичное совпадение)`
      );
      return false;
    }

    return true;
  });
}

function collectBlockedArtistValues(slots = []) {
  const target = new Set();
  const list = Array.isArray(slots) ? slots : [];

  for (const slot of list) {
    if (!slot || typeof slot !== 'object') {
      continue;
    }

    const slotName = String(slot.name || '').trim();
    if (ARTIST_SLOT_NAMES.has(slotName)) {
      continue;
    }

    if (!isSlotValueDisallowedForArtist(slot)) {
      continue;
    }

    const normalizedValue = normalizeGuardText(slot.value);
    if (normalizedValue) {
      target.add(normalizedValue);
    }
  }

  return target;
}

function isSlotValueDisallowedForArtist(slot) {
  const slotName = String(slot?.name || '')
    .trim()
    .toLowerCase();
  if (!slotName) {
    return false;
  }

  if (EVENT_TYPE_SLOT_NAMES.has(slotName) || GENRE_SLOT_NAMES.has(slotName)) {
    return true;
  }

  if (slotName.includes('дата') || slotName.includes('время')) {
    return true;
  }

  if (slotName === MOOD_SLOT_NAME || slotName === 'контекст_события') {
    return true;
  }

  return Boolean(slot?.parsedDate || slot?.dateRange || slot?.timeRange);
}

export { sanitizeSlotsForPersistence };
