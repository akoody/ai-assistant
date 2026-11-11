import { describe, expect, test } from '@jest/globals';
import { extractChildAgeFromText } from '../../../../shared/childAgeUtils.js';

describe('childAgeUtils', () => {
  test('extracts child age from spelled-out russian age phrase', () => {
    expect(extractChildAgeFromText('Куда можно сегодня сходить с ребёнком с четырёх лет')).toBe(4);
  });

  test('extracts child age from compact adjective form', () => {
    expect(extractChildAgeFromText('Посоветуйте что-нибудь для шестилетнего ребёнка')).toBe(6);
  });

  test('extracts child age from plus age rating in children request', () => {
    expect(extractChildAgeFromText('Представления для детей 6+')).toBe(6);
    expect(extractChildAgeFromText('Детские спектакли 6 плюс')).toBe(6);
  });

  test('extracts child age from from/to age phrases', () => {
    expect(extractChildAgeFromText('Подбери мероприятия для детей от 6 лет')).toBe(6);
    expect(extractChildAgeFromText('Что есть детям до 6 лет')).toBe(6);
  });
});
