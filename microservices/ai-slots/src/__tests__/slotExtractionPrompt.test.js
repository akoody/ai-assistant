import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from '@jest/globals';
import { getSlotExtractionPrompt } from '../services/configService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function readProjectFile(relativePath) {
  return readFileSync(join(__dirname, '../..', relativePath), 'utf-8');
}

describe('slot extraction prompt guardrails', () => {
  test('explicitly forbids treating bare relative dates as artists', () => {
    const prompt = getSlotExtractionPrompt();

    expect(prompt).toContain('"через месяц"');
    expect(prompt).toContain('НЕ "исполнитель"');
    expect(prompt).toContain('"Реп концерт через месяц"');
    expect(prompt).toContain('{"name":"дата_события","value":"через месяц"}');
  });

  test('explicitly keeps standalone composer-like names in event search domain', () => {
    const prompt = getSlotExtractionPrompt();

    expect(prompt).toContain('"Вивальди"');
    expect(prompt).toContain('композитора');
    expect(prompt).toContain('НЕ является off_topic');
    expect(prompt).toContain('{"name":"исполнитель","value":"Вивальди"');
  });

  test('keeps the same artist/date guardrail in the runtime strict envelope', () => {
    const source = readProjectFile('src/services/aiGatewayService.js');

    expect(source).toContain('"через месяц"');
    expect(source).toContain('"Реп концерт через месяц"');
    expect(source).toContain('и НЕТ слота "исполнитель"');
    expect(source).toContain('"Вивальди"');
    expect(source).toContain('НЕ off_topic');
  });

  test('requires extracting concrete child age from children age phrases', () => {
    const prompt = getSlotExtractionPrompt();
    const source = readProjectFile('src/services/aiGatewayService.js');

    expect(prompt).toContain('Представления для детей 6+');
    expect(prompt).toContain('"возраст_ребенка","value":"6"');
    expect(prompt).toContain('от 6 лет');
    expect(prompt).toContain('до 6 лет');
    expect(prompt).toContain('НИКОГДА не являются исполнителем');
    expect(source).toContain('КРИТИЧЕСКОЕ ПРАВИЛО ДЕТСКОГО ВОЗРАСТА');
    expect(source).toContain('"Представления для детей 6+"');
    expect(source).toContain('НИКОГДА не являются "исполнитель"');
  });

  test('forbids turning memory-reference phrases into поисковый_запрос', () => {
    const prompt = getSlotExtractionPrompt();
    const source = readProjectFile('src/services/aiGatewayService.js');

    expect(prompt).toContain('"из любимого"');
    expect(prompt).toContain('"по моим предпочтениям"');
    expect(prompt).toContain('НЕ должны превращаться в слот "поисковый_запрос"');
    expect(prompt).toContain('"Найди что-то из любимого"');
    expect(source).toContain('"из любимого"');
    expect(source).toContain('"по моим предпочтениям"');
    expect(source).toContain('БЕЗ слота "поисковый_запрос"');
  });

  test('forbids turning favorite-genre memory references into исполнитель', () => {
    const prompt = getSlotExtractionPrompt();
    const source = readProjectFile('src/services/aiGatewayService.js');

    expect(prompt).toContain('"моего любимого жанра"');
    expect(prompt).toContain('НИКОГДА не являются конкретным исполнителем');
    expect(prompt).toContain('"Концерт моего любимого жанра"');
    expect(source).toContain('"моего любимого жанра"');
    expect(source).toContain('это обращение к preference_memory_reference');
    expect(source).toContain('"Концерт моего любимого жанра"');
  });
});
