import crypto from 'node:crypto';
import { getMaxConcurrentRequests } from './configService.js';
import { getActiveLLMs } from './loadBalancer.js';
import { callLLM } from './llmService.js';
import { getCache, setCache } from './cacheService.js';

const DEFAULT_FAILOVER_CANDIDATE_TIMEOUT_MS = 45000;
const parsedFailoverCandidateTimeoutMs = Number.parseInt(
  process.env.AI_GATEWAY_FAILOVER_CANDIDATE_TIMEOUT_MS || '',
  10
);
const FAILOVER_CANDIDATE_TIMEOUT_MS =
  Number.isFinite(parsedFailoverCandidateTimeoutMs) && parsedFailoverCandidateTimeoutMs > 0
    ? parsedFailoverCandidateTimeoutMs
    : DEFAULT_FAILOVER_CANDIDATE_TIMEOUT_MS;

export function resolveEffectiveLlmConfig(llm, candidateIndex = 0, totalCandidates = 1) {
  if (!llm || candidateIndex >= totalCandidates - 1) {
    return llm;
  }

  const configuredTimeout =
    Number.isFinite(llm.timeoutMs) && llm.timeoutMs > 0 ? llm.timeoutMs : null;
  const effectiveTimeout =
    configuredTimeout === null
      ? FAILOVER_CANDIDATE_TIMEOUT_MS
      : Math.min(configuredTimeout, FAILOVER_CANDIDATE_TIMEOUT_MS);

  if (configuredTimeout !== null && effectiveTimeout >= configuredTimeout) {
    return llm;
  }

  return {
    ...llm,
    timeoutMs: effectiveTimeout,
  };
}

export function shouldUseRequestCache(requestData = {}) {
  return requestData?.no_cache !== true;
}

class RequestQueue {
  constructor() {
    this.queue = [];
    this.processing = 0;
    this.maxConcurrent = 5;
  }

  async enqueue(requestData) {
    return new Promise((resolve, reject) => {
      this.queue.push({ requestData, resolve, reject });
      this.process();
    });
  }

  async process() {
    if (this.processing >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }

    const { requestData, resolve, reject } = this.queue.shift();
    this.processing++;

    // Обновляем лимит из конфигурации
    this.maxConcurrent = getMaxConcurrentRequests();

    try {
      // Проверяем кеш
      const cacheKey = this.generateCacheKey(requestData);
      const shouldUseCache = shouldUseRequestCache(requestData);

      if (shouldUseCache) {
        const cached = getCache(cacheKey);

        if (cached) {
          resolve(cached);
          return;
        }
      }

      if (!shouldUseCache) {
        console.info('[ai-gateway] cache skipped for request');
      }

      // Пробуем LLM по приоритету, с фоллбеком при ошибке
      const candidates = getActiveLLMs(requestData.type)
        .slice()
        .sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));

      if (candidates.length === 0) {
        throw new Error('Нет доступных LLM');
      }

      let result = null;
      let lastError = null;

      for (let index = 0; index < candidates.length; index += 1) {
        const llm = candidates[index];
        const effectiveLlm = resolveEffectiveLlmConfig(llm, index, candidates.length);
        try {
          console.info(
            `[ai-gateway] LLM -> provider=${effectiveLlm.provider || 'polza'} model=${effectiveLlm.modelId || 'unknown'} ` +
              `priority=${effectiveLlm.priority ?? 100} type=${requestData.type || 'default'} ` +
              `timeout=${effectiveLlm.timeoutMs || 'default'}`
          );
          result = await callLLM(effectiveLlm, requestData);
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          console.warn(
            `⚠️ Ошибка LLM "${effectiveLlm.name || effectiveLlm.modelId || 'unknown'}", пробуем fallback...`,
            error?.message || error
          );
        }
      }

      if (lastError) {
        throw lastError;
      }

      // Сохраняем в кеш
      if (shouldUseCache) {
        setCache(cacheKey, result, requestData.cache_ttl);
      }

      resolve(result);
    } catch (error) {
      reject(error);
    } finally {
      this.processing--;
      this.process();
    }
  }

  generateCacheKey(requestData) {
    const keyString = JSON.stringify({
      messages: requestData.messages,
      type: requestData.type,
      max_tokens: requestData.max_tokens,
      temperature: requestData.temperature,
    });
    return crypto.createHash('md5').update(keyString).digest('hex');
  }

  getStats() {
    return {
      queueLength: this.queue.length,
      processing: this.processing,
      maxConcurrent: this.maxConcurrent,
    };
  }
}

const requestQueue = new RequestQueue();

export function queueRequest(requestData) {
  return requestQueue.enqueue(requestData);
}

export function getQueueStats() {
  return requestQueue.getStats();
}
