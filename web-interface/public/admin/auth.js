const AUTH_KEY = 'kassir_admin_token';
const USER_KEY = 'kassir_admin_user';

export function saveAuth(token, user) {
  localStorage.setItem(AUTH_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getToken() {
  return localStorage.getItem(AUTH_KEY);
}

export function getUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
  } catch {
    return null;
  }
}

export function clearAuth() {
  localStorage.removeItem(AUTH_KEY);
  localStorage.removeItem(USER_KEY);
}

export function isLoggedIn() {
  return !!getToken();
}

export function requireAuth(redirectTo = '/admin/') {
  if (!isLoggedIn()) {
    window.location.href = redirectTo;
    return false;
  }
  return true;
}

export function redirectByRole(role) {
  if (role === 'admin') {
    window.location.href = '/admin/dashboard.html';
  } else {
    window.location.href = '/admin/metrics.html';
  }
}

export function redirectIfLoggedIn() {
  if (isLoggedIn()) {
    const user = getUser();
    redirectByRole(user?.role);
    return true;
  }
  return false;
}

export async function authFetch(url, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    clearAuth();
    window.location.href = '/admin/';
    return null;
  }
  return res;
}

export function logout() {
  clearAuth();
  window.location.href = '/admin/';
}
