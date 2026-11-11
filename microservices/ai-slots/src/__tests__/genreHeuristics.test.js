import { describe, expect, test } from '@jest/globals';
import { resolveHeuristicGenreSlot } from '../services/genreHeuristics.js';

describe('genreHeuristics', () => {
  test('infers theater genre from explicit performance wording', () => {
    expect(
      resolveHeuristicGenreSlot('Хочу на следующих выходных на какой-нибудь спектакль', [
        { name: 'тип_мероприятия', value: 'театры' },
      ])
    ).toMatchObject({
      name: 'жанр',
      value: 'спектакли',
      source: 'heuristic_genre',
    });
  });

  test('infers specific theater subgenre when user names it', () => {
    expect(
      resolveHeuristicGenreSlot('Хочу на комедию в театре', [
        { name: 'тип_мероприятия', value: 'театры' },
      ])
    ).toMatchObject({
      name: 'жанр',
      value: 'комедия',
      source: 'heuristic_genre',
    });
  });

  test('does not invent theater genre from generic theater category word', () => {
    expect(
      resolveHeuristicGenreSlot('Хочу в театр на выходных', [
        { name: 'тип_мероприятия', value: 'театры' },
      ])
    ).toBeNull();
  });

  test('infers concert club genre from club wording', () => {
    expect(
      resolveHeuristicGenreSlot('Хочу что-нибудь клубное в субботу', [
        { name: 'тип_мероприятия', value: 'концерты' },
      ])
    ).toMatchObject({
      name: 'жанр',
      value: 'клубы',
      source: 'heuristic_genre',
    });
  });
});
