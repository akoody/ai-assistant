import { readFileSync } from 'node:fs';
import {
  POPULAR_SELECTIONS_FILE_URL,
  DEFAULT_POPULAR_SELECTION_URLS,
} from './searchDefinitions.js';

let popularSelectionSlugByDomainCache = null;

function loadPopularSelectionSlugByDomain() {
  if (popularSelectionSlugByDomainCache) {
    return popularSelectionSlugByDomainCache;
  }

  const map = new Map();
  const addUrlsToMap = (urls = []) => {
    (Array.isArray(urls) ? urls : []).forEach((line) => {
      const rawLine = String(line || '').trim();
      if (!rawLine) {
        return;
      }

      try {
        const parsedUrl = new URL(rawLine);
        const domain = String(parsedUrl.hostname || '')
          .toLowerCase()
          .trim();
        const slug = normalizePageKitSlug(parsedUrl.pathname);
        if (domain && slug.startsWith('/selection/')) {
          map.set(domain, slug);
        }
      } catch (error) {
        console.warn(
          `⚠️ [offerService] Не удалось разобрать URL популярной подборки "${rawLine}":`,
          error
        );
      }
    });
  };

  addUrlsToMap(DEFAULT_POPULAR_SELECTION_URLS);

  try {
    const content = readFileSync(POPULAR_SELECTIONS_FILE_URL, 'utf8');
    addUrlsToMap(
      content
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean)
    );
  } catch (error) {
    // popul.txt is an optional override of the built-in list; its absence is normal.
    if (error?.code !== 'ENOENT') {
      console.warn(
        '⚠️ [offerService] Не удалось загрузить popul.txt с популярными подборками, использую встроенный список:',
        error
      );
    }
  }

  popularSelectionSlugByDomainCache = map;
  return map;
}

function getPopularSelectionSlugForDomain(domain = '') {
  const normalizedDomain = String(domain || '')
    .toLowerCase()
    .trim();
  if (!normalizedDomain) {
    return null;
  }

  return loadPopularSelectionSlugByDomain().get(normalizedDomain) || null;
}

function normalizePageKitSlug(value = '') {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return '';
  }

  const withoutSlashes = normalized.replace(/^\/+|\/+$/g, '');
  return withoutSlashes ? `/${withoutSlashes}/` : '/';
}

export { getPopularSelectionSlugForDomain, normalizePageKitSlug };
