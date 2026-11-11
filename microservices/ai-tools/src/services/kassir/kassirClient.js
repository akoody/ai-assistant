import { getKassirApiToken, getKassirApiUrl } from '../configService.js';
import { getCache, setCache } from '../cacheService.js';
import { CACHE_TTL } from './cachePolicy.js';
import { BROAD_SEARCH_PAGE_SIZE, resolveSearchSlugStrategy } from './searchRouting.js';

async function callKassirApi(endpoint, params = {}) {
  const apiUrl = getKassirApiUrl();
  const token = getKassirApiToken();

  // Формируем URL с параметрами
  const url = new URL(`${apiUrl}${endpoint}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.append(key, value);
    }
  });

  const queryParamsLog = Object.fromEntries(url.searchParams.entries());
  console.log(`🔍 [KassirAPI] Запрос: ${endpoint} ${JSON.stringify(queryParamsLog)}`);

  const curlParts = [`curl -X GET "${url.toString()}"`, `-H "Content-Type: application/json"`];
  if (token) {
    curlParts.push(`-H "Authorization: Bearer ***"`);
  }
  console.log(`💻 [KassirAPI] curl: ${curlParts.join(' ')}`);

  // Проверяем кеш
  const cacheKey = `kassir_api:${url.toString()}`;
  const cached = getCache(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    // Формируем заголовки: Authorization добавляем только если токен есть
    const headers = {
      'Content-Type': 'application/json',
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `API Кассир.ру вернул ошибку: ${response.status} ${response.statusText} - ${errorText}`
      );
    }

    const contentType = response?.headers?.get?.('content-type') || '';
    const bodyText = await response.text();
    let data = null;
    try {
      data = JSON.parse(bodyText);
    } catch (_error) {
      const snippet = String(bodyText || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 240);
      const hint = snippet && snippet[0] === '<' ? ' (похоже на HTML-страницу)' : '';
      throw new Error(
        `API Кассир.ру вернул некорректный JSON. ` +
          `Content-Type: ${contentType || 'unknown'}${hint}. Body: ${snippet || '[empty]'}`
      );
    }

    // Кешируем результат
    setCache(cacheKey, data, CACHE_TTL);

    return data;
  } catch (error) {
    console.error('Ошибка вызова API Кассир.ру:', error);
    throw error;
  }
}

async function fetchPageKitSearchResult(query = {}) {
  const apiData = await callKassirApi('/api/page-kit', query);
  const searchResult = apiData?.kit?.searchResult || {};
  return {
    apiData,
    searchResult,
    items: Array.isArray(searchResult.items) ? searchResult.items : [],
    pagination: searchResult.pagination || null,
  };
}

async function fetchPageKitWithResolvedSlugs({
  query = {},
  effectiveKeyword = '',
  querySuggestion = null,
  slots = [],
  lastUserMessage = '',
  isBroadSearch = false,
}) {
  const slugStrategy = resolveSearchSlugStrategy({
    slug: query.slug,
    effectiveKeyword,
    querySuggestion,
    slots,
    lastUserMessage,
    isBroadSearch,
  });

  const requestedPage = Number(query.page) || 1;

  if (!Array.isArray(slugStrategy.slugs) || slugStrategy.slugs.length <= 1) {
    const singleQuery = { ...query, slug: slugStrategy.slugs?.[0] || query.slug };
    return {
      ...(await fetchPageKitSearchResult(singleQuery)),
      slugStrategy,
    };
  }

  const mergedItems = [];
  const rawResponses = [];
  let totalCount = 0;
  let pagesCount = 0;
  let pageSize = 0;
  let pageIndex = Math.max(requestedPage - 1, 0);
  let offset = 0;
  let baseApiData = null;
  let baseSearchResult = null;

  console.log(
    `🧩 [KassirAPI] Расширяю root-поиск по slug'ам (${slugStrategy.reason}): ` +
      slugStrategy.slugs.join(', ')
  );

  for (const categorySlug of slugStrategy.slugs) {
    const scopedQuery = {
      ...query,
      slug: categorySlug,
    };

    if (slugStrategy.broadSearch && !scopedQuery.page_size) {
      scopedQuery.page_size = BROAD_SEARCH_PAGE_SIZE;
    }

    const result = await fetchPageKitSearchResult(scopedQuery);
    rawResponses.push({
      slug: categorySlug,
      items: result.items.length,
      pagination: result.pagination,
      apiData: result.apiData,
    });

    if (!baseApiData) {
      baseApiData = result.apiData;
      baseSearchResult = result.searchResult;
    }

    mergedItems.push(...result.items);

    if (typeof result.pagination?.totalCount === 'number') {
      totalCount += result.pagination.totalCount;
    }
    if (typeof result.pagination?.pagesCount === 'number') {
      pagesCount = Math.max(pagesCount, result.pagination.pagesCount);
    }
    if (typeof result.pagination?.pageSize === 'number') {
      pageSize = Math.max(pageSize, result.pagination.pageSize);
    }
    if (typeof result.pagination?.pageIndex === 'number') {
      pageIndex = Math.max(pageIndex, result.pagination.pageIndex);
    }
    if (typeof result.pagination?.offset === 'number') {
      offset = Math.max(offset, result.pagination.offset);
    }

    console.log(
      `🧩 [KassirAPI] slug ${categorySlug}: items=${result.items.length}, ` +
        `currentPage=${result.pagination?.currentPage ?? 'n/a'}, pagesCount=${result.pagination?.pagesCount ?? 'n/a'}`
    );
  }

  const effectivePageSize =
    Number(query.page_size) || pageSize || mergedItems.length || BROAD_SEARCH_PAGE_SIZE;
  const mergedPagination = {
    ...(baseSearchResult?.pagination || {}),
    pageSize: effectivePageSize,
    pageIndex,
    totalCount: totalCount || mergedItems.length,
    currentPage: requestedPage,
    offset: offset || Math.max((requestedPage - 1) * effectivePageSize, 0),
    pagesCount: pagesCount || 1,
  };

  const mergedSearchResult = {
    ...(baseSearchResult || {}),
    items: mergedItems,
    pagination: mergedPagination,
  };

  const mergedApiData = {
    ...(baseApiData || {}),
    kit: {
      ...(baseApiData?.kit || {}),
      searchResult: mergedSearchResult,
      mergedFromSlugs: rawResponses.map((item) => ({
        slug: item.slug,
        items: item.items,
        pagination: item.pagination,
      })),
    },
  };

  return {
    apiData: mergedApiData,
    searchResult: mergedSearchResult,
    items: mergedItems,
    pagination: mergedPagination,
    slugStrategy,
  };
}

export { callKassirApi, fetchPageKitWithResolvedSlugs };
