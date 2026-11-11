import { callKassirApi } from './kassirClient.js';

async function getEventById(params) {
  const { id, domain = 'msk.kassir.ru' } = params || {};

  if (!id) {
    throw new Error('Поле id обязательно для получения события');
  }

  return await callKassirApi(`/api/events/${id}`, { domain });
}

async function getCategories(params = {}) {
  const { domain = 'msk.kassir.ru' } = params;
  return await callKassirApi('/api/categories', { domain });
}

async function getCategoryById(params) {
  const { id, domain = 'msk.kassir.ru' } = params;

  if (!id) {
    throw new Error('Поле id обязательно для получения категории');
  }

  return await callKassirApi(`/api/categories/${id}`, { domain });
}

async function getRootCategories(params = {}) {
  const { domain = 'msk.kassir.ru' } = params;
  return await callKassirApi('/api/categories/root', { domain });
}

async function getCompilation(params) {
  const { id, domain = 'msk.kassir.ru' } = params;

  if (!id) {
    throw new Error('Поле id обязательно для получения подборки');
  }

  return await callKassirApi(`/api/compilations/${id}`, { domain });
}

async function getHomepageCompilation(params) {
  const { platformStateValue = 'website', domain = 'msk.kassir.ru' } = params;

  return await callKassirApi(`/api/compilations/homepage/${platformStateValue}`, { domain });
}

async function quickSearch(params) {
  const { q, domain = 'msk.kassir.ru' } = params;

  if (!q) {
    throw new Error('Поле q (поисковый запрос) обязательно для быстрого поиска');
  }

  return await callKassirApi('/api/quick-search', { q, domain });
}

async function getCities(params = {}) {
  const { domain = 'msk.kassir.ru' } = params;
  return await callKassirApi('/api/cities', { domain });
}

async function getCityBySlug(params) {
  const { slug, domain = 'msk.kassir.ru' } = params;

  if (!slug) {
    throw new Error('Поле slug обязательно для получения города');
  }

  return await callKassirApi(`/api/cities/${slug}`, { domain });
}

export {
  getEventById,
  getCategories,
  getCategoryById,
  getRootCategories,
  getCompilation,
  getHomepageCompilation,
  quickSearch,
  getCities,
  getCityBySlug,
};
