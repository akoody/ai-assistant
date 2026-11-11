import { normalizeText } from '../textUtils.js';

function normalizeOfferBlockKey(text = '') {
  return normalizeText(String(text || ''))
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getClarificationBlockScore(text = '') {
  const normalized = normalizeOfferBlockKey(text);
  if (!normalized) return 0;

  let score = 0;
  if (/(?<![A-Za-zА-Яа-яЁё0-9_])жанр/u.test(normalized)) score += 1;
  if (/(?<![A-Za-zА-Яа-яЁё0-9_])бюджет/u.test(normalized)) score += 1;
  if (/(?<![A-Za-zА-Яа-яЁё0-9_])время/u.test(normalized)) score += 1;
  if (/(?<![A-Za-zА-Яа-яЁё0-9_])дата/u.test(normalized)) score += 1;
  if (/если\s+хотите\s+больше\s+опци/u.test(normalized)) score += 1;

  return score;
}

function detectOfferLoopBlockType(text = '') {
  const normalized = normalizeOfferBlockKey(text);
  if (!normalized) return '';

  if (
    /хотите\s+посмотр[^.?!]*выберите\s+категори/u.test(normalized) ||
    /можете\s+выбрат[^.?!]*категори/u.test(normalized)
  ) {
    return 'category_cta';
  }

  if (
    /если\s+хотите\s+больше\s+опци/u.test(normalized) &&
    /(уточнит|жанр|бюджет|время|дат)/u.test(normalized)
  ) {
    return 'more_options_cta';
  }

  if (
    /уточнит(?:е|ь)/u.test(normalized) &&
    /предлож/u.test(normalized) &&
    /вариант/u.test(normalized)
  ) {
    return 'clarification_request';
  }

  return '';
}

function dedupeLoopedOfferText(text = '') {
  const source = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim();

  if (!source) {
    return '';
  }

  const blocks = source
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (blocks.length <= 1) {
    return source;
  }

  const keptBlocks = [];
  const seenKeys = new Set();
  const specialBlockMap = new Map();

  for (const block of blocks) {
    const normalizedKey = normalizeOfferBlockKey(block);
    if (!normalizedKey) {
      continue;
    }

    const blockType = detectOfferLoopBlockType(block);
    if (blockType) {
      const existing = specialBlockMap.get(blockType);
      if (!existing) {
        specialBlockMap.set(blockType, {
          index: keptBlocks.length,
          score: getClarificationBlockScore(block),
        });
        keptBlocks.push(block);
        continue;
      }

      const currentScore = getClarificationBlockScore(block);
      if (currentScore > existing.score) {
        keptBlocks[existing.index] = block;
        specialBlockMap.set(blockType, { index: existing.index, score: currentScore });
      }
      continue;
    }

    const shouldSkipDuplicate = seenKeys.has(normalizedKey) && normalizedKey.length >= 40;
    if (shouldSkipDuplicate) {
      continue;
    }

    seenKeys.add(normalizedKey);
    keptBlocks.push(block);
  }

  return keptBlocks
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export { dedupeLoopedOfferText };
