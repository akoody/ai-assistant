import { describe, expect, test } from '@jest/globals';
import { isVagueRequest } from './slotsRequirementsService.js';

describe('slotsRequirementsService', () => {
  test('does not treat theater request as vague when performance genre is already inferred', () => {
    expect(
      isVagueRequest([
        { name: 'город', value: 'Нижний Новгород' },
        { name: 'тип_мероприятия', value: 'театры' },
        { name: 'жанр', value: 'спектакли' },
        { name: 'дата_события', value: 'на следующих выходных' },
      ])
    ).toEqual({
      isVague: false,
      missingDetails: [],
    });
  });

  test('still asks for more detail when theater request has only category and date', () => {
    expect(
      isVagueRequest([
        { name: 'город', value: 'Нижний Новгород' },
        { name: 'тип_мероприятия', value: 'театры' },
        { name: 'дата_события', value: 'на следующих выходных' },
      ])
    ).toMatchObject({
      isVague: true,
      missingDetails: expect.arrayContaining(['жанр']),
    });
  });
});
