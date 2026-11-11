import { describe, expect, test } from '@jest/globals';
import {
  buildPreferenceSlotsFromPreferences,
  detectPreferenceMemoryRequest,
  hasStoredPreferenceMemory,
  hasTastePreferenceMemory,
  isMeaningfulPreferenceSlotValue,
} from './preferenceMemoryService.js';
import {
  detectPreferenceMemorySignals,
  isMetaPreferenceGenreValue,
} from '../../../../shared/preferenceRules.js';

describe('preferenceMemoryService', () => {
  test('treats dislikes and city as stored memory', () => {
    expect(hasTastePreferenceMemory({ dislikedGenres: ['рок'] })).toBe(true);
    expect(hasStoredPreferenceMemory({ dislikedGenres: ['рок'] })).toBe(true);
    expect(hasStoredPreferenceMemory({ city: 'Москва' })).toBe(true);
  });

  test('injects negative taste preference slots from memory when only dislikes are available', () => {
    expect(
      buildPreferenceSlotsFromPreferences({
        userPreferences: {
          genres: [],
          artists: [],
          eventTypes: [],
          dislikedGenres: ['рок'],
          dislikedArtists: [],
          dislikedEventTypes: ['концерты'],
          priceRange: null,
          city: 'Москва',
        },
        existingSlots: [],
        memoryRequest: {
          wantsAnyPreferenceMemory: true,
          wantsGeneralPreferenceMemory: true,
          wantsTasteMemory: true,
          wantsGenreMemory: false,
          wantsBudgetMemory: false,
        },
      })
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'тип_мероприятия',
          value: 'концерты',
          isNegative: true,
          source: 'memory_preference',
        }),
        expect.objectContaining({
          name: 'предпочтения_жанры',
          value: 'рок',
          isNegative: true,
          source: 'memory_preference',
        }),
        expect.objectContaining({
          name: 'город',
          value: 'Москва',
          source: 'memory_preference',
        }),
      ])
    );
  });

  test('recognizes direct requests for remembered preferences with give verbs', () => {
    expect(detectPreferenceMemoryRequest('дай мне что я люблю')).toMatchObject({
      wantsAnyPreferenceMemory: true,
      wantsGeneralPreferenceMemory: true,
      wantsTasteMemory: true,
    });

    expect(detectPreferenceMemoryRequest('дайте то, что мне нравится')).toMatchObject({
      wantsAnyPreferenceMemory: true,
      wantsGeneralPreferenceMemory: true,
      wantsTasteMemory: true,
    });
  });

  test('does not treat plain taste statements as memory requests without an action cue', () => {
    expect(detectPreferenceMemoryRequest('я люблю рок')).toMatchObject({
      wantsAnyPreferenceMemory: false,
      wantsGeneralPreferenceMemory: false,
      wantsTasteMemory: false,
    });
  });

  test('recognizes remembered favorite genres request in plural phrasing', () => {
    expect(detectPreferenceMemoryRequest('Хочу в театр на свои любимые жанры')).toMatchObject({
      wantsAnyPreferenceMemory: true,
      wantsGenreMemory: true,
      wantsTasteMemory: true,
    });
  });

  test('recognizes remembered preferences requests through shared token heuristics', () => {
    expect(detectPreferenceMemoryRequest('Подбери что-нибудь по моим предпочтениям')).toMatchObject(
      {
        wantsAnyPreferenceMemory: true,
        wantsGeneralPreferenceMemory: true,
        wantsTasteMemory: true,
      }
    );

    expect(detectPreferenceMemoryRequest('Хочу в театр на свой любимый жанр')).toMatchObject({
      wantsAnyPreferenceMemory: true,
      wantsGenreMemory: true,
      wantsTasteMemory: true,
    });

    expect(
      detectPreferenceMemorySignals('Покажи что-нибудь в моем ценовом диапазоне')
    ).toMatchObject({
      wantsAnyPreferenceMemory: true,
      wantsBudgetMemory: true,
    });
  });

  test('injects all stored genres from memory when genre memory is requested', () => {
    expect(
      buildPreferenceSlotsFromPreferences({
        userPreferences: {
          genres: ['мюзикл', 'балет'],
          artists: [],
          eventTypes: ['театры'],
          dislikedGenres: [],
          dislikedArtists: [],
          dislikedEventTypes: [],
          priceRange: null,
          city: 'Нижний Новгород',
        },
        existingSlots: [{ name: 'тип_мероприятия', value: 'театры' }],
        memoryRequest: {
          wantsAnyPreferenceMemory: true,
          wantsGeneralPreferenceMemory: false,
          wantsTasteMemory: true,
          wantsGenreMemory: true,
          wantsBudgetMemory: false,
        },
      })
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'предпочтения_жанры',
          value: 'мюзикл',
          source: 'memory_preference',
        }),
        expect.objectContaining({
          name: 'предпочтения_жанры',
          value: 'балет',
          source: 'memory_preference',
        }),
      ])
    );
  });

  test('treats favorite-genre meta references as non-meaningful genre slots', () => {
    expect(isMeaningfulPreferenceSlotValue('жанр', 'любимый жанр')).toBe(false);
    expect(isMeaningfulPreferenceSlotValue('жанр', 'свой любимый жанр')).toBe(false);
    expect(isMeaningfulPreferenceSlotValue('жанр', 'любимые жанры')).toBe(false);
    expect(isMeaningfulPreferenceSlotValue('жанр', 'жанры, которые мне нравятся')).toBe(false);
  });

  test('shared meta-genre helper rejects placeholders and keeps explicit genres', () => {
    expect(isMetaPreferenceGenreValue('любимый жанр')).toBe(true);
    expect(isMetaPreferenceGenreValue('то, что мне нравится')).toBe(true);
    expect(isMetaPreferenceGenreValue('жанры, которые мне нравятся')).toBe(true);
    expect(isMetaPreferenceGenreValue('драма')).toBe(false);
    expect(isMetaPreferenceGenreValue('современная драма')).toBe(false);
  });

  test('still injects stored genres when current slot is only a meta favorite-genre reference', () => {
    expect(
      buildPreferenceSlotsFromPreferences({
        userPreferences: {
          genres: ['драма', 'балет'],
          artists: [],
          eventTypes: ['театры'],
          dislikedGenres: [],
          dislikedArtists: [],
          dislikedEventTypes: [],
          priceRange: null,
          city: 'Нижний Новгород',
        },
        existingSlots: [
          { name: 'тип_мероприятия', value: 'театры' },
          { name: 'жанр', value: 'любимый жанр' },
        ],
        memoryRequest: {
          wantsAnyPreferenceMemory: true,
          wantsGeneralPreferenceMemory: false,
          wantsTasteMemory: true,
          wantsGenreMemory: true,
          wantsBudgetMemory: false,
        },
      }).map((slot) => `${slot.name}:${slot.value}`)
    ).toEqual(expect.arrayContaining(['предпочтения_жанры:драма', 'предпочтения_жанры:балет']));
  });
});
