import { describe, expect, test } from '@jest/globals';
import { isGenreSlotGrounded, sanitizeSlotsForPersistence } from '../services/queueService.js';

describe('genre grounding', () => {
  test('rejects hallucinated overview genre for standalone planetarium request', () => {
    expect(isGenreSlotGrounded({ name: 'жанр', value: 'обзорные' }, 'Планетарий')).toBe(false);
  });

  test('accepts explicit overview genre when user actually mentions it', () => {
    expect(
      isGenreSlotGrounded({ name: 'жанр', value: 'обзорные' }, 'Хочу обзорную экскурсию')
    ).toBe(true);
  });

  test('accepts humor genre when laughter intent is expressed without explicit genre token', () => {
    expect(
      isGenreSlotGrounded({ name: 'жанр', value: 'юмор' }, 'Хочу где-то посмеяться с семьёй')
    ).toBe(true);
  });

  test('accepts canonical rap genre when user explicitly asks for hip-hop', () => {
    expect(isGenreSlotGrounded({ name: 'жанр_музыки', value: 'рэп' }, 'Хип-хоп')).toBe(true);
  });

  test('accepts hip-hop genre when user explicitly asks for rap', () => {
    expect(isGenreSlotGrounded({ name: 'жанр_музыки', value: 'хип-хоп' }, 'Хочу рэп концерт')).toBe(
      true
    );
  });

  test('normalizes composite theater genre phrase to canonical taxonomy genre', () => {
    const sanitized = sanitizeSlotsForPersistence(
      [
        { name: 'тип_мероприятия', value: 'театры' },
        { name: 'жанр', value: 'популярные спектакли' },
      ],
      'Хочу на популярный спектакль'
    );

    expect(sanitized).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'жанр', value: 'спектакли' }),
        expect.objectContaining({ name: 'тип_мероприятия', value: 'театры' }),
      ])
    );
  });
});
