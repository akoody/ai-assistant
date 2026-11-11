import { normalizeClientId } from './identifiers.js';
import { normalizeAnalyticsDomain } from './domains.js';

function buildAnalyticsFilter({ from, to, userId, clientId, domain }) {
  const filter = {};
  const normalizedUserId = String(userId || '').trim();
  if (normalizedUserId) filter.userId = normalizedUserId;
  const normalizedClientId = normalizeClientId(clientId);
  if (normalizedClientId) filter.clientId = normalizedClientId;
  const normalizedDomain = normalizeAnalyticsDomain(domain);
  if (normalizedDomain) {
    const escapedDomain = normalizedDomain.replace(/\./g, '\\.');
    const hostRegex = { $regex: `(^|\\.)${escapedDomain}$`, $options: 'i' };
    const urlRegex = { $regex: `^https?://([^/]+\\.)?${escapedDomain}(?=[:/]|$)`, $options: 'i' };
    filter.$and = filter.$and || [];
    filter.$and.push({
      $or: [
        { domain: normalizedDomain },
        { baseDomain: normalizedDomain },
        { embeddingHost: hostRegex },
        { pageHost: hostRegex },
        { host: hostRegex },
        { hostname: hostRegex },
        { 'clientContext.embeddingHost': hostRegex },
        { 'payload.embeddingHost': hostRegex },
        { page: urlRegex },
        { 'clientContext.pageUrl': urlRegex },
        { 'payload.page': urlRegex },
        { 'payload.pageUrl': urlRegex },
        { 'payload.domain': normalizedDomain },
        { 'payload.baseDomain': normalizedDomain },
        { 'clientContext.baseDomain': normalizedDomain },
      ],
    });
  }
  const fromDate = parseAnalyticsDateBoundary(from, false);
  const toDate = parseAnalyticsDateBoundary(to, true);
  if (fromDate || toDate) {
    const dateRange = {};
    const isoStringRange = {};
    if (fromDate) {
      dateRange.$gte = fromDate;
      isoStringRange.$gte = fromDate.toISOString();
    }
    if (toDate) {
      dateRange.$lte = toDate;
      isoStringRange.$lte = toDate.toISOString();
    }

    const dateOr = [
      { timestamp: { ...dateRange } },
      { timestamp: { ...isoStringRange } },
      { createdAt: { ...dateRange } },
      { createdAt: { ...isoStringRange } },
    ];
    if (filter.$and) {
      filter.$and.push({ $or: dateOr });
    } else {
      filter.$or = dateOr;
    }
  }
  return filter;
}

function parseAnalyticsDateBoundary(value, isEndOfDay) {
  if (value instanceof Date) {
    const clonedDate = new Date(value.getTime());
    return Number.isNaN(clonedDate.getTime()) ? null : clonedDate;
  }

  const raw = String(value || '').trim();
  if (!raw) return null;

  const isoDateOnlyMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDateOnlyMatch) {
    return buildUtcDateBoundary(
      Number(isoDateOnlyMatch[1]),
      Number(isoDateOnlyMatch[2]),
      Number(isoDateOnlyMatch[3]),
      isEndOfDay
    );
  }

  const ruDateOnlyMatch = raw.match(/^(\d{2})[-./](\d{2})[-./](\d{4})$/);
  if (ruDateOnlyMatch) {
    return buildUtcDateBoundary(
      Number(ruDateOnlyMatch[3]),
      Number(ruDateOnlyMatch[2]),
      Number(ruDateOnlyMatch[1]),
      isEndOfDay
    );
  }

  const parsedDate = new Date(raw);
  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }
  return parsedDate;
}

function buildUtcDateBoundary(year, month, day, isEndOfDay) {
  if (![year, month, day].every((part) => Number.isInteger(part))) {
    return null;
  }

  const date = new Date(
    Date.UTC(
      year,
      month - 1,
      day,
      isEndOfDay ? 23 : 0,
      isEndOfDay ? 59 : 0,
      isEndOfDay ? 59 : 0,
      isEndOfDay ? 999 : 0
    )
  );

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function parseAnalyticsLimit(rawLimit, defaultValue = 5000, maxValue = 20000) {
  if (rawLimit === undefined || rawLimit === null || rawLimit === '') {
    return defaultValue;
  }

  const parsed = parseInt(String(rawLimit), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return defaultValue;
  }
  return Math.min(parsed, maxValue);
}

function fetchAnalyticsRows(db, collectionName, filter, limit) {
  let cursor = db
    .collection(collectionName)
    .find(filter)
    .sort({ timestamp: -1, createdAt: -1, _id: -1 });
  if (Number.isInteger(limit) && limit > 0) {
    cursor = cursor.limit(limit);
  }
  return cursor.toArray();
}

function mergeMongoFilters(baseFilter = {}, extraFilter = {}) {
  const result = { ...(baseFilter || {}) };
  Object.entries(extraFilter || {}).forEach(([key, value]) => {
    const baseValue = result[key];
    if (
      baseValue &&
      value &&
      typeof baseValue === 'object' &&
      typeof value === 'object' &&
      !Array.isArray(baseValue) &&
      !Array.isArray(value) &&
      !(baseValue instanceof Date) &&
      !(value instanceof Date)
    ) {
      result[key] = { ...baseValue, ...value };
    } else {
      result[key] = value;
    }
  });
  return result;
}

function buildWidgetOpenFilter(baseFilter = {}) {
  return mergeMongoFilters(baseFilter, { event: { $in: ['widget_open', 'widget_expanded'] } });
}

function percent(part, whole) {
  const p = Number(part) || 0;
  const w = Number(whole) || 0;
  if (w <= 0) return 0;
  return Math.round((p / w) * 1000) / 10;
}

async function buildFunnelStep(db, { key, label, collection, filter }) {
  const base = filter || {};
  const total = await db.collection(collection).countDocuments(base);
  const users = await db.collection(collection).distinct('userId', base);
  const sessions = await db
    .collection(collection)
    .distinct('sessionId', mergeMongoFilters(base, { sessionId: { $nin: [null, ''] } }));
  return {
    key,
    label,
    totalEvents: total,
    uniqueUsers: users.length,
    uniqueSessions: sessions.length,
  };
}

export {
  buildAnalyticsFilter,
  parseAnalyticsLimit,
  fetchAnalyticsRows,
  mergeMongoFilters,
  buildWidgetOpenFilter,
  percent,
  buildFunnelStep,
};
