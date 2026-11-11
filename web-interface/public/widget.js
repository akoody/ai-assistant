// Подключаемый скрипт виджета Кассир
(function () {
  'use strict';

  // Получаем URL API из data-атрибута скрипта
  const scriptTag = document.currentScript || document.querySelector('script[data-api-url]');
  const apiUrl = scriptTag ? scriptTag.getAttribute('data-api-url') || '' : '';
  const clientId = scriptTag ? scriptTag.getAttribute('data-client-id') || '' : '';

  // Базовый URL для ресурсов виджета (можно настроить через data-атрибут)
  const widgetBaseUrl = scriptTag ? scriptTag.getAttribute('data-widget-url') || '' : '';
  const resourceBaseUrl = widgetBaseUrl || window.location.origin + '/';
  const ASSET_VERSION = '20260520-docked-collapsed-v1';

  // Проверяем, не загружен ли виджет уже
  if (window.KassirWidgetLoaded) {
    console.warn('Виджет Кассир уже загружен');
    return;
  }

  window.KassirWidgetLoaded = true;

  // Создаем контейнер для виджета, если его нет
  let widgetContainer = document.getElementById('kassir-widget-container');
  if (!widgetContainer) {
    widgetContainer = document.createElement('div');
    widgetContainer.id = 'kassir-widget-container';
    document.body.appendChild(widgetContainer);
  }

  // Загружаем стили
  function loadStyles() {
    if (document.getElementById('kassir-widget-styles')) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.id = 'kassir-widget-styles';
      link.rel = 'stylesheet';
      link.href = resourceBaseUrl + 'widget-style.css?v=' + encodeURIComponent(ASSET_VERSION);
      link.onload = resolve;
      link.onerror = reject;
      document.head.appendChild(link);
    });
  }

  // Загружаем основной скрипт виджета
  function loadWidgetScript() {
    if (window.KassirWidget) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = resourceBaseUrl + 'widget-app.js?v=' + encodeURIComponent(ASSET_VERSION);
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  // Инициализация виджета
  function initWidget() {
    if (window.KassirWidget && window.KassirWidget.init) {
      window.KassirWidget.init({
        container: widgetContainer,
        apiUrl: apiUrl,
        clientId: clientId || null,
        newUserButton: null, // Кнопка на странице клиента, если есть
      });
    }
  }

  // Загружаем все ресурсы и инициализируем
  Promise.all([loadStyles(), loadWidgetScript()])
    .then(() => {
      // Небольшая задержка для гарантии, что всё загружено
      setTimeout(() => {
        initWidget();
      }, 100);
    })
    .catch((error) => {
      console.error('Ошибка загрузки виджета Кассир:', error);
    });

  // Экспортируем глобальный API для управления виджетом
  window.KassirWidgetAPI = {
    show: function () {
      if (window.KassirWidget && window.KassirWidget.show) {
        window.KassirWidget.show();
      }
    },
    createNewUser: function () {
      if (window.KassirWidget && window.KassirWidget.createNewUser) {
        window.KassirWidget.createNewUser();
      }
    },
    getContainer: function () {
      return widgetContainer;
    },
  };
})();
