// Виджет приложение
(function () {
  'use strict';

  let API_BASE_URL = '';
  let currentUserId = null;
  let currentSessionId = null;
  let currentWidgetToken = null;
  let externalClientId = null;
  let widgetContainer = null;
  let userCreationInFlight = null;
  let lastOfferEvents = [];
  let lastSelectedEventUrl = null;
  let activeRequest = null;
  let chatContextVersion = 0;
  let requestSequence = 0;

  const SCROLL_INDICATOR_STEP_RATIO = 0.9;
  const SCROLL_INDICATOR_GAP_PX = 0;

  const LOCAL_STORAGE_USER_KEY = 'kassirWidgetUserId';
  const LOCAL_STORAGE_SESSION_KEY = 'kassirWidgetSessionId';
  const LOCAL_STORAGE_TOKEN_KEY = 'kassirWidgetToken';
  const FETCH_RETRY_ATTEMPTS = 3;
  const FETCH_RETRY_BASE_DELAY_MS = 500;
  const MAX_CLIENT_ID_LENGTH = 256;

  const CITY_SUBDOMAIN_MAP = Object.freeze({
    msk: 'Москва',
    spb: 'Санкт-Петербург',
    anapa: 'Анапа',
    arh: 'Архангельск',
    astr: 'Астрахань',
    brn: 'Барнаул',
    belgorod: 'Белгород',
    blag: 'Благовещенск',
    bryansk: 'Брянск',
    nov: 'Великий Новгород',
    vl: 'Владивосток',
    vlm: 'Владимир',
    vlg: 'Волгоград',
    vologda: 'Вологда',
    vrn: 'Воронеж',
    gel: 'Геленджик',
    ekb: 'Екатеринбург',
    ivanovo: 'Иваново',
    izhevsk: 'Ижевск',
    irk: 'Иркутск',
    yola: 'Йошкар-Ола',
    kzn: 'Казань',
    kgd: 'Калининград',
    klg: 'Калуга',
    kemerovo: 'Кемерово',
    kirov: 'Киров',
    krd: 'Краснодар',
    krs: 'Красноярск',
    krym: 'Крым',
    kurgan: 'Курган',
    kursk: 'Курск',
    lzr: 'Лазаревское',
    lipetsk: 'Липецк',
    mgn: 'Магнитогорск',
    mkala: 'Махачкала',
    murm: 'Мурманск',
    nabchelny: 'Набережные Челны',
    nn: 'Нижний Новгород',
    novokuznetsk: 'Новокузнецк',
    nvrsk: 'Новороссийск',
    nsk: 'Новосибирск',
    omsk: 'Омск',
    orel: 'Орёл',
    orenburg: 'Оренбург',
    orsk: 'Орск',
    pnz: 'Пенза',
    perm: 'Пермь',
    ptz: 'Петрозаводск',
    kam: 'Петропавловск-Камчатский',
    pskov: 'Псков',
    rnd: 'Ростов-на-Дону',
    rzn: 'Рязань',
    smr: 'Самара',
    saransk: 'Саранск',
    saratov: 'Саратов',
    smolensk: 'Смоленск',
    sochi: 'Сочи',
    sk: 'Ставрополь',
    sur: 'Сургут',
    syktyvkar: 'Сыктывкар',
    tambov: 'Тамбов',
    tver: 'Тверь',
    tlt: 'Тольятти',
    tomsk: 'Томск',
    tula: 'Тула',
    tmn: 'Тюмень',
    ulan: 'Улан-Удэ',
    ulyanovsk: 'Ульяновск',
    ufa: 'Уфа',
    hbr: 'Хабаровск',
    chaik: 'Чайковский',
    cheboksary: 'Чебоксары',
    chel: 'Челябинск',
    cher: 'Череповец',
    chita: 'Чита',
    elista: 'Элиста',
    sakh: 'Южно-Сахалинск',
    yar: 'Ярославль',
  });

  const CITY_BASE_DOMAINS = Object.freeze(['kassir.ru', 'sferaai.ru', 'kassirdev.ru']);

  function normalizeHostname(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/^\.+/, '')
      .replace(/\.+$/, '');
  }

  function normalizeClientId(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    return raw.slice(0, MAX_CLIENT_ID_LENGTH);
  }

  function normalizeWidgetToken(value) {
    const raw = String(value || '').trim();
    return raw || null;
  }

  function buildWidgetHeaders(baseHeaders = {}) {
    const headers = { ...baseHeaders };
    if (currentWidgetToken) {
      headers.Authorization = `Bearer ${currentWidgetToken}`;
    }
    return headers;
  }

  function persistWidgetIdentity({ userId, sessionId = null, widgetToken = null }) {
    currentUserId = userId ? String(userId) : null;
    currentSessionId = sessionId ? String(sessionId) : null;
    currentWidgetToken = normalizeWidgetToken(widgetToken) || currentWidgetToken;

    try {
      if (currentUserId) {
        window.localStorage.setItem(LOCAL_STORAGE_USER_KEY, currentUserId);
      } else {
        window.localStorage.removeItem(LOCAL_STORAGE_USER_KEY);
      }

      if (currentSessionId) {
        window.localStorage.setItem(LOCAL_STORAGE_SESSION_KEY, currentSessionId);
      } else {
        window.localStorage.removeItem(LOCAL_STORAGE_SESSION_KEY);
      }

      if (currentWidgetToken) {
        window.localStorage.setItem(LOCAL_STORAGE_TOKEN_KEY, currentWidgetToken);
      } else {
        window.localStorage.removeItem(LOCAL_STORAGE_TOKEN_KEY);
      }
    } catch (storageError) {
      console.warn('Не удалось сохранить идентификаторы виджета:', storageError);
    }
  }

  function clearWidgetIdentity() {
    currentUserId = null;
    currentSessionId = null;
    currentWidgetToken = null;
    try {
      window.localStorage.removeItem(LOCAL_STORAGE_USER_KEY);
      window.localStorage.removeItem(LOCAL_STORAGE_SESSION_KEY);
      window.localStorage.removeItem(LOCAL_STORAGE_TOKEN_KEY);
    } catch (storageError) {
      console.warn('Не удалось очистить идентификаторы виджета:', storageError);
    }
  }

  function pickEmbeddingHostname() {
    const candidates = [];
    try {
      const params = new URLSearchParams(window.location.search);
      candidates.push(params.get('embeddingHost') || params.get('embedding_host') || '');
    } catch (error) {
      // ignore bad URL params
    }
    const referrer = String(document.referrer || '').trim();
    if (referrer) {
      try {
        candidates.push(new URL(referrer).hostname);
      } catch (error) {
        // ignore bad referrer
      }
    }
    candidates.push(window.location.hostname);

    for (const raw of candidates) {
      const hostname = normalizeHostname(raw);
      if (hostname) return hostname;
    }
    return '';
  }

  function inferCityFromHostname(hostname) {
    const normalizedHost = normalizeHostname(hostname);
    if (!normalizedHost) {
      return null;
    }

    for (const baseDomain of CITY_BASE_DOMAINS) {
      if (normalizedHost === baseDomain || normalizedHost === `www.${baseDomain}`) {
        continue;
      }

      const suffix = `.${baseDomain}`;
      if (!normalizedHost.endsWith(suffix)) {
        continue;
      }

      const subdomainPart = normalizedHost.slice(0, -suffix.length);
      const labels = subdomainPart.split('.').filter(Boolean);
      for (let i = labels.length - 1; i >= 0; i -= 1) {
        const code = labels[i];
        const city = CITY_SUBDOMAIN_MAP[code];
        if (city) {
          return { city, cityCode: code, baseDomain };
        }
      }
    }

    return null;
  }

  function sendAnalyticsEvent(eventName, payload = {}) {
    try {
      const message = {
        type: 'kassir_widget_analytics',
        event: eventName,
        payload: {
          ...payload,
          userId: currentUserId || null,
          sessionId: currentSessionId || null,
          clientId: externalClientId || null,
          timestamp: new Date().toISOString(),
        },
      };
      window.parent.postMessage(message, '*');
    } catch (e) {
      console.warn('[widget] Failed to send analytics event:', e);
    }
  }

  let cachedClientContext = null;

  function isGatewayTimeoutLike(status, contentType, bodyText) {
    const normalizedContentType = String(contentType || '').toLowerCase();
    const normalizedBody = String(bodyText || '').toLowerCase();
    return (
      status === 504 ||
      /text\/html/.test(normalizedContentType) ||
      /gateway time-?out/.test(normalizedBody) ||
      /<html/i.test(String(bodyText || ''))
    );
  }

  function buildFriendlyHttpErrorMessage(status, contentType, bodyText) {
    if (isGatewayTimeoutLike(status, contentType, bodyText)) {
      return 'Сервис временно не ответил. Попробуйте ещё раз через минуту.';
    }

    if (status === 502 || status === 503) {
      return 'Сервис временно недоступен. Попробуйте ещё раз чуть позже.';
    }

    if (status === 429) {
      return 'Слишком много запросов подряд. Попробуйте ещё раз немного позже.';
    }

    return 'Не удалось получить корректный ответ сервера. Попробуйте ещё раз.';
  }

  function toUserFacingErrorMessage(error) {
    const message = String(error?.message || '').trim();
    if (!message) {
      return 'Произошла ошибка. Попробуйте ещё раз.';
    }

    if (
      /gateway time-?out/i.test(message) ||
      /text\/html/i.test(message) ||
      /ожидали json/i.test(message)
    ) {
      return 'Сервис временно не ответил. Попробуйте ещё раз через минуту.';
    }

    if (/failed to fetch|networkerror|load failed|network request failed/i.test(message)) {
      return 'Не удалось связаться с сервером. Проверьте соединение и попробуйте ещё раз.';
    }

    return message;
  }

  function getClientContext() {
    if (cachedClientContext) {
      return cachedClientContext;
    }

    const embeddingHost = pickEmbeddingHostname();
    const inferred = inferCityFromHostname(embeddingHost);

    cachedClientContext = {
      embeddingHost: embeddingHost || null,
      city: inferred?.city || null,
      cityCode: inferred?.cityCode || null,
      baseDomain: inferred?.baseDomain || null,
      citySource: inferred ? 'domain' : null,
      clientId: externalClientId || null,
    };

    return cachedClientContext;
  }

  async function parseJsonResponse(response) {
    const contentType = response?.headers?.get?.('content-type') || '';
    const bodyText = await response.text();

    if (contentType.includes('application/json')) {
      try {
        return JSON.parse(bodyText);
      } catch (error) {
        // continue to error below
      }
    }

    try {
      return JSON.parse(bodyText);
    } catch (error) {
      const friendlyError = new Error(
        buildFriendlyHttpErrorMessage(response?.status, contentType, bodyText)
      );
      friendlyError.status = response?.status;
      friendlyError.contentType = contentType;
      friendlyError.bodyText = bodyText;
      throw friendlyError;
    }
  }

  async function resolveUserByClientId(clientId) {
    const normalizedClientId = normalizeClientId(clientId);
    if (!normalizedClientId) return null;

    const params = new URLSearchParams({ clientId: normalizedClientId });
    const response = await fetchWithRetry(
      `${API_BASE_URL}/api/user/resolve?${params.toString()}`,
      {
        method: 'GET',
        headers: buildWidgetHeaders({
          'Content-Type': 'application/json',
        }),
      },
      { attempts: 2 }
    );

    const data = await parseJsonResponse(response);
    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    if (!data.success || !data.found || !data.userId) {
      return null;
    }

    return {
      userId: String(data.userId),
      sessionId: data.sessionId ? String(data.sessionId) : null,
      widgetToken: data.widgetToken ? String(data.widgetToken) : null,
      clientId: normalizedClientId,
    };
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function isRetryableNetworkError(error) {
    const message = String(error?.message || '');
    return /failed to fetch|networkerror|load failed|network request failed/i.test(message);
  }

  async function fetchWithRetry(url, options = {}, retryOptions = {}) {
    const attempts = Number.isFinite(retryOptions.attempts)
      ? Math.max(1, retryOptions.attempts)
      : FETCH_RETRY_ATTEMPTS;
    const baseDelayMs = Number.isFinite(retryOptions.baseDelayMs)
      ? Math.max(0, retryOptions.baseDelayMs)
      : FETCH_RETRY_BASE_DELAY_MS;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await fetch(url, options);
      } catch (error) {
        const isLastAttempt = attempt >= attempts;
        if (isLastAttempt || !isRetryableNetworkError(error)) {
          throw error;
        }

        const delayMs = baseDelayMs * Math.pow(2, attempt - 1);
        console.warn(
          `[widget] Ошибка сети, повтор запроса (${attempt}/${attempts}) через ${delayMs}мс`,
          error
        );
        await sleep(delayMs);
      }
    }

    throw new Error('Не удалось выполнить запрос');
  }

  function getMessagesContainer() {
    return document.getElementById('kassirWidgetMessages');
  }

  function removeLoadingMessageElement(loadingMessageElement, options = {}) {
    if (!loadingMessageElement || !loadingMessageElement.parentNode) {
      return;
    }

    if (options.immediate) {
      loadingMessageElement.remove();
      return;
    }

    loadingMessageElement.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
    loadingMessageElement.style.opacity = '0';
    loadingMessageElement.style.transform = 'translateY(-10px)';
    setTimeout(() => {
      if (loadingMessageElement && loadingMessageElement.parentNode) {
        loadingMessageElement.remove();
      }
    }, 200);
  }

  function closeTrackedEventSource(trackedRequest) {
    if (!trackedRequest?.eventSource) {
      return;
    }

    try {
      trackedRequest.eventSource.close();
    } catch (closeError) {
      console.warn('⚠️ Не удалось закрыть SSE соединение:', closeError);
    }

    if (window.currentEventSource === trackedRequest.eventSource) {
      window.currentEventSource = null;
    }

    trackedRequest.eventSource = null;
  }

  function isTrackedRequestCurrent(trackedRequest) {
    return Boolean(
      trackedRequest &&
      activeRequest &&
      activeRequest.token === trackedRequest.token &&
      trackedRequest.chatContextVersion === chatContextVersion &&
      trackedRequest.userId === currentUserId
    );
  }

  function clearActiveRequestReference(trackedRequest) {
    if (trackedRequest && activeRequest && activeRequest.token === trackedRequest.token) {
      activeRequest = null;
    }
  }

  function cancelActiveRequest(reason = '') {
    if (!activeRequest) {
      return;
    }

    const trackedRequest = activeRequest;
    console.log('[widget] cancelActiveRequest', {
      reason: reason || 'unspecified',
      requestId: trackedRequest.requestId,
      userId: trackedRequest.userId,
    });

    if (trackedRequest.abortController) {
      try {
        trackedRequest.abortController.abort();
      } catch (abortError) {
        console.warn('⚠️ Не удалось отменить fetch запроса:', abortError);
      }
    }

    closeTrackedEventSource(trackedRequest);
    removeLoadingMessageElement(trackedRequest.loadingMessage, { immediate: true });
    clearActiveRequestReference(trackedRequest);
  }

  function invalidateChatContext(reason = '') {
    cancelActiveRequest(reason);
    chatContextVersion += 1;
  }

  // Проверка наличия скрытого контента ниже видимой области
  function hasHiddenContent(container) {
    if (!container) return false;

    const scrollHeight = container.scrollHeight;
    const scrollTop = container.scrollTop;
    const clientHeight = container.clientHeight;

    // Если контент не превышает высоту контейнера, скрытого контента нет
    if (scrollHeight <= clientHeight) {
      return false;
    }

    // Порог в пикселях (очень маленький для точной проверки)
    // Учитываем возможные погрешности округления браузера
    const threshold = 3;
    const remainingHeight = scrollHeight - scrollTop - clientHeight;

    // Проверяем, есть ли контент ниже текущей видимой области
    // Используем Math.abs для учета возможных отрицательных значений из-за округления
    return Math.abs(remainingHeight) > threshold;
  }

  function setupScrollIndicatorLayoutObserver(widgetFooter) {
    if (!widgetFooter || typeof ResizeObserver === 'undefined') return;

    const widgetWrap = widgetFooter.closest('.widget-wrap');
    if (!widgetWrap) return;

    const existingObserver = widgetWrap._scrollIndicatorLayoutObserver;
    if (existingObserver && widgetWrap._scrollIndicatorObservedFooter === widgetFooter) {
      return;
    }

    if (existingObserver) {
      existingObserver.disconnect();
    }

    const observer = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        updateScrollIndicator();
      });
    });

    observer.observe(widgetFooter);

    const inputWrap = widgetFooter.querySelector('.input-wrap');
    if (inputWrap) {
      observer.observe(inputWrap);
    }

    widgetWrap._scrollIndicatorLayoutObserver = observer;
    widgetWrap._scrollIndicatorObservedFooter = widgetFooter;
  }

  // Создание/обновление визуального индикатора скрытого контента
  function updateScrollIndicator() {
    const messagesContainer = getMessagesContainer();
    if (!messagesContainer) return;

    // Находим widget-body, footer и общий контейнер для размещения индикатора
    const widgetBody = messagesContainer.closest('.widget-body');
    if (!widgetBody) return;
    // Footer находится внутри widget-body, а не соседним элементом
    const widgetFooter = widgetBody.querySelector('.widget-footer');
    if (!widgetFooter) return;
    const widgetWrap = widgetBody.closest('.widget-wrap');
    if (!widgetWrap) return;

    // Проверяем наличие скрытого контента в контейнере сообщений
    const hasHidden = hasHiddenContent(messagesContainer);

    // Ищем или создаем индикатор внутри widget-wrap (позиционируем относительно wrap)
    let indicator = widgetWrap.querySelector('.scroll-indicator');

    if (hasHidden) {
      if (!indicator) {
        // Создаем индикатор
        indicator = document.createElement('div');
        indicator.className = 'scroll-indicator';

        // Стрелка вниз
        const arrow = document.createElement('button');
        arrow.className = 'scroll-indicator-arrow';
        arrow.type = 'button';
        arrow.title = 'Прокрутить к новым сообщениям';
        arrow.setAttribute('aria-label', 'Прокрутить к новым сообщениям');
        arrow.innerHTML = `
          <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M7.41 8.59L12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z"/>
          </svg>
        `;
        arrow.addEventListener('click', scrollDownByViewport);
        arrow.dataset.scrollHandlerAttached = 'true';
        indicator.appendChild(arrow);

        widgetWrap.appendChild(indicator);
      } else {
        const existingArrow = indicator.querySelector('.scroll-indicator-arrow');
        if (existingArrow && !existingArrow.dataset.scrollHandlerAttached) {
          existingArrow.addEventListener('click', scrollDownByViewport);
          existingArrow.dataset.scrollHandlerAttached = 'true';
        }
      }

      // Размещаем индикатор вплотную к самому полю ввода, чтобы не оставлять
      // пустую полосу из-за внутренних отступов футера.
      const wrapRect = widgetWrap.getBoundingClientRect();
      const indicatorAnchor = widgetFooter.querySelector('.input-wrap') || widgetFooter;
      const anchorRect = indicatorAnchor.getBoundingClientRect();
      const footerOffsetFromBottom = Math.max(
        wrapRect.bottom - anchorRect.top,
        widgetFooter.offsetHeight || 0
      );
      indicator.style.top = 'auto';
      indicator.style.bottom = `${footerOffsetFromBottom + SCROLL_INDICATOR_GAP_PX}px`;

      // Показываем индикатор
      requestAnimationFrame(() => {
        if (indicator) {
          // Повторная проверка перед показом для точности
          const shouldShow = hasHiddenContent(messagesContainer);
          if (shouldShow) {
            indicator.classList.add('visible');
          } else {
            indicator.classList.remove('visible');
          }
        }
      });
    } else {
      // Скрываем индикатор при достижении конца
      if (indicator) {
        indicator.classList.remove('visible');
      }
    }
  }

  // Обработчик прокрутки для обновления индикатора
  function setupScrollListener() {
    const messagesContainer = getMessagesContainer();
    if (!messagesContainer) return;
    const widgetBody = messagesContainer.closest('.widget-body');
    const widgetFooter = widgetBody ? widgetBody.querySelector('.widget-footer') : null;

    // Удаляем предыдущий обработчик, если он был
    messagesContainer.removeEventListener('scroll', handleScroll);

    // Добавляем новый обработчик
    messagesContainer.addEventListener('scroll', handleScroll, { passive: true });

    // Добавляем обработчик изменения размера окна
    if (!window.scrollIndicatorResizeHandler) {
      window.scrollIndicatorResizeHandler = () => {
        setTimeout(() => {
          updateScrollIndicator();
        }, 100);
      };
      window.addEventListener('resize', window.scrollIndicatorResizeHandler, { passive: true });
    }

    setupScrollIndicatorLayoutObserver(widgetFooter);

    // Индикатор позиционируется относительно widget-wrap, доп. вычисления не требуются
  }

  function handleScroll() {
    // Используем requestAnimationFrame для более плавной и точной проверки
    requestAnimationFrame(() => {
      updateScrollIndicator();
    });
  }

  // Прокрутка вниз при клике на индикатор: на 90% экрана, чтобы оставить контекст
  function scrollDownByViewport() {
    const messagesContainer = getMessagesContainer();
    if (!messagesContainer) return;

    const viewportHeight = messagesContainer.clientHeight || 0;
    if (viewportHeight === 0) return;

    const step = viewportHeight * SCROLL_INDICATOR_STEP_RATIO;
    const maxScrollTop = Math.max(messagesContainer.scrollHeight - viewportHeight, 0);
    const targetTop = Math.min(messagesContainer.scrollTop + step, maxScrollTop);

    messagesContainer.scrollTo({
      top: targetTop,
      behavior: 'smooth',
    });

    // Обновляем индикатор после смещения, чтобы скрыть его у конца списка
    setTimeout(() => {
      updateScrollIndicator();
    }, 300);
  }

  function ensureBottomSpacer(container) {
    if (!container) return;
    let spacer = container.querySelector('.messages-bottom-spacer');
    if (!spacer) {
      spacer = document.createElement('div');
      spacer.className = 'messages-bottom-spacer';
      spacer.style.height = '22px';
    }
    container.appendChild(spacer);
  }

  function appendMessageText(container, text) {
    if (typeof text !== 'string' || text.length === 0) return;

    // никогда не рендерим сообщения через innerHTML.
    const workingText = text;

    const lines = workingText.split(/\n+/);

    lines.forEach((rawLine) => {
      const line = rawLine.trim();
      if (!line) {
        return;
      }

      const paragraph = document.createElement('p');
      const cleaned = line.replace(/~$/g, '').trim();
      if (cleaned) {
        paragraph.textContent = cleaned;
      }

      if (paragraph.childNodes.length > 0 || paragraph.textContent) {
        container.appendChild(paragraph);
      }
    });
  }

  function handleBotButtonClick(value) {
    const sendBtn = document.getElementById('kassirWidgetSendBtn');
    if (sendBtn && sendBtn.getAttribute('disabled')) {
      return;
    }

    const normalized = typeof value === 'string' ? value.trim() : '';
    const normalizedLower = normalized.toLowerCase().replace(/ё/g, 'е');
    const isBuyTickets =
      normalizedLower === 'купить билеты' ||
      normalizedLower === 'купить билет' ||
      normalizedLower === 'покупка билетов' ||
      normalizedLower === 'покупка билета' ||
      normalizedLower === 'оформить билеты' ||
      normalizedLower === 'оформить билет' ||
      normalizedLower === 'перейти к покупке';

    if (isBuyTickets) {
      const candidateUrl =
        (typeof lastSelectedEventUrl === 'string' ? lastSelectedEventUrl.trim() : '') ||
        (Array.isArray(lastOfferEvents) && lastOfferEvents.length === 1
          ? String(lastOfferEvents[0]?.url || '').trim()
          : '');

      if (candidateUrl) {
        try {
          const url = new URL(candidateUrl, window.location.href);
          if (url.protocol === 'http:' || url.protocol === 'https:') {
            window.open(url.toString(), '_blank', 'noopener,noreferrer');
            return;
          }
        } catch (_e) {}
      }
    }

    const input = document.getElementById('kassirWidgetInput');
    if (input) {
      input.disabled = false;
      input.value = value;
    }
    sendMessage();
  }

  // Инициализация виджета
  function initWidget(config) {
    API_BASE_URL = config.apiUrl || '';
    widgetContainer = config.container;
    externalClientId = normalizeClientId(
      config.clientId ||
        (() => {
          try {
            const params = new URLSearchParams(window.location.search);
            return params.get('client_id') || params.get('clientId') || '';
          } catch {
            return '';
          }
        })()
    );

    // Создаем HTML структуру виджета
    createWidgetHTML();

    // Привязываем обработчики
    bindHandlers();

    // Базовое приветствие для новых пользователей
    renderInitialMessage();

    // Пытаемся восстановить прошлую сессию
    restoreSession()
      .then((restored) => {
        if (restored) {
          return;
        }
        // Если сессии нет — создаём пользователя автоматически, чтобы виджет был готов к диалогу.
        createNewUser({ openWidget: false, forceNew: false }).catch((error) => {
          console.error('Ошибка при автоматическом создании пользователя:', error);
        });
      })
      .catch((error) => {
        console.error('Ошибка при восстановлении сессии виджета:', error);
      });

    // Если есть кнопка "Новый пользователь" на странице, привязываем её
    if (config.newUserButton) {
      config.newUserButton.addEventListener('click', createNewUser);
    }

    sendAnalyticsEvent('widget_ready');
  }

  // Создание HTML структуры виджета
  function createWidgetHTML() {
    if (!widgetContainer) return;
    const tooltipArcTopPathId = `kassirWidgetArcTopPath-${Math.random().toString(36).slice(2, 10)}`;
    const tooltipArcBottomPathId = `kassirWidgetArcBottomPath-${Math.random().toString(36).slice(2, 10)}`;

    widgetContainer.innerHTML = `
      <div class="widget-wrap collapsed" id="kassirWidget" role="dialog" aria-label="Чат-консьерж">
        <button class="widget-dock-btn" id="kassirWidgetDockBtn" type="button" aria-label="Спрятать виджет у края" title="Спрятать у края">
          <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
            <path d="M9 6.5L14.5 12L9 17.5"></path>
          </svg>
        </button>
        <button class="widget-dock-tab" id="kassirWidgetDockTab" type="button" aria-label="Показать виджет" title="Показать виджет">
          <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
            <path d="M14.71 6.71a1 1 0 0 0-1.42-1.42l-6 6a1 1 0 0 0 0 1.42l6 6a1 1 0 0 0 1.42-1.42L9.41 12l5.3-5.29z"></path>
          </svg>
        </button>
        <button class="widget-toggle-btn" id="kassirWidgetToggleBtn" aria-label="Развернуть виджет">
          <div class="widget-arc-tooltip" aria-hidden="true">
            <svg class="widget-arc-tooltip-svg" viewBox="0 0 220 220" focusable="false" aria-hidden="true">
              <path id="${tooltipArcTopPathId}" class="widget-arc-tooltip-bg widget-arc-tooltip-bg-top" pathLength="100" d="M 17 110 A 93 93 0 0 1 203 110"></path>
              <path id="${tooltipArcBottomPathId}" class="widget-arc-tooltip-bg widget-arc-tooltip-bg-bottom" pathLength="100" d="M 17 110 A 93 93 0 0 0 203 110"></path>
              <text class="widget-arc-tooltip-text widget-arc-tooltip-text-top" dy="8">
                <textPath href="#${tooltipArcTopPathId}" startOffset="50%" text-anchor="middle">Помогу</textPath>
              </text>
              <text class="widget-arc-tooltip-text widget-arc-tooltip-text-bottom" dy="8">
                <textPath href="#${tooltipArcBottomPathId}" startOffset="50%" text-anchor="middle">С Выбором</textPath>
              </text>
            </svg>
          </div>
          <img src="img/assistant-robot.png" alt="Ассистент">
        </button>
        <div class="widget-header">
          <div class="avatar" aria-hidden="true">
            <img src="img/assistant-robot.png" alt="Ассистент">
          </div>
          <div class="header-text">
            <h3 class="header-title">Культурный ассистент</h3>
            <p class="header-sub"><span class="header-sub-first">Ваш персональный навигатор</span><span class="header-sub-break">в мире досуга</span></p>
          </div>
          <div class="close-btn" id="kassirWidgetCloseBtn" title="Свернуть">
            <img src="img/baf.png">
          </div>
        </div>
        <div class="widget-body">
          <div class="messages" id="kassirWidgetMessages">
      <div class="afish_card">
            <div class="back_img_afish" style="background: url(img/jaz.png); background-size: cover;">  <div class="plashk_card_afisha"><strong>от 1600 ₽</strong></div>  </div>
            <div class="text_part_afish">
              <h6>Джаз на воде</h6>
              <span>сентябрь - декабрь</span>
              <h5>Теплоход “Ривер Палас” (River Palace)</h5>
            </div>
          </div>
          </div>
          <div class="widget-footer">
            <div class="input-row">
              <div class="input-wrap">
                <textarea 
                  type="text" 
                  id="kassirWidgetInput" 
                  placeholder="Введите сообщение" 
                  aria-label="Введите сообщение"
                  disabled
                ></textarea>
                <div class="send-btn" id="kassirWidgetSendBtn" aria-hidden="true" title="Отправить">
                  <img src="img/Vector.png">
                </div>


              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    const messagesContainer = getMessagesContainer();
    ensureBottomSpacer(messagesContainer);

    // Настраиваем обработчик прокрутки после создания HTML
    setTimeout(() => {
      setupScrollListener();
    }, 100);
  }

  function renderInitialMessage() {
    const messagesContainer = getMessagesContainer();
    if (!messagesContainer) return;

    messagesContainer.innerHTML = '';
    addMessage(
      'Здравствуйте! Я ИИ-помощник. Я здесь, чтобы подсказать вам, какие интересные события проходят в вашем городе. Напишите мне и я найду для вас что-то особенное',
      'bot'
    );
  }

  async function restoreSession() {
    let savedUserId = null;
    let savedSessionId = null;
    let savedWidgetToken = null;

    try {
      savedUserId = window.localStorage.getItem(LOCAL_STORAGE_USER_KEY);
      savedSessionId = window.localStorage.getItem(LOCAL_STORAGE_SESSION_KEY);
      savedWidgetToken = window.localStorage.getItem(LOCAL_STORAGE_TOKEN_KEY);
    } catch (storageError) {
      console.warn('Не удалось получить данные из localStorage:', storageError);
    }
    currentWidgetToken = normalizeWidgetToken(savedWidgetToken);

    if (savedUserId && currentWidgetToken) {
      currentUserId = savedUserId;
      currentSessionId = savedSessionId || null;
    } else if (externalClientId) {
      try {
        const resolved = await resolveUserByClientId(externalClientId);
        if (!resolved?.userId) {
          return false;
        }
        persistWidgetIdentity({
          userId: resolved.userId,
          sessionId: resolved.sessionId || null,
          widgetToken: resolved.widgetToken || null,
        });
      } catch (resolveError) {
        console.warn('Не удалось восстановить пользователя по client_id:', resolveError);
        return false;
      }
    } else {
      if (savedUserId || savedSessionId || savedWidgetToken) {
        clearWidgetIdentity();
      }
      return false;
    }

    const historyLoaded = await loadHistory();
    if (historyLoaded === false) {
      return false;
    }

    const input = document.getElementById('kassirWidgetInput');
    if (input) {
      input.disabled = false;
    }
    setSendButtonDisabled(false);

    return true;
  }

  async function loadHistory() {
    if (!currentUserId) {
      return;
    }

    const messagesContainer = getMessagesContainer();
    if (!messagesContainer) {
      return;
    }

    let authFailed = false;

    try {
      const params = new URLSearchParams({ userId: currentUserId });
      if (externalClientId) {
        params.append('clientId', externalClientId);
      }
      const response = await fetch(`${API_BASE_URL}/api/chat/history?${params.toString()}`, {
        method: 'GET',
        headers: buildWidgetHeaders({
          'Content-Type': 'application/json',
        }),
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          authFailed = true;
          clearWidgetIdentity();
        }
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await parseJsonResponse(response);
      if (!data.success || !Array.isArray(data.messages)) {
        renderInitialMessage();
        return;
      }

      if (data.userId && typeof data.userId === 'string') {
        currentUserId = data.userId;
      }

      if (data.messages.length === 0) {
        renderInitialMessage();
        return;
      }

      messagesContainer.innerHTML = '';

      data.messages.forEach((msg) => {
        const role = msg.role === 'assistant' ? 'bot' : 'user';
        const buttons = Array.isArray(msg.metadata?.buttons) ? msg.metadata.buttons : [];

        const hasOfferCards =
          msg.role === 'assistant' &&
          msg.metadata &&
          msg.metadata.offer &&
          Array.isArray(msg.metadata.offer.events) &&
          msg.metadata.offer.events.length > 0;

        // Сначала карточки, потом текст
        if (hasOfferCards) {
          addEventCards(msg.metadata.offer.events);
        }

        addMessage(msg.content, role, { buttons });

        if (msg.sessionId) {
          currentSessionId = msg.sessionId;
        }
      });

      if (currentSessionId) {
        try {
          window.localStorage.setItem(LOCAL_STORAGE_SESSION_KEY, currentSessionId);
        } catch (storageError) {
          console.warn('Не удалось сохранить sessionId в localStorage:', storageError);
        }
      }

      // Проверяем наличие скрытого контента после загрузки истории
      setTimeout(() => {
        updateScrollIndicator();
        setupScrollListener();
      }, 300);
      return true;
    } catch (error) {
      console.error('Ошибка загрузки истории сообщений виджета:', error);
      renderInitialMessage();
      return authFailed ? false : true;
    }
  }

  // Привязка обработчиков
  function bindHandlers() {
    const closeBtn = document.getElementById('kassirWidgetCloseBtn');
    const toggleBtn = document.getElementById('kassirWidgetToggleBtn');
    const dockBtn = document.getElementById('kassirWidgetDockBtn');
    const dockTab = document.getElementById('kassirWidgetDockTab');
    const sendBtn = document.getElementById('kassirWidgetSendBtn');
    const input = document.getElementById('kassirWidgetInput');
    const widget = document.getElementById('kassirWidget');
    const newUserBtn = document.getElementById('kassirWidgetNewUserBtn');

    // Кнопка закрытия - сворачивает виджет
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        collapseWidget();
        sendAnalyticsEvent('widget_collapsed');
      });
    }

    // Кнопка разворачивания (свернутый вид)
    if (toggleBtn) {
      toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (toggleBtn.dataset.skipNextClick === 'true') {
          delete toggleBtn.dataset.skipNextClick;
          return;
        }
        expandWidget();
        sendAnalyticsEvent('widget_expanded');
      });
    }

    if (dockBtn) {
      dockBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        tuckCollapsedWidget();
        sendAnalyticsEvent('widget_tucked');
      });
    }

    if (dockTab) {
      dockTab.addEventListener('click', (e) => {
        e.stopPropagation();
        untuckCollapsedWidget();
        sendAnalyticsEvent('widget_untucked');
      });
    }

    setupCollapsedSwipeToTuck(widget, toggleBtn);

    if (sendBtn) {
      sendBtn.addEventListener('click', function () {
        if (!sendBtn.getAttribute('disabled')) {
          sendMessage();
        }
      });
    }

    if (input) {
      input.addEventListener('keypress', (e) => {
        const sendBtn = document.getElementById('kassirWidgetSendBtn');
        if (e.key === 'Enter' && sendBtn && !sendBtn.getAttribute('disabled')) {
          sendMessage();
        }
      });
    }

    if (newUserBtn) {
      newUserBtn.addEventListener('click', () => {
        createNewUser();
      });
    }
  }

  function setupCollapsedSwipeToTuck(widget, toggleBtn) {
    if (!widget || !toggleBtn || toggleBtn.dataset.swipeToTuckAttached === 'true') {
      return;
    }

    toggleBtn.dataset.swipeToTuckAttached = 'true';

    let swipeStart = null;

    const canStartSwipe = () =>
      widget.classList.contains('collapsed') &&
      !widget.classList.contains('is-tucked') &&
      !widget.classList.contains('is-collapsing');

    const startSwipe = (clientX, clientY, pointerId = null) => {
      if (!canStartSwipe()) {
        swipeStart = null;
        return;
      }
      swipeStart = { clientX, clientY, pointerId };
    };

    const finishSwipe = (clientX, clientY, pointerId = null, event = null) => {
      if (!swipeStart) return;
      if (swipeStart.pointerId !== null && pointerId !== swipeStart.pointerId) return;

      const deltaX = clientX - swipeStart.clientX;
      const deltaY = clientY - swipeStart.clientY;
      swipeStart = null;

      if (deltaX < 34 || Math.abs(deltaY) > 34) {
        return;
      }

      if (event) {
        event.preventDefault();
        event.stopPropagation();
      }
      toggleBtn.dataset.skipNextClick = 'true';
      tuckCollapsedWidget();
      sendAnalyticsEvent('widget_tucked_swipe');
    };

    toggleBtn.addEventListener(
      'click',
      (event) => {
        if (toggleBtn.dataset.skipNextClick === 'true') {
          delete toggleBtn.dataset.skipNextClick;
          event.preventDefault();
          event.stopPropagation();
        }
      },
      true
    );

    toggleBtn.addEventListener('pointerdown', (event) => {
      startSwipe(event.clientX, event.clientY, event.pointerId);
    });

    window.addEventListener(
      'pointerup',
      (event) => {
        finishSwipe(event.clientX, event.clientY, event.pointerId, event);
      },
      { capture: true }
    );

    window.addEventListener(
      'pointercancel',
      () => {
        swipeStart = null;
      },
      { capture: true }
    );

    toggleBtn.addEventListener(
      'touchstart',
      (event) => {
        const touch = event.changedTouches?.[0];
        if (touch) startSwipe(touch.clientX, touch.clientY);
      },
      { passive: true }
    );

    window.addEventListener(
      'touchend',
      (event) => {
        const touch = event.changedTouches?.[0];
        if (touch) finishSwipe(touch.clientX, touch.clientY, null, event);
      },
      { capture: true }
    );

    window.addEventListener(
      'touchcancel',
      () => {
        swipeStart = null;
      },
      { capture: true }
    );
  }

  let collapseAnimationNonce = 0;

  function waitForTransitionEnd(element, propertyNames, timeoutMs) {
    return new Promise((resolve) => {
      if (!element) return resolve();

      let settled = false;
      const remaining = new Set(Array.isArray(propertyNames) ? propertyNames : []);
      const finish = () => {
        if (settled) return;
        settled = true;
        element.removeEventListener('transitionend', onEnd);
        clearTimeout(timer);
        resolve();
      };

      const onEnd = (event) => {
        if (event.target !== element) return;
        if (remaining.size === 0) {
          return finish();
        }

        if (!remaining.has(event.propertyName)) {
          return;
        }

        remaining.delete(event.propertyName);
        if (remaining.size === 0) {
          finish();
        }
      };

      const timer = window.setTimeout(finish, Number(timeoutMs) || 0);
      element.addEventListener('transitionend', onEnd);
    });
  }

  // Свернуть виджет
  async function collapseWidget() {
    const widget = document.getElementById('kassirWidget');
    if (!widget) return;

    if (widget.classList.contains('collapsed') || widget.classList.contains('is-collapsing')) {
      return;
    }

    // На всякий случай скрываем индикатор, если он был видим
    const indicator = widget.querySelector('.scroll-indicator');
    if (indicator) {
      indicator.classList.remove('visible');
    }

    const currentNonce = ++collapseAnimationNonce;
    widget.classList.add('is-collapsing');
    notifyParentWidgetState(true);
    await waitForTransitionEnd(widget, ['width', 'height'], 520);

    if (currentNonce !== collapseAnimationNonce) {
      return;
    }

    widget.classList.add('collapsed');
    widget.classList.remove('is-collapsing');
    widget.classList.remove('is-tucked');
    notifyParentWidgetState(true);
  }

  // Развернуть виджет
  function expandWidget() {
    const widget = document.getElementById('kassirWidget');
    notifyParentWidgetState(false);
    if (widget) {
      collapseAnimationNonce++;
      widget.classList.remove('collapsed');
      widget.classList.remove('is-collapsing');
      widget.classList.remove('is-tucked');
      // Активируем поле ввода, если пользователь создан
      const input = document.getElementById('kassirWidgetInput');
      if (input && currentUserId) {
        input.disabled = false;
        setTimeout(() => input.focus(), 100);
      }
    }
  }

  function tuckCollapsedWidget() {
    const widget = document.getElementById('kassirWidget');
    if (!widget) return;

    if (!widget.classList.contains('collapsed')) {
      collapseWidget();
      window.setTimeout(tuckCollapsedWidget, 360);
      return;
    }

    widget.classList.add('is-tucked');
    notifyParentWidgetState(true);
  }

  function untuckCollapsedWidget() {
    const widget = document.getElementById('kassirWidget');
    if (!widget) return;

    widget.classList.remove('is-tucked');
    notifyParentWidgetState(true);
  }

  function notifyParentWidgetState(collapsed) {
    try {
      if (window.parent && window.parent !== window) {
        const widget = document.getElementById('kassirWidget');
        window.parent.postMessage(
          {
            type: 'widgetState',
            collapsed: Boolean(collapsed),
            tucked: Boolean(collapsed && widget?.classList.contains('is-tucked')),
          },
          '*'
        );
      }
    } catch (error) {
      // no-op
    }
  }

  // Показать виджет (развернуть)
  function showWidget() {
    expandWidget();
  }

  // Управление disabled состоянием кнопки
  function setSendButtonDisabled(disabled) {
    const sendBtn = document.getElementById('kassirWidgetSendBtn');
    if (sendBtn) {
      if (disabled) {
        sendBtn.setAttribute('disabled', 'true');
      } else {
        sendBtn.removeAttribute('disabled');
      }
    }
  }

  // Создание нового пользователя
  async function createNewUser(options = {}) {
    if (userCreationInFlight) {
      return userCreationInFlight;
    }

    const shouldOpenWidget = options && options.openWidget === false ? false : true;
    const forceNew =
      options && Object.prototype.hasOwnProperty.call(options, 'forceNew')
        ? Boolean(options.forceNew)
        : true;

    userCreationInFlight = (async () => {
      try {
        console.log('[widget] createNewUser: start', {
          prevUserId: currentUserId,
          prevSessionId: currentSessionId,
        });
        invalidateChatContext('create-new-user');
        const input = document.getElementById('kassirWidgetInput');
        const newUserBtn = document.getElementById('kassirWidgetNewUserBtn');

        if (input) input.disabled = true;
        setSendButtonDisabled(true);
        if (newUserBtn) {
          newUserBtn.disabled = true;
        }

        try {
          window.localStorage.removeItem(LOCAL_STORAGE_USER_KEY);
          window.localStorage.removeItem(LOCAL_STORAGE_SESSION_KEY);
          window.localStorage.removeItem(LOCAL_STORAGE_TOKEN_KEY);
        } catch (storageError) {
          console.warn(
            'Не удалось очистить localStorage перед созданием пользователя:',
            storageError
          );
        }

        if (shouldOpenWidget) {
          showWidget();
        }

        let response = await fetch(`${API_BASE_URL}/api/user/create`, {
          method: 'POST',
          headers: buildWidgetHeaders({
            'Content-Type': 'application/json',
          }),
          body: JSON.stringify({
            clientId: externalClientId || null,
            forceNew,
          }),
        });

        let data = await parseJsonResponse(response);
        if (
          !response.ok &&
          externalClientId &&
          (response.status === 401 || response.status === 409)
        ) {
          console.warn(
            '[widget] Не удалось восстановить защищенную clientId-сессию, создаю новую локальную сессию без перепривязки clientId'
          );
          externalClientId = null;
          currentWidgetToken = null;
          response = await fetch(`${API_BASE_URL}/api/user/create`, {
            method: 'POST',
            headers: buildWidgetHeaders({
              'Content-Type': 'application/json',
            }),
            body: JSON.stringify({
              clientId: null,
              forceNew: true,
            }),
          });
          data = await parseJsonResponse(response);
        }

        if (!response.ok) {
          throw new Error(data.error || `HTTP ${response.status}`);
        }

        if (data.success) {
          persistWidgetIdentity({
            userId: data.userId,
            sessionId: data.sessionId || null,
            widgetToken: data.widgetToken || null,
          });
          lastOfferEvents = [];
          lastSelectedEventUrl = null;
          console.log('[widget] createNewUser: success', {
            userId: currentUserId,
            sessionId: currentSessionId,
          });

          // Разворачиваем виджет при создании нового пользователя (если требуется)
          if (shouldOpenWidget) {
            expandWidget();
          }

          // Активируем поле ввода и кнопку отправки
          if (input) {
            input.disabled = false;
            setTimeout(() => {
              input.focus();
            }, 200);
          }
          setSendButtonDisabled(false);
          if (newUserBtn) {
            newUserBtn.disabled = false;
          }

          if (data.restored) {
            await loadHistory();
          } else {
            // Очищаем сообщения и показываем приветствие
            renderInitialMessage();
          }
        } else {
          throw new Error(data.error || 'Ошибка создания пользователя');
        }
      } catch (error) {
        console.error('Ошибка создания пользователя:', error);
        // Активируем поле ввода даже при ошибке, чтобы пользователь мог попробовать снова
        const input = document.getElementById('kassirWidgetInput');
        const newUserBtn = document.getElementById('kassirWidgetNewUserBtn');
        if (input) {
          input.disabled = false;
        }
        setSendButtonDisabled(false);
        if (newUserBtn) {
          newUserBtn.disabled = false;
        }
        addMessage(`❌ ${toUserFacingErrorMessage(error)}`, 'bot');
        throw error;
      }
    })();

    try {
      return await userCreationInFlight;
    } finally {
      userCreationInFlight = null;
    }
  }

  // Начать новый чат с тем же пользователем
  function startNewChat() {
    if (!currentUserId) {
      console.warn('⚠️ Невозможно начать новый чат: пользователь не определен');
      return;
    }

    console.log('🔄 Начинаем новый чат для пользователя:', currentUserId, {
      prevSessionId: currentSessionId,
    });
    invalidateChatContext('start-new-chat');

    // Очищаем sessionId - это создаст новую сессию при следующем запросе
    currentSessionId = null;
    lastOfferEvents = [];
    lastSelectedEventUrl = null;

    // Удаляем sessionId из localStorage, но сохраняем userId
    try {
      window.localStorage.removeItem(LOCAL_STORAGE_SESSION_KEY);
      console.log('✅ SessionId очищен из localStorage');
    } catch (storageError) {
      console.warn('⚠️ Не удалось очистить sessionId из localStorage:', storageError);
    }

    // Очищаем историю сообщений в UI
    renderInitialMessage();

    // Фокусируем поле ввода
    const input = document.getElementById('kassirWidgetInput');
    if (input && !input.disabled) {
      setTimeout(() => {
        input.focus();
      }, 100);
    }

    console.log('✅ Новый чат начат! Предпочтения пользователя сохранены.');
  }

  // Отправка сообщения
  async function sendMessage() {
    const input = document.getElementById('kassirWidgetInput');
    const message = input ? input.value.trim() : '';

    if (!message || !currentUserId) {
      return;
    }

    cancelActiveRequest('send-message-replaced');

    // Добавляем сообщение пользователя
    addMessage(message, 'user');
    sendAnalyticsEvent('user_message_sent', { message });
    if (input) {
      // Очищаем значение
      input.value = '';
      // Полностью удаляем все inline стили высоты и класс
      input.style.removeProperty('height');
      input.style.removeProperty('min-height');
      input.style.removeProperty('max-height');
      input.classList.remove('has-content');
      // Принудительно пересчитываем
      void input.offsetHeight;
    }
    if (input) input.disabled = true;
    setSendButtonDisabled(true);

    // Создаем requestId на клиенте для отслеживания статусов
    const requestId = `${currentUserId}_${Date.now()}`;
    const requestToken = `req-${++requestSequence}`;
    const trackedRequest = {
      token: requestToken,
      requestId,
      userId: currentUserId,
      chatContextVersion,
      abortController: new AbortController(),
      loadingMessage: null,
      eventSource: null,
    };

    // Показываем индикатор загрузки с начальным статусом (с плавным появлением)
    const loadingMessage = addMessage('', 'bot');
    trackedRequest.loadingMessage = loadingMessage;
    activeRequest = trackedRequest;
    if (loadingMessage) {
      const span = document.createElement('span');
      span.className = 'loading status-fade-in';
      span.textContent = 'Анализируем запрос';
      loadingMessage.appendChild(span);
    }
    // Убираем класс fade-in после появления
    setTimeout(() => {
      const statusSpan = loadingMessage?.querySelector('.loading');
      if (statusSpan) {
        statusSpan.classList.remove('status-fade-in');
      }
    }, 600);
    // Подключаемся к SSE СРАЗУ после отправки запроса
    console.log('🔌 Подключение к SSE для requestId:', requestId);
    const eventSource = connectToStatusStream(trackedRequest);
    trackedRequest.eventSource = eventSource;

    try {
      const clientContext = getClientContext();
      const response = await fetchWithRetry(
        `${API_BASE_URL}/api/chat/message`,
        {
          method: 'POST',
          headers: buildWidgetHeaders({
            'Content-Type': 'application/json',
          }),
          signal: trackedRequest.abortController.signal,
          body: JSON.stringify({
            userId: currentUserId,
            sessionId: currentSessionId,
            clientId: externalClientId || null,
            message: message,
            requestId: requestId, // Передаем requestId в запросе
            clientContext,
          }),
        },
        { attempts: 3 }
      );

      const data = await parseJsonResponse(response);

      if (!isTrackedRequestCurrent(trackedRequest)) {
        console.log('[widget] Игнорирую устаревший HTTP-ответ', {
          requestId,
          currentUserId,
          requestUserId: trackedRequest.userId,
        });
        return;
      }

      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }

      if (data.success) {
        persistWidgetIdentity({
          userId: data.userId || currentUserId,
          sessionId: data.sessionId || null,
          widgetToken: data.widgetToken || null,
        });

        // Удаляем индикатор загрузки сразу при получении ответа
        // Не ждем статус "completed" через SSE, так как ответ уже получен
        removeLoadingMessageElement(loadingMessage);

        // Добавляем карточки событий, если есть (сначала карточки, потом текст)
        if (
          data.offer &&
          data.offer.events &&
          Array.isArray(data.offer.events) &&
          data.offer.events.length > 0
        ) {
          // Всегда показываем карточки в едином формате (сетка)
          addEventCards(data.offer.events);
        }

        if (data.message) {
          addMessage(data.message, 'bot', {
            buttons: Array.isArray(data.buttons) ? data.buttons : [],
          });
        }

        // Проверяем наличие скрытого контента после получения ответа
        setTimeout(() => {
          updateScrollIndicator();
        }, 300);
      } else {
        throw new Error(data.error || 'Ошибка отправки сообщения');
      }
    } catch (error) {
      if (error?.name === 'AbortError') {
        console.log('[widget] HTTP-запрос отменен:', requestId);
        return;
      }

      if (!isTrackedRequestCurrent(trackedRequest)) {
        console.log('[widget] Игнорирую ошибку устаревшего запроса:', requestId, error);
        return;
      }

      console.error('Ошибка отправки сообщения:', error);
      if (loadingMessage && loadingMessage.parentNode) {
        loadingMessage.remove();
      }
      addMessage(`❌ ${toUserFacingErrorMessage(error)}`, 'bot');
    } finally {
      // Закрываем SSE соединение после получения ответа
      if (trackedRequest.eventSource) {
        setTimeout(() => {
          closeTrackedEventSource(trackedRequest);
        }, 1000);
      }
      if (isTrackedRequestCurrent(trackedRequest) && input) {
        input.disabled = false;
        // Убеждаемся, что высота сброшена до начального состояния, если поле пустое
        if (!input.value || input.value.trim() === '') {
          // Полностью удаляем все inline стили и класс
          input.style.removeProperty('height');
          input.style.removeProperty('min-height');
          input.style.removeProperty('max-height');
          input.classList.remove('has-content');
          void input.offsetHeight;
        }
        input.focus();
      }
      if (isTrackedRequestCurrent(trackedRequest)) {
        setSendButtonDisabled(false);
      }
      clearActiveRequestReference(trackedRequest);
    }
  }

  // Подключение к SSE потоку статусов
  function connectToStatusStream(trackedRequest) {
    const requestId = trackedRequest?.requestId;
    const loadingMessageElement = trackedRequest?.loadingMessage;

    if (!requestId || !loadingMessageElement) {
      console.warn(
        '⚠️ Не удалось подключиться к SSE: отсутствует requestId или loadingMessageElement'
      );
      return null;
    }

    try {
      if (window.currentEventSource) {
        try {
          window.currentEventSource.close();
        } catch (closeError) {
          console.warn('⚠️ Не удалось закрыть предыдущее SSE соединение:', closeError);
        }
        window.currentEventSource = null;
      }

      const sseUrl = `${API_BASE_URL}/api/chat/status/${encodeURIComponent(requestId)}`;
      console.log('🔌 Подключение к SSE:', sseUrl);

      const eventSource = new EventSource(sseUrl);

      eventSource.onopen = () => {
        console.log('✅ SSE соединение установлено для requestId:', requestId);
      };

      eventSource.onmessage = (event) => {
        try {
          if (!isTrackedRequestCurrent(trackedRequest)) {
            console.log('[widget] Закрываю SSE устаревшего запроса:', requestId);
            closeTrackedEventSource(trackedRequest);
            return;
          }

          const data = JSON.parse(event.data);
          console.log('📨 Получен статус через SSE:', data.status);

          if (data.status && loadingMessageElement && loadingMessageElement.parentNode) {
            // Плавная смена статуса с современной анимацией
            const statusSpan = loadingMessageElement.querySelector('.loading');
            const cleanNewStatus = (data.status || '').replace(/\.+$/, '').trim();

            if (statusSpan) {
              const cleanCurrentText = (statusSpan.textContent || '').replace(/\.+$/, '').trim();

              if (cleanCurrentText !== cleanNewStatus) {
                // Плавный fade-out старого статуса
                statusSpan.classList.add('status-fade-out');

                // Ждем полного исчезновения перед показом нового статуса
                setTimeout(() => {
                  if (statusSpan && statusSpan.parentNode) {
                    statusSpan.textContent = cleanNewStatus;
                    statusSpan.classList.remove('status-fade-out');
                    statusSpan.classList.add('status-fade-in');

                    // Убираем класс fade-in после завершения анимации
                    setTimeout(() => {
                      if (statusSpan) {
                        statusSpan.classList.remove('status-fade-in');
                      }
                    }, 800);
                  }
                }, 700);
              }
            } else {
              const newSpan = document.createElement('span');
              newSpan.className = 'loading status-fade-in';
              newSpan.textContent = cleanNewStatus;
              loadingMessageElement.textContent = '';
              loadingMessageElement.appendChild(newSpan);
              setTimeout(() => newSpan.classList.remove('status-fade-in'), 500);
            }
            // Не прокручиваем при обновлении статуса, чтобы не мешать пользователю
          }

          // Если статус "completed", закрываем соединение
          // Индикатор загрузки уже удален при получении ответа, здесь просто закрываем соединение
          if (data.status === 'completed') {
            console.log('✅ Получен статус "completed", закрываем SSE соединение');
            eventSource.close();
            if (window.currentEventSource === eventSource) {
              window.currentEventSource = null;
            }
            // Индикатор уже удален при получении ответа, здесь только для подстраховки
            if (loadingMessageElement && loadingMessageElement.parentNode) {
              loadingMessageElement.remove();
            }
          }
        } catch (error) {
          console.error('❌ Ошибка парсинга статуса:', error, 'Данные:', event.data);
        }
      };

      eventSource.onerror = (error) => {
        if (!isTrackedRequestCurrent(trackedRequest)) {
          closeTrackedEventSource(trackedRequest);
          return;
        }

        // readyState: 0 = CONNECTING, 1 = OPEN, 2 = CLOSED
        if (eventSource.readyState === EventSource.CLOSED) {
          console.log('ℹ️ SSE соединение закрыто для requestId:', requestId);
          closeTrackedEventSource(trackedRequest);
          // Если соединение закрылось и статус не обновился, удаляем индикатор
          setTimeout(() => {
            if (loadingMessageElement && loadingMessageElement.parentNode) {
              const statusSpan = loadingMessageElement.querySelector('.loading');
              const normalizedText = (statusSpan?.textContent || '').replace(/\.+$/, '').trim();
              if (normalizedText === 'Анализируем запрос') {
                console.log('⚠️ SSE соединение закрыто, статус не обновлялся, удаляем индикатор');
                loadingMessageElement.remove();
              }
            }
          }, 1000);
          return;
        }
        console.warn('⚠️ Ошибка SSE соединения:', error);
      };

      // Сохраняем ссылку на eventSource для закрытия при необходимости
      window.currentEventSource = eventSource;
      return eventSource;
    } catch (error) {
      console.error('❌ Ошибка создания SSE соединения:', error);
      return null;
    }
  }

  function dedupeBotButtons(buttons = []) {
    const deduped = [];
    const seen = new Set();

    buttons.forEach((label) => {
      const normalizedLabel = typeof label === 'string' ? label.trim() : '';
      if (!normalizedLabel) {
        return;
      }

      const normalizedKey = normalizedLabel.toLowerCase().replace(/ё/g, 'е');
      if (!normalizedKey || seen.has(normalizedKey)) {
        return;
      }

      seen.add(normalizedKey);
      deduped.push(normalizedLabel);
    });

    return deduped;
  }

  // Добавление сообщения в чат
  function addMessage(text, type, options = {}) {
    const messagesContainer = getMessagesContainer();
    if (!messagesContainer) return null;

    const messageDiv = document.createElement('div');
    messageDiv.className = `msg ${type}`;

    appendMessageText(messageDiv, text);

    messagesContainer.appendChild(messageDiv);

    if (type === 'bot' && Array.isArray(options.buttons) && options.buttons.length > 0) {
      const buttonsWrapper = document.createElement('div');
      buttonsWrapper.className = 'inline-bot-buttons';
      dedupeBotButtons(options.buttons).forEach((label) => {
        const normalizedLabel = typeof label === 'string' ? label.trim() : '';
        if (!normalizedLabel) {
          return;
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'inline-bot-button';
        button.textContent = normalizedLabel;
        button.addEventListener('click', () => handleBotButtonClick(normalizedLabel));
        buttonsWrapper.appendChild(button);
      });
      if (buttonsWrapper.childNodes.length > 0) {
        messageDiv.appendChild(buttonsWrapper);
      }
    }

    ensureBottomSpacer(messagesContainer);

    // Автоматически прокручиваем только для сообщений пользователя
    // Для сообщений бота оставляем пользователя на его текущей позиции
    if (type === 'user') {
      scrollToBottom();
    }

    // Проверяем наличие скрытого контента после добавления сообщения
    setTimeout(() => {
      updateScrollIndicator();
    }, 150);

    return messageDiv;
  }

  // Добавление карточек событий
  function addEventCards(events) {
    const messagesContainer = getMessagesContainer();
    if (!messagesContainer || !events || events.length === 0) return;
    lastOfferEvents = Array.isArray(events) ? events.slice() : [];
    // events_shown пишется на web-interface при ответе API с offer; здесь только отрисовка карточек

    // Создаем контейнер для карточек
    const cardsContainer = document.createElement('div');
    cardsContainer.className = 'flex_container_afish';

    // Группируем события по 2 в ряд
    for (let i = 0; i < events.length; i += 2) {
      const row = document.createElement('div');
      row.className = 'flex_ryad_cards';

      // Добавляем до 2 карточек в ряд
      for (let j = i; j < Math.min(i + 2, events.length); j++) {
        const event = events[j];
        const card = createEventCard(event);
        row.appendChild(card);
      }

      cardsContainer.appendChild(row);
    }

    messagesContainer.appendChild(cardsContainer);
    ensureBottomSpacer(messagesContainer);
    // Не прокручиваем автоматически при добавлении карточек - оставляем пользователя на его позиции

    // Проверяем наличие скрытого контента после добавления карточек
    setTimeout(() => {
      updateScrollIndicator();
    }, 200);
  }

  // Создание карточки события
  function createEventCard(event) {
    const card = document.createElement('div');
    card.className = 'afish_card';

    // Изображение с ценой
    const imgContainer = document.createElement('div');
    imgContainer.className = 'back_img_afish';

    if (event.posterImage) {
      imgContainer.style.backgroundImage = `url('${event.posterImage}')`;
      imgContainer.style.backgroundSize = 'cover';
    } else {
      imgContainer.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
    }

    // Плашка с ценой
    if (event.priceMin !== null && event.priceMin !== undefined) {
      const priceBadge = document.createElement('div');
      priceBadge.className = 'plashk_card_afisha';

      const priceText = document.createElement('strong');
      const hasPriceMax = event.priceMax !== null && event.priceMax !== undefined;
      const isFree = Number(event.priceMin) === 0 && (!hasPriceMax || Number(event.priceMax) === 0);
      priceText.textContent = isFree ? 'Бесплатно' : `от ${formatPrice(event.priceMin)} ₽`;

      priceBadge.appendChild(priceText);
      imgContainer.appendChild(priceBadge);
    }

    card.appendChild(imgContainer);

    // Текстовая часть
    const textPart = document.createElement('div');
    textPart.className = 'text_part_afish';

    // Название
    const title = document.createElement('h6');
    title.textContent = event.title || 'Событие';
    textPart.appendChild(title);

    // Дата (поддержка нескольких сеансов без повторного добавления time)
    const dateSpan = document.createElement('span');
    const hasMultipleDates = Array.isArray(event.dates) && event.dates.length > 1;

    const buildDatesHtml = () => {
      if (!Array.isArray(event.dates) || event.dates.length === 0) return '';
      const MAX_DATES_DISPLAY = 5;
      const formatted = event.dates
        .map((entry) => {
          const parts = [];
          if (entry.date) parts.push(entry.date);
          if (entry.time) parts.push(entry.time);
          return parts.join(' ').trim();
        })
        .filter(Boolean)
        .slice(0, MAX_DATES_DISPLAY);
      if (formatted.length === 0) return '';
      return formatted.join('<br>');
    };

    if (hasMultipleDates) {
      const html = buildDatesHtml();
      if (html) {
        // Рендерим многострочно без innerHTML.
        const lines = html
          .split('<br>')
          .map((s) => s.trim())
          .filter(Boolean);
        lines.forEach((line, idx) => {
          if (idx > 0) {
            dateSpan.appendChild(document.createElement('br'));
          }
          dateSpan.appendChild(document.createTextNode(line));
        });
        textPart.appendChild(dateSpan);
      }
    } else {
      const dateText =
        event.dateDisplay ||
        event.datesText ||
        (event.date
          ? event.time && !String(event.date).includes(event.time)
            ? `${event.date} ${event.time}`
            : event.date
          : '');

      if (dateText) {
        dateSpan.textContent = dateText;
        textPart.appendChild(dateSpan);
      }
    }

    // Место
    if (event.venue) {
      const venue = document.createElement('h5');
      venue.textContent = event.venue;
      textPart.appendChild(venue);
    }

    // Возрастное ограничение
    if (event.ageRestriction) {
      const ageRestriction = document.createElement('h5');
      ageRestriction.textContent = `Возраст: ${event.ageRestriction}`;
      textPart.appendChild(ageRestriction);
    }

    card.appendChild(textPart);

    // Добавляем клик для перехода на страницу события
    if (event.url) {
      card.style.cursor = 'pointer';
      card.addEventListener('click', () => {
        try {
          const url = new URL(String(event.url), window.location.href);
          if (url.protocol === 'http:' || url.protocol === 'https:') {
            lastSelectedEventUrl = url.toString();
            sendAnalyticsEvent('event_card_click', {
              url: lastSelectedEventUrl,
              title: event.title || '',
            });
            window.open(url.toString(), '_blank', 'noopener,noreferrer');
          }
        } catch (_e) {}
      });
    }

    return card;
  }

  // Форматирование цены
  function formatPrice(price) {
    return new Intl.NumberFormat('ru-RU').format(Math.round(price));
  }

  // Прокрутка вниз
  function scrollToBottom() {
    const messagesContainer = document.getElementById('kassirWidgetMessages');
    if (messagesContainer) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
      // Обновляем индикатор после прокрутки с небольшой задержкой для точности
      setTimeout(() => {
        updateScrollIndicator();
      }, 50);
    }
  }

  // Экспорт функций
  window.KassirWidget = {
    init: initWidget,
    createNewUser: createNewUser,
    startNewChat: startNewChat,
    show: showWidget,
  };
})();
