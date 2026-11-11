import { Agent } from 'undici';
import { getAiGatewayApiKey, getAiGatewayUrl } from '../configService.js';
import { updateStatus } from '../statusService.js';
import { normalizeAssistantResponse } from '../llm/assistantResponseUtils.js';

const DEFAULT_AI_GATEWAY_TIMEOUT_MS = 180000;

const parsedAiGatewayTimeoutMs = Number.parseInt(process.env.AI_GATEWAY_TIMEOUT_MS || '', 10);

const AI_GATEWAY_TIMEOUT_MS =
  Number.isFinite(parsedAiGatewayTimeoutMs) && parsedAiGatewayTimeoutMs > 0
    ? parsedAiGatewayTimeoutMs
    : DEFAULT_AI_GATEWAY_TIMEOUT_MS;

const DEFAULT_OFFER_DELIVERY_TIMEOUT_MS = 25000;

const parsedOfferDeliveryTimeoutMs = Number.parseInt(
  process.env.OFFER_DELIVERY_AI_GATEWAY_TIMEOUT_MS || '',
  10
);

const OFFER_DELIVERY_AI_GATEWAY_TIMEOUT_MS =
  Number.isFinite(parsedOfferDeliveryTimeoutMs) && parsedOfferDeliveryTimeoutMs > 0
    ? Math.min(parsedOfferDeliveryTimeoutMs, AI_GATEWAY_TIMEOUT_MS)
    : Math.min(DEFAULT_OFFER_DELIVERY_TIMEOUT_MS, AI_GATEWAY_TIMEOUT_MS);

const LONG_TIMEOUT_AGENT = new Agent({
  headersTimeout: AI_GATEWAY_TIMEOUT_MS,
  bodyTimeout: AI_GATEWAY_TIMEOUT_MS,
});

const MAX_ATTEMPTS = 3;

function estimateOfferDeliveryMaxTokens(eventsCount) {
  const safeCount = Number.isFinite(eventsCount) ? eventsCount : 0;
  // Даём запас, чтобы модель не обрезала список на 3/5 или 4/5.
  // Формат: JSON + многострочный текст на событие (дата/место/описание/цена).
  const base = 700;
  const perEvent = 620;
  const min = 1800;
  const max = 6144;
  const estimated = base + perEvent * Math.max(0, safeCount);
  return Math.max(min, Math.min(max, Math.round(estimated)));
}

async function readJsonFromFetchResponse(response) {
  const contentType = response?.headers?.get?.('content-type') || '';
  const bodyText = await response.text();
  let json = null;
  try {
    json = JSON.parse(bodyText);
  } catch (_error) {
    // ignore
  }
  return { contentType, bodyText, json };
}

