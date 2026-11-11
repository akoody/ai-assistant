const SITE_AUTH_KEY = 'kassir_site_token';
const SITE_USER_KEY = 'kassir_site_user';

export function saveSiteAuth(token, user) {
  localStorage.setItem(SITE_AUTH_KEY, token);
  localStorage.setItem(SITE_USER_KEY, JSON.stringify(user));
}

export function getSiteToken() {
  return localStorage.getItem(SITE_AUTH_KEY);
}

export function getSiteUser() {
  try {
    return JSON.parse(localStorage.getItem(SITE_USER_KEY) || 'null');
  } catch {
    return null;
  }
}

export function clearSiteAuth() {
  localStorage.removeItem(SITE_AUTH_KEY);
  localStorage.removeItem(SITE_USER_KEY);
}

export function isSiteLoggedIn() {
  return Boolean(getSiteToken());
}

export async function siteAuthFetch(url, options = {}) {
  const token = getSiteToken();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    clearSiteAuth();
    window.location.href = '/';
    return null;
  }
  return res;
}

export function logoutSite() {
  clearSiteAuth();
  window.location.href = '/';
}
