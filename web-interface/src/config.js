import { loadRootEnv, resolveInternalApiKey } from '../../shared/runtimeEnv.js';
import { Agent } from 'undici';

loadRootEnv(import.meta.url);

const PORT = process.env.PORT || 8080;

const MONGODB_URI = process.env.MONGODB_URI;

const DB_NAME = process.env.DB_NAME;

const AI_PLANNER_URL = process.env.AI_PLANNER_URL || 'http://localhost:3004';

const AI_PLANNER_API_KEY = resolveInternalApiKey({
  serviceName: 'web-interface',
  settingName: 'AI_PLANNER_API_KEY',
  envNames: ['AI_PLANNER_API_KEY'],
});

const DEFAULT_UPSTREAM_TIMEOUT_MS = 180000;

const parsedUpstreamTimeoutMs = Number.parseInt(process.env.WEB_UPSTREAM_TIMEOUT_MS || '', 10);

const UPSTREAM_TIMEOUT_MS =
  Number.isFinite(parsedUpstreamTimeoutMs) && parsedUpstreamTimeoutMs > 0
    ? parsedUpstreamTimeoutMs
    : DEFAULT_UPSTREAM_TIMEOUT_MS;

const LONG_TIMEOUT_AGENT = new Agent({
  headersTimeout: UPSTREAM_TIMEOUT_MS,
  bodyTimeout: UPSTREAM_TIMEOUT_MS,
});

const DEFAULT_WEB_SERVER_REQUEST_TIMEOUT_MS = 190000;

const parsedWebServerRequestTimeoutMs = Number.parseInt(
  process.env.WEB_SERVER_REQUEST_TIMEOUT_MS || '',
  10
);

const WEB_SERVER_REQUEST_TIMEOUT_MS =
  Number.isFinite(parsedWebServerRequestTimeoutMs) && parsedWebServerRequestTimeoutMs > 0
    ? parsedWebServerRequestTimeoutMs
    : DEFAULT_WEB_SERVER_REQUEST_TIMEOUT_MS;

const DEFAULT_WEB_SERVER_HEADERS_TIMEOUT_MS = WEB_SERVER_REQUEST_TIMEOUT_MS + 5000;

const parsedWebServerHeadersTimeoutMs = Number.parseInt(
  process.env.WEB_SERVER_HEADERS_TIMEOUT_MS || '',
  10
);

const WEB_SERVER_HEADERS_TIMEOUT_MS =
  Number.isFinite(parsedWebServerHeadersTimeoutMs) && parsedWebServerHeadersTimeoutMs > 0
    ? parsedWebServerHeadersTimeoutMs
    : DEFAULT_WEB_SERVER_HEADERS_TIMEOUT_MS;

const DEFAULT_WEB_SERVER_KEEP_ALIVE_TIMEOUT_MS = 70000;

const parsedWebServerKeepAliveTimeoutMs = Number.parseInt(
  process.env.WEB_SERVER_KEEP_ALIVE_TIMEOUT_MS || '',
  10
);

const WEB_SERVER_KEEP_ALIVE_TIMEOUT_MS =
  Number.isFinite(parsedWebServerKeepAliveTimeoutMs) && parsedWebServerKeepAliveTimeoutMs > 0
    ? parsedWebServerKeepAliveTimeoutMs
    : DEFAULT_WEB_SERVER_KEEP_ALIVE_TIMEOUT_MS;

const JWT_SECRET = process.env.JWT_SECRET;

const ADMIN_LOGIN = process.env.ADMIN_LOGIN;

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const SITE_LOGIN = process.env.SITE_LOGIN;

const SITE_PASSWORD = process.env.SITE_PASSWORD;

const SITE_JWT_SECRET = process.env.SITE_JWT_SECRET || JWT_SECRET;

const WIDGET_JWT_SECRET = process.env.WIDGET_JWT_SECRET || JWT_SECRET;

const WIDGET_TOKEN_EXPIRES_IN = process.env.WIDGET_TOKEN_EXPIRES_IN || '30d';

const ADMIN_ALLOWED_HOST = String(process.env.ADMIN_ALLOWED_HOST || 'sferaai.ru')
  .trim()
  .toLowerCase();

const MAX_CLIENT_ID_LENGTH = 256;

const DEFAULT_CHAT_PROXY_TIMEOUT_MS = 55000;

const parsedChatProxyTimeoutMs = Number.parseInt(process.env.WEB_CHAT_PROXY_TIMEOUT_MS || '', 10);

const CHAT_PROXY_TIMEOUT_MS =
  Number.isFinite(parsedChatProxyTimeoutMs) && parsedChatProxyTimeoutMs > 0
    ? parsedChatProxyTimeoutMs
    : DEFAULT_CHAT_PROXY_TIMEOUT_MS;

export {
  PORT,
  MONGODB_URI,
  DB_NAME,
  AI_PLANNER_URL,
  AI_PLANNER_API_KEY,
  LONG_TIMEOUT_AGENT,
  WEB_SERVER_REQUEST_TIMEOUT_MS,
  WEB_SERVER_HEADERS_TIMEOUT_MS,
  WEB_SERVER_KEEP_ALIVE_TIMEOUT_MS,
  JWT_SECRET,
  ADMIN_LOGIN,
  ADMIN_PASSWORD,
  SITE_LOGIN,
  SITE_PASSWORD,
  SITE_JWT_SECRET,
  WIDGET_JWT_SECRET,
  WIDGET_TOKEN_EXPIRES_IN,
  ADMIN_ALLOWED_HOST,
  MAX_CLIENT_ID_LENGTH,
  CHAT_PROXY_TIMEOUT_MS,
};

export function validateStartupConfig() {
  const required = { MONGODB_URI, DB_NAME, JWT_SECRET, ADMIN_LOGIN, ADMIN_PASSWORD };
  const missing = Object.entries(required)
    .filter(([, value]) => !String(value || '').trim())
    .map(([name]) => name);
  if (missing.length) throw new Error(`Missing required configuration: ${missing.join(', ')}`);
}
