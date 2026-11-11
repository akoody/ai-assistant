import { Agent } from 'undici';

const DEFAULT_POLZA_API_URL = 'https://api.polza.ai/api/v1';
const DEFAULT_OLLAMA_API_URL = 'http://localhost:11434';
const DEFAULT_LLM_TIMEOUT_MS = 180000;
const parsedLlmTimeoutMs = Number.parseInt(process.env.AI_GATEWAY_LLM_TIMEOUT_MS || '', 10);
const LLM_TIMEOUT_MS =
  Number.isFinite(parsedLlmTimeoutMs) && parsedLlmTimeoutMs > 0
    ? parsedLlmTimeoutMs
    : DEFAULT_LLM_TIMEOUT_MS;
const LONG_TIMEOUT_AGENT = new Agent({
  headersTimeout: LLM_TIMEOUT_MS,
  bodyTimeout: LLM_TIMEOUT_MS,
});

function buildRequest(llm, params) {
  const provider = (llm.provider || 'polza').toLowerCase();
  const { messages, max_tokens, temperature, stream } = params;

  if (provider === 'ollama') {
    const ollamaOptions = {};
    if (Number.isFinite(temperature)) {
      ollamaOptions.temperature = temperature;
    }
    if (Number.isFinite(max_tokens)) {
      ollamaOptions.num_predict = max_tokens;
    }
    const numCtx = llm.numCtx ?? params.num_ctx ?? 32768;
    if (Number.isFinite(numCtx)) {
      ollamaOptions.num_ctx = numCtx;
    }

    return {
      url: `${llm.baseUrl || DEFAULT_OLLAMA_API_URL}/api/chat`,
      options: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: llm.modelId,
          messages,
          stream: Boolean(stream),
          format: 'json',
          options: ollamaOptions,
        }),
      },
      normalize: async (response) => {
        const data = await response.json();
        return {
          id: data?.id || null,
          object: 'chat.completion',
          created: Math.floor(Date.now() / 1000),
          model: llm.modelId,
          choices: [
            {
              index: 0,
              message: data?.message || { role: 'assistant', content: '' },
              finish_reason: data?.done ? 'stop' : null,
            },
          ],
          usage: data?.usage || {},
        };
      },
    };
  }

  return {
    url: `${llm.baseUrl || DEFAULT_POLZA_API_URL}/chat/completions`,
    options: {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${llm.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: llm.modelId,
        messages,
        max_tokens,
        temperature,
        stream,
      }),
    },
    normalize: (response) => response.json(),
  };
}

export async function callLLM(llm, params) {
  try {
    const { url, options, normalize } = buildRequest(llm, params);
    const timeoutMs = llm.timeoutMs ?? LLM_TIMEOUT_MS;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      dispatcher: LONG_TIMEOUT_AGENT,
    }).finally(() => clearTimeout(timeout));

    if (!response.ok) {
      // Пытаемся извлечь тело ошибки как текст и JSON для диагностики
      const rawBody = await response.text().catch(() => '');
      let parsedError = {};
      try {
        parsedError = rawBody ? JSON.parse(rawBody) : {};
      } catch (_) {
        parsedError = {};
      }

      const err = new Error(
        `LLM API ошибка: ${response.status} - ${parsedError.message || response.statusText}`
      );
      err.statusCode = response.status;
      err.rawBody = rawBody;
      err.parsedError = parsedError;
      throw err;
    }

    return await normalize(response);
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error(
        `Таймаут запроса к LLM (${llm.name || llm.modelId || 'unknown'})`
      );
      timeoutError.cause = error;
      error = timeoutError;
    }
    // Логируем дополнительную информацию, если она есть
    if (error?.rawBody) {
      console.error('Ответ LLM (raw body):', error.rawBody);
    }
    if (error?.parsedError) {
      console.error('Ответ LLM (parsed):', error.parsedError);
    }
    console.error('Ошибка при вызове LLM:', error);
    throw error;
  }
}

export async function checkModelAvailability(llm) {
  try {
    const provider = (llm.provider || 'polza').toLowerCase();

    if (provider === 'ollama') {
      const response = await fetch(`${llm.baseUrl || DEFAULT_OLLAMA_API_URL}/api/tags`, {
        method: 'GET',
      });

      if (!response.ok) {
        return false;
      }

      const data = await response.json();
      const models = data.models || [];
      return models.some((m) => m.name === llm.modelId);
    }

    const response = await fetch(`${llm.baseUrl || DEFAULT_POLZA_API_URL}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${llm.apiKey}`,
      },
    });

    if (!response.ok) {
      return false;
    }

    const data = await response.json();
    const models = data.data || [];
    return models.some((m) => m.id === llm.modelId);
  } catch (error) {
    console.error('Ошибка при проверке модели:', error);
    return false;
  }
}
