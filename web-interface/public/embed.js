(function () {
  'use strict';

  const FORCE_SIZE_PRIORITY = 'important';
  const COLLAPSED_WIDGET_SIZE_DESKTOP = 104;
  const COLLAPSED_WIDGET_SIZE_MOBILE = 90;
  const COLLAPSED_WIDGET_RIGHT_OFFSET = 42;
  const COLLAPSED_WIDGET_BOTTOM_OFFSET = 34;
  const TUCKED_WIDGET_WIDTH_DESKTOP = 52;
  const TUCKED_WIDGET_HEIGHT_DESKTOP = 136;
  const TUCKED_WIDGET_WIDTH_MOBILE = 48;
  const TUCKED_WIDGET_HEIGHT_MOBILE = 126;
  const TUCKED_WIDGET_BOTTOM_OFFSET = 34;
  const COLLAPSED_IFRAME_RADIUS = 0;
  const EXPANDED_IFRAME_RADIUS = 18;
  const DEFAULT_IFRAME_OFFSET = 16;
  const MOBILE_EXPANDED_OFFSET = 8;
  const DESKTOP_VIEWPORT_PADDING = 32;
  const MOBILE_VIEWPORT_PADDING = 16;
  const DESKTOP_MAX_WIDTH = 414;
  const DESKTOP_MAX_HEIGHT = 600;
  const TABLET_MAX_WIDTH = 414;
  const TABLET_MAX_HEIGHT = 600;
  const MOBILE_MAX_WIDTH = 420;
  const MOBILE_MAX_HEIGHT = 620;

  if (window.KassirWidgetEmbedded) {
    console.warn('Виджет уже встроен');
    return;
  }

  window.KassirWidgetEmbedded = true;

  const scriptTag = document.currentScript || document.querySelector('script[src*="embed.js"]');
  let widgetUrl = scriptTag ? scriptTag.getAttribute('data-widget-url') : null;
  const ASSET_VERSION = '20260520-docked-collapsed-v1';

  if (!widgetUrl) {
    const scriptSrc = scriptTag ? scriptTag.src : '';
    if (scriptSrc) {
      const url = new URL(scriptSrc);
      widgetUrl = `${url.origin}/widget.html`;
    } else {
      widgetUrl = '/widget.html';
    }
  }

  const widgetOrigin = (() => {
    try {
      return new URL(widgetUrl, window.location.href).origin;
    } catch {
      return '*';
    }
  })();

  const apiUrl = scriptTag ? scriptTag.getAttribute('data-api-url') || '' : '';
  const rawConfiguredClientId = scriptTag ? scriptTag.getAttribute('data-client-id') || '' : '';
  const rawConfiguredEmbeddingHost = scriptTag
    ? scriptTag.getAttribute('data-embedding-host') || ''
    : '';

  function normalizeClientId(value) {
    const raw = String(value || '').trim();
    return raw || null;
  }

  const fallbackClientIdFromPage = (() => {
    try {
      const params = new URL(window.location.href).searchParams;
      return params.get('client_id') || params.get('clientId') || '';
    } catch {
      return '';
    }
  })();

  const configuredClientId =
    normalizeClientId(rawConfiguredClientId) || normalizeClientId(fallbackClientIdFromPage);
  const configuredEmbeddingHost =
    String(rawConfiguredEmbeddingHost || '')
      .trim()
      .toLowerCase() || null;

  function getCollapsedFrameSize() {
    const widgetSize =
      window.innerWidth <= 480 ? COLLAPSED_WIDGET_SIZE_MOBILE : COLLAPSED_WIDGET_SIZE_DESKTOP;

    return {
      width: widgetSize + COLLAPSED_WIDGET_RIGHT_OFFSET * 2,
      height: widgetSize + COLLAPSED_WIDGET_BOTTOM_OFFSET * 2,
    };
  }

  function getTuckedFrameSize() {
    return window.innerWidth <= 480
      ? { width: TUCKED_WIDGET_WIDTH_MOBILE, height: TUCKED_WIDGET_HEIGHT_MOBILE }
      : { width: TUCKED_WIDGET_WIDTH_DESKTOP, height: TUCKED_WIDGET_HEIGHT_DESKTOP };
  }

  function isMobileViewport() {
    return window.innerWidth <= 480;
  }

  function getExpandedViewportBounds() {
    const { width: minWidth, height: minHeight } = getCollapsedFrameSize();
    const viewportPadding = isMobileViewport() ? MOBILE_VIEWPORT_PADDING : DESKTOP_VIEWPORT_PADDING;

    return {
      minWidth,
      minHeight,
      availableWidth: Math.max(window.innerWidth - viewportPadding, minWidth),
      availableHeight: Math.max(window.innerHeight - viewportPadding, minHeight),
    };
  }

  function setFrameOffsets(iframe) {
    if (!iframe || embeddedInBottomActions) {
      return;
    }

    const offset = isMobileViewport() ? MOBILE_EXPANDED_OFFSET : DEFAULT_IFRAME_OFFSET;

    iframe.style.setProperty('bottom', `${offset}px`, FORCE_SIZE_PRIORITY);
    iframe.style.setProperty('right', `${offset}px`, FORCE_SIZE_PRIORITY);
  }

  function setCollapsedSize(iframe) {
    const { width, height } = getCollapsedFrameSize();
    iframe.style.setProperty('width', `${width}px`, FORCE_SIZE_PRIORITY);
    iframe.style.setProperty('height', `${height}px`, FORCE_SIZE_PRIORITY);
    iframe.style.setProperty('max-width', `${width}px`, FORCE_SIZE_PRIORITY);
    iframe.style.setProperty('max-height', `${height}px`, FORCE_SIZE_PRIORITY);
    iframe.style.setProperty('border-radius', `${COLLAPSED_IFRAME_RADIUS}px`, FORCE_SIZE_PRIORITY);
    setFrameOffsets(iframe, true);
  }

  function setTuckedSize(iframe) {
    const { width, height } = getTuckedFrameSize();
    iframe.style.setProperty('width', `${width}px`, FORCE_SIZE_PRIORITY);
    iframe.style.setProperty('height', `${height}px`, FORCE_SIZE_PRIORITY);
    iframe.style.setProperty('max-width', `${width}px`, FORCE_SIZE_PRIORITY);
    iframe.style.setProperty('max-height', `${height}px`, FORCE_SIZE_PRIORITY);
    iframe.style.setProperty('border-radius', `${COLLAPSED_IFRAME_RADIUS}px`, FORCE_SIZE_PRIORITY);
    if (!embeddedInBottomActions) {
      iframe.style.setProperty('right', '0px', FORCE_SIZE_PRIORITY);
      iframe.style.setProperty('bottom', `${TUCKED_WIDGET_BOTTOM_OFFSET}px`, FORCE_SIZE_PRIORITY);
    }
  }

  function pickMaxDimensions() {
    const width = window.innerWidth;

    if (width <= 480) {
      return { width: MOBILE_MAX_WIDTH, height: MOBILE_MAX_HEIGHT };
    }
    if (width <= 768) {
      return { width: TABLET_MAX_WIDTH, height: TABLET_MAX_HEIGHT };
    }
    return { width: DESKTOP_MAX_WIDTH, height: DESKTOP_MAX_HEIGHT };
  }

  function clampSize(width, height, maxWidth, maxHeight) {
    const { width: minWidth, height: minHeight } = getCollapsedFrameSize();
    return {
      width: Math.round(Math.min(width, Math.max(maxWidth, minWidth))),
      height: Math.round(Math.min(height, Math.max(maxHeight, minHeight))),
    };
  }

  function setExpandedSize(iframe) {
    const { availableWidth, availableHeight } = getExpandedViewportBounds();
    const { width: desiredWidth, height: desiredHeight } = isMobileViewport()
      ? { width: availableWidth, height: availableHeight }
      : pickMaxDimensions();

    const { width, height } = clampSize(
      Math.min(desiredWidth, availableWidth),
      Math.min(desiredHeight, availableHeight),
      availableWidth,
      availableHeight
    );

    iframe.style.setProperty('width', `${width}px`, FORCE_SIZE_PRIORITY);
    iframe.style.setProperty('height', `${height}px`, FORCE_SIZE_PRIORITY);
    iframe.style.setProperty('max-width', `${width}px`, FORCE_SIZE_PRIORITY);
    iframe.style.setProperty('max-height', `${height}px`, FORCE_SIZE_PRIORITY);
    iframe.style.setProperty('border-radius', `${EXPANDED_IFRAME_RADIUS}px`, FORCE_SIZE_PRIORITY);
    setFrameOffsets(iframe, false);
  }

  function setSizeFromCollapsedFlag(iframe, collapsed, tucked) {
    if (!iframe) return;
    if (collapsed && tucked) {
      setTuckedSize(iframe);
    } else if (collapsed) {
      setCollapsedSize(iframe);
    } else {
      setExpandedSize(iframe);
    }
  }

  const iframe = document.createElement('iframe');
  iframe.id = 'kassir-widget-iframe';
  let embeddedInBottomActions = false;
  let widgetCollapsedState = true;
  let widgetTuckedState = false;
  try {
    const iframeUrl = new URL(widgetUrl, window.location.href);
    if (apiUrl) {
      iframeUrl.searchParams.set('apiUrl', apiUrl);
    }
    if (configuredClientId) {
      iframeUrl.searchParams.set('client_id', configuredClientId);
    }
    if (configuredEmbeddingHost) {
      iframeUrl.searchParams.set('embeddingHost', configuredEmbeddingHost);
    }
    iframeUrl.searchParams.set('v', ASSET_VERSION);
    iframe.src = iframeUrl.toString();
  } catch {
    const params = [];
    if (apiUrl) {
      params.push(`apiUrl=${encodeURIComponent(apiUrl)}`);
    }
    if (configuredClientId) {
      params.push(`client_id=${encodeURIComponent(configuredClientId)}`);
    }
    if (configuredEmbeddingHost) {
      params.push(`embeddingHost=${encodeURIComponent(configuredEmbeddingHost)}`);
    }
    params.push(`v=${encodeURIComponent(ASSET_VERSION)}`);
    iframe.src = `${widgetUrl}${widgetUrl.includes('?') ? '&' : '?'}${params.join('&')}`;
  }

  iframe.style.cssText = `
    position: fixed;
    bottom: ${DEFAULT_IFRAME_OFFSET}px;
    right: ${DEFAULT_IFRAME_OFFSET}px;
    width: 414px;
    height: 600px;
    max-width: calc(100vw - 32px);
    max-height: calc(100vh - 32px);
    border: none;
    border-radius: 18px;
    z-index: 10000;
    background: transparent;
    pointer-events: auto;
    transform-origin: bottom right;
    transition:
      width 320ms cubic-bezier(0.2, 0.8, 0.2, 1),
      height 320ms cubic-bezier(0.2, 0.8, 0.2, 1),
      max-width 320ms cubic-bezier(0.2, 0.8, 0.2, 1),
      max-height 320ms cubic-bezier(0.2, 0.8, 0.2, 1),
      border-radius 320ms cubic-bezier(0.2, 0.8, 0.2, 1),
      right 320ms cubic-bezier(0.2, 0.8, 0.2, 1),
      bottom 320ms cubic-bezier(0.2, 0.8, 0.2, 1);
  `;

  setCollapsedSize(iframe);

  const style = document.createElement('style');
  style.textContent = `
    #kassir-widget-iframe {
      box-sizing: border-box;
    }
  `;
  document.head.appendChild(style);

  function applyWidgetState(collapsed, tucked) {
    widgetCollapsedState = Boolean(collapsed);
    widgetTuckedState = Boolean(widgetCollapsedState && tucked);
    setSizeFromCollapsedFlag(iframe, widgetCollapsedState, widgetTuckedState);
  }

  function syncWidgetSizeWithViewport() {
    if (!iframe) {
      return;
    }
    setSizeFromCollapsedFlag(iframe, widgetCollapsedState, widgetTuckedState);
  }

  function insertIframe() {
    const bottomActions = document.querySelector('.bottom-actions');
    if (bottomActions) {
      embeddedInBottomActions = true;
      iframe.style.setProperty('position', 'static', FORCE_SIZE_PRIORITY);
      iframe.style.removeProperty('bottom');
      iframe.style.removeProperty('right');
      iframe.style.removeProperty('z-index');
      iframe.style.removeProperty('max-width');
      iframe.style.removeProperty('max-height');

      const children = bottomActions.children;
      if (children.length >= 1) {
        bottomActions.insertBefore(iframe, children[1]);
      } else {
        bottomActions.appendChild(iframe);
      }
    } else {
      document.body.appendChild(iframe);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', insertIframe);
  } else {
    insertIframe();
  }

  function watchStateViaSameOriginDOM() {
    try {
      const iframeWindow = iframe.contentWindow;
      const iframeDoc = iframeWindow?.document;
      if (!iframeWindow || !iframeDoc) return;

      const widgetRoot = iframeDoc.getElementById('kassirWidget');
      if (!widgetRoot) return;

      applyWidgetState(
        widgetRoot.classList.contains('collapsed'),
        widgetRoot.classList.contains('is-tucked')
      );

      const observer = new iframeWindow.MutationObserver(() => {
        applyWidgetState(
          widgetRoot.classList.contains('collapsed'),
          widgetRoot.classList.contains('is-tucked')
        );
      });
      observer.observe(widgetRoot, { attributes: true, attributeFilter: ['class'] });

      iframeWindow.addEventListener('resize', () => {
        syncWidgetSizeWithViewport();
      });
    } catch (error) {
      console.warn('Не удалось синхронизировать размер iframe через DOM:', error);
    }
  }

  iframe.addEventListener('load', () => {
    watchStateViaSameOriginDOM();
  });

  window.addEventListener('resize', syncWidgetSizeWithViewport);
  window.addEventListener('orientationchange', () => {
    window.setTimeout(syncWidgetSizeWithViewport, 120);
  });

  let _analyticsUserId = null;
  let _analyticsSessionId = null;
  let _analyticsClientId = configuredClientId || null;

  const analyticsBase = (() => {
    try {
      return new URL(scriptTag ? scriptTag.src : '', window.location.href).origin;
    } catch {
      return '';
    }
  })();

  function detectBaseDomain(hostname) {
    const host = String(hostname || '')
      .trim()
      .toLowerCase();
    if (!host) return null;
    if (host === 'sferaai.ru' || host.endsWith('.sferaai.ru')) return 'sferaai.ru';
    if (host === 'kassir.ru' || host.endsWith('.kassir.ru')) return 'kassir.ru';
    return null;
  }

  function sendTrackEvent(event, payload) {
    if (!_analyticsUserId && !_analyticsClientId) return;
    const embeddingHost =
      configuredEmbeddingHost ||
      String(window.location.hostname || '')
        .trim()
        .toLowerCase();
    const baseDomain = detectBaseDomain(embeddingHost);
    const body = JSON.stringify({
      event,
      userId: _analyticsUserId,
      sessionId: _analyticsSessionId,
      clientId: _analyticsClientId,
      payload: {
        ...payload,
        embeddingHost: embeddingHost || null,
        baseDomain: baseDomain || null,
        domain: baseDomain || null,
      },
    });
    const url = `${analyticsBase}/api/analytics/track`;
    try {
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: true,
      }).catch(() => {
        if (navigator.sendBeacon) {
          navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
        }
      });
    } catch (e) {}
  }

  window.addEventListener('message', function (event) {
    if (widgetOrigin !== '*' && event.origin !== widgetOrigin) return;

    const data = event.data;
    if (data && data.type === 'widgetReady') {
      console.log('Виджет готов');
      applyWidgetState(true);
      // Сохраняем userId из виджета
      if (data.userId) _analyticsUserId = data.userId;
      if (data.sessionId) _analyticsSessionId = data.sessionId;
      if (data.clientId)
        _analyticsClientId = normalizeClientId(data.clientId) || _analyticsClientId;
    }

    if (data && data.type === 'widgetState') {
      const collapsed = Boolean(data.collapsed);
      applyWidgetState(collapsed, Boolean(data.tucked));
    }

    if (data && data.type === 'widgetGeometry') {
      const collapsed = Boolean(data.collapsed);
      if (collapsed) {
        applyWidgetState(true);
        return;
      }

      const width = Number(data.width);
      const height = Number(data.height);
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return;
      }

      const { availableWidth, availableHeight } = getExpandedViewportBounds();

      const clamped = clampSize(
        Math.min(width, availableWidth),
        Math.min(height, availableHeight),
        availableWidth,
        availableHeight
      );

      iframe.style.setProperty('width', `${clamped.width}px`, FORCE_SIZE_PRIORITY);
      iframe.style.setProperty('height', `${clamped.height}px`, FORCE_SIZE_PRIORITY);
      iframe.style.setProperty('max-width', `${clamped.width}px`, FORCE_SIZE_PRIORITY);
      iframe.style.setProperty('max-height', `${clamped.height}px`, FORCE_SIZE_PRIORITY);
      iframe.style.setProperty('border-radius', `${EXPANDED_IFRAME_RADIUS}px`, FORCE_SIZE_PRIORITY);
      setFrameOffsets(iframe, false);
      widgetCollapsedState = false;
    }

    // Перехватываем аналитические события от виджета
    if (data && data.type === 'kassir_widget_analytics') {
      const evt = data.event;
      const payload = data.payload || {};
      if (payload.userId) _analyticsUserId = payload.userId;
      if (payload.sessionId) _analyticsSessionId = payload.sessionId;
      if (payload.clientId || payload.client_id) {
        _analyticsClientId =
          normalizeClientId(payload.clientId || payload.client_id) || _analyticsClientId;
      }
      sendTrackEvent(evt, { ...payload, page: window.location.href });
    }
  });

  window.KassirWidgetAPI = {
    createNewUser: function () {
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ type: 'createNewUser' }, widgetOrigin);
      }
    },
    startNewChat: function () {
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ type: 'startNewChat' }, widgetOrigin);
      }
    },
    show: function () {
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ type: 'show' }, widgetOrigin);
      }
    },
    getIframe: function () {
      return iframe;
    },
  };
})();
