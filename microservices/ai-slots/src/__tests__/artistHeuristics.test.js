import { describe, expect, test } from '@jest/globals';
import {
  isLikelyArtistCandidate,
  resolveHeuristicArtistSlot,
} from '../services/artistHeuristics.js';

describe('artistHeuristics', () => {
  test('does not create artist slot from location choice phrase', () => {
    expect(resolveHeuristicArtistSlot('Хочу на рок концерт в москве или питере', [])).toBeNull();
  });

  test('does not create artist slot from event type with location', () => {
    expect(resolveHeuristicArtistSlot('Привет хочу на концерт в питере', [])).toBeNull();
  });

  test('does not create artist slot from multiword city location', () => {
    expect(resolveHeuristicArtistSlot('Хочу на концерт в Нижнем Новгороде', [])).toBeNull();
  });

  test('keeps artist name when location is appended', () => {
    expect(resolveHeuristicArtistSlot('Хочу на Басту в Москве', [])).toMatchObject({
      name: 'исполнитель',
      value: 'Басту',
      source: 'heuristic_artist',
    });
  });

  test('rejects bare location phrases as artist candidates', () => {
    expect(isLikelyArtistCandidate('в москве')).toBe(false);
    expect(isLikelyArtistCandidate('в москве или питере')).toBe(false);
  });

  test('does not treat opera request as artist name', () => {
    expect(isLikelyArtistCandidate('Оперу')).toBe(false);
    expect(resolveHeuristicArtistSlot('Привет, хочу на Оперу в МСК или Питере', [])).toBeNull();
  });

  test('does not treat placeholder values as artist names', () => {
    expect(isLikelyArtistCandidate('не указано')).toBe(false);
    expect(isLikelyArtistCandidate('unknown')).toBe(false);
  });

  test('does not treat vague artist descriptions as artist names', () => {
    expect(isLikelyArtistCandidate('очень популярный артист')).toBe(false);
    expect(isLikelyArtistCandidate('известный исполнитель')).toBe(false);
    expect(
      resolveHeuristicArtistSlot(
        'В Нижний Новгород должен приехать очень популярный артист, но я не помню кто',
        []
      )
    ).toBeNull();
  });

  test('does not treat preference-memory phrasing as artist name', () => {
    expect(isLikelyArtistCandidate('моего любимого жанра')).toBe(false);
    expect(isLikelyArtistCandidate('по моим предпочтениям')).toBe(false);
    expect(resolveHeuristicArtistSlot('Концерт моего любимого жанра', [])).toBeNull();
    expect(resolveHeuristicArtistSlot('Подбери концерт по моим предпочтениям', [])).toBeNull();
  });

  test('does not treat date-like phrases as artist names', () => {
    expect(isLikelyArtistCandidate('11-12 апреля')).toBe(false);
    expect(isLikelyArtistCandidate('11 апреля')).toBe(false);
    expect(isLikelyArtistCandidate('11.04.2026')).toBe(false);
    expect(isLikelyArtistCandidate('в апреле')).toBe(false);
    expect(isLikelyArtistCandidate('май')).toBe(false);
    expect(
      resolveHeuristicArtistSlot('Привет, порекомендуй рок концерт на 11-12 апреля', [])
    ).toBeNull();
    expect(resolveHeuristicArtistSlot('Хочу на концерт 11 апреля', [])).toBeNull();
    expect(resolveHeuristicArtistSlot('Хочу на концерт в апреле', [])).toBeNull();
  });

  test('does not treat child age phrases as artist names', () => {
    expect(isLikelyArtistCandidate('6+')).toBe(false);
    expect(isLikelyArtistCandidate('6+, можно 4 года')).toBe(false);
    expect(isLikelyArtistCandidate('от 6 лет')).toBe(false);
    expect(isLikelyArtistCandidate('до 6 лет')).toBe(false);
  });

  test('does not treat weekdays as artist names', () => {
    expect(isLikelyArtistCandidate('в субботу')).toBe(false);
    expect(isLikelyArtistCandidate('понедельник')).toBe(false);
    expect(resolveHeuristicArtistSlot('Хочу на концерт в субботу', [])).toBeNull();
    expect(resolveHeuristicArtistSlot('Ищу рок концерт в пятницу', [])).toBeNull();
  });

  test('does not treat relative date phrases as artist names', () => {
    expect(isLikelyArtistCandidate('через 2 недели')).toBe(false);
    expect(isLikelyArtistCandidate('через две недели')).toBe(false);
    expect(isLikelyArtistCandidate('через месяц')).toBe(false);
    expect(isLikelyArtistCandidate('следующих выходных')).toBe(false);
    expect(isLikelyArtistCandidate('на следующих выходных')).toBe(false);
    expect(resolveHeuristicArtistSlot('Хочу на рок концерт через 2 недели', [])).toBeNull();
    expect(resolveHeuristicArtistSlot('Реп концерт через месяц', [])).toBeNull();
    expect(
      resolveHeuristicArtistSlot('Хочу на следующих выходных на какой-нибудь спектакль', [])
    ).toBeNull();
  });

  test('does not treat common categories and genres as artist names', () => {
    expect(resolveHeuristicArtistSlot('Хочу на джаз в Москве', [])).toBeNull();
    expect(resolveHeuristicArtistSlot('Хочу на балет в Питере', [])).toBeNull();
    expect(resolveHeuristicArtistSlot('Хочу на танцы', [])).toBeNull();
    expect(resolveHeuristicArtistSlot('Хочу на танец', [])).toBeNull();
    expect(resolveHeuristicArtistSlot('Хочу на мастер-классы', [])).toBeNull();
    expect(resolveHeuristicArtistSlot('Хочу на стендап в Москве', [])).toBeNull();
    expect(resolveHeuristicArtistSlot('Хочу на выставку в Москве', [])).toBeNull();
    expect(resolveHeuristicArtistSlot('Хочу на экскурсию в Питере', [])).toBeNull();
    expect(resolveHeuristicArtistSlot('Хочу на какой-нибудь спектакль', [])).toBeNull();
  });

  test('does not create artist slot when candidate duplicates extracted genre or category slot', () => {
    expect(
      resolveHeuristicArtistSlot('Хочу на танцы', [
        { name: 'жанр', value: 'танец' },
        { name: 'тип_мероприятия', value: 'театры' },
      ])
    ).toBeNull();

    expect(
      resolveHeuristicArtistSlot('Хочу на мастер-классы', [
        { name: 'жанр', value: 'мастер-классы' },
        { name: 'тип_мероприятия', value: 'образование' },
      ])
    ).toBeNull();
  });

  test('does not treat dance noun as artist name even without open-ended leisure wording', () => {
    expect(resolveHeuristicArtistSlot('Танцы', [])).toBeNull();
  });

  test('does not treat generic music nouns as artist names', () => {
    expect(isLikelyArtistCandidate('песни')).toBe(false);
    expect(isLikelyArtistCandidate('музыка')).toBe(false);
    expect(resolveHeuristicArtistSlot('Концерт театр песни 1 мая', [])).toBeNull();
    expect(resolveHeuristicArtistSlot('Хочу на концерт музыка в мае', [])).toBeNull();
  });

  test('does not treat mood or generic discovery phrases as artist names', () => {
    expect(isLikelyArtistCandidate('поднять настроение')).toBe(false);
    expect(isLikelyArtistCandidate('что-нибудь веселое')).toBe(false);
    expect(resolveHeuristicArtistSlot('Хочу что-нибудь веселое', [])).toBeNull();
  });

  test('does not treat generic performer roles as artist names', () => {
    expect(isLikelyArtistCandidate('Иллюзионист')).toBe(false);
    expect(isLikelyArtistCandidate('иллюзиониста')).toBe(false);
    expect(resolveHeuristicArtistSlot('Хочу на иллюзиониста', [])).toBeNull();
    expect(resolveHeuristicArtistSlot('Иллюзионист', [])).toBeNull();
  });

  test('extracts artist after category prefix when name is explicit', () => {
    expect(resolveHeuristicArtistSlot('Хочу на стендап Паши Воли в Москве', [])).toMatchObject({
      name: 'исполнитель',
      value: 'Паши Воли',
      source: 'heuristic_artist',
    });

    expect(resolveHeuristicArtistSlot('Хочу на рок концерт Басты в Москве', [])).toMatchObject({
      name: 'исполнитель',
      value: 'Басты',
      source: 'heuristic_artist',
    });
  });

  test('keeps artist name when time or date context is appended', () => {
    expect(resolveHeuristicArtistSlot('Хочу на Басту в пятницу', [])).toMatchObject({
      name: 'исполнитель',
      value: 'Басту',
      source: 'heuristic_artist',
    });

    expect(resolveHeuristicArtistSlot('Хочу на Басту на следующих выходных', [])).toMatchObject({
      name: 'исполнитель',
      value: 'Басту',
      source: 'heuristic_artist',
    });
  });

  test('does not treat budget restriction as artist name', () => {
    expect(isLikelyArtistCandidate('не дороже 3 тысяч')).toBe(false);
    expect(resolveHeuristicArtistSlot('Хочу на концерт не дороже 3 тысяч', [])).toBeNull();
    expect(isLikelyArtistCandidate('за 1000р')).toBe(false);
    expect(resolveHeuristicArtistSlot('Привет, хочу на концерт за 1000р', [])).toBeNull();
  });
});