async function requestAssistantMessage(
  messages,
  userId,
  sessionId,
  attemptLabel = 'основной',
  attemptNumber = 1,
  temperature = null,
  requestId = null,
  maxTokens = null,
  options = null
) {
  let resolvedMaxTokens = maxTokens;
  let resolvedOptions = options;

  if (
    resolvedOptions === null &&
    resolvedMaxTokens &&
    typeof resolvedMaxTokens === 'object' &&
    !Array.isArray(resolvedMaxTokens)
  ) {
    resolvedOptions = resolvedMaxTokens;
    resolvedMaxTokens = null;
  }

  const timeoutMs =
    Number.isFinite(resolvedOptions?.timeoutMs) && resolvedOptions.timeoutMs > 0
      ? resolvedOptions.timeoutMs
      : AI_GATEWAY_TIMEOUT_MS;
  const maxAttempts =
    Number.isFinite(resolvedOptions?.maxAttempts) && resolvedOptions.maxAttempts > 0
      ? resolvedOptions.maxAttempts
      : MAX_ATTEMPTS;
  const aiGatewayUrl = getAiGatewayUrl();
  const apiKey = getAiGatewayApiKey();

  if (!aiGatewayUrl) {
    throw new Error('AI Gateway URL не настроен');
  }

  console.log(
    `🌐 [${userId}][${sessionId}] Отправка запроса в AI Gateway (${attemptLabel}), попытка ${attemptNumber} из ${maxAttempts}...` +
      (Number.isFinite(resolvedMaxTokens) ? ` (max_tokens=${resolvedMaxTokens})` : '') +
      (Number.isFinite(temperature) ? ` (temperature=${temperature})` : '') +
      (timeoutMs !== AI_GATEWAY_TIMEOUT_MS ? ` (timeout=${timeoutMs}ms)` : '')
  );

  // Обновляем статус при повторных попытках
  if (attemptNumber > 1 && requestId) {
    updateStatus(requestId, 'Проверяем качество ответа...');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const requestBody = {
      messages,
      type: 'planner',
    };

    // Передаем temperature, если указана для конкретного сценария.
    if (temperature !== null) {
      requestBody.temperature = temperature;
    }

    if (Number.isFinite(resolvedMaxTokens)) {
      requestBody.max_tokens = resolvedMaxTokens;
    }

    if (resolvedOptions?.noCache === true) {
      requestBody.no_cache = true;
    }

    if (Number.isFinite(resolvedOptions?.cacheTtlSeconds) && resolvedOptions.cacheTtlSeconds > 0) {
      requestBody.cache_ttl = resolvedOptions.cacheTtlSeconds;
    }

    const response = await fetch(`${aiGatewayUrl}/api/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
      dispatcher: LONG_TIMEOUT_AGENT,
    });

    const { contentType, bodyText, json } = await readJsonFromFetchResponse(response);

    if (!response.ok) {
      const errorMessage = json?.error || json?.message || response.statusText;
      const snippet = String(bodyText || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 240);
      const hint = snippet && snippet[0] === '<' ? ' (похоже на HTML-страницу)' : '';
      throw new Error(
        `AI Gateway ошибка: ${response.status} - ${errorMessage || 'Unknown error'}. ` +
          `Content-Type: ${contentType || 'unknown'}${hint}. Body: ${snippet || '[empty]'}`
      );
    }

    console.log(
      `✅ [${userId}][${sessionId}] Ответ от AI Gateway (${attemptLabel}) получен, парсинг...`
    );
    if (!json) {
      const snippet = String(bodyText || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 240);
      const hint = snippet && snippet[0] === '<' ? ' (похоже на HTML-страницу)' : '';
      throw new Error(
        `AI Gateway вернул некорректный JSON. Content-Type: ${contentType || 'unknown'}${hint}. Body: ${snippet || '[empty]'}`
      );
    }
    const data = json;
    console.log(`✅ [${userId}][${sessionId}] Ответ от AI Gateway (${attemptLabel}) распарсен`);

    const rawContent = data.choices?.[0]?.message?.content || '';
    const normalized = normalizeAssistantResponse(
      rawContent || 'Извините, произошла ошибка при генерации ответа.'
    );
    console.log(`📩 [${userId}][${sessionId}] Сырой ответ LLM (${attemptLabel}):`, rawContent);
    console.log(`🧾 [${userId}][${sessionId}] Парсинг ответа (${attemptLabel}):`, {
      parsedFromJson: normalized.parsedFromJson,
      textPreview: (normalized.text || '').slice(0, 200),
      buttons: normalized.buttons,
    });

    if (!normalized.parsedFromJson) {
      console.warn(
        `⚠️ [${userId}][${sessionId}] Ответ (${attemptLabel}) не соответствует JSON-формату. Использую текст без кнопок.`
      );
    }

    return normalized;
  } catch (error) {
    if (error.name === 'AbortError') {
      console.error(
        `⏱️ [${userId}][${sessionId}] Таймаут ожидания ответа от AI Gateway (${attemptLabel}), попытка ${attemptNumber} из ${maxAttempts}`
      );
      if (attemptNumber < maxAttempts) {
        console.warn(
          `🔁 [${userId}][${sessionId}] Повторная попытка обращения к AI Gateway (${attemptLabel}), следующая попытка ${attemptNumber + 1} из ${maxAttempts}`
        );
        return requestAssistantMessage(
          messages,
          userId,
          sessionId,
          attemptLabel,
          attemptNumber + 1,
          temperature,
          requestId,
          resolvedMaxTokens,
          resolvedOptions
        );
      }
      const timeoutError = new Error('Превышено время ожидания ответа от AI Gateway');
      timeoutError.code = 'AI_GATEWAY_TIMEOUT';
      timeoutError.timeoutMs = timeoutMs;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export {
  OFFER_DELIVERY_AI_GATEWAY_TIMEOUT_MS,
  estimateOfferDeliveryMaxTokens,
  requestAssistantMessage,
};
