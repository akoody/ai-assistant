# Виджет Kassir - Инструкция по подключению

Подключение доступно на доменах *.kassir.ru и kassir.ru

## Варианты подключения

### Вариант 1 (рекомендуемый): подключение через `embed.js` (скрипт сам создаёт iframe)

Самый простой вариант — просто подключить скрипт:

```html
<script
  src="https://sferaai.ru/embed.js"
  data-api-url="https://sferaai.ru"
  data-client-id="YOUR_CLIENT_ID"
></script>
```

Если удобнее вставлять один `<script>`-блок (который сам добавит внешний скрипт) — используйте такой шаблон:

```html
<script>
  (function (w, d, u, apiUrl, clientId) {
    var s = d.createElement('script');
    s.async = true;
    s.src = u + '?' + ((Date.now() / 60000) | 0);
    s.setAttribute('data-api-url', apiUrl);
    s.setAttribute('data-client-id', clientId);
    var h = d.getElementsByTagName('script')[0];
    h.parentNode.insertBefore(s, h);
  })(window, document, 'https://sferaai.ru/embed.js', 'https://sferaai.ru', 'YOUR_CLIENT_ID');
</script>
```

### Вариант 2: подключение напрямую через `<iframe>` (если хотите сами управлять iframe)

```html
<iframe
  src="https://sferaai.ru/widget.html?apiUrl=https%3A%2F%2Fsferaai.ru&client_id=YOUR_CLIENT_ID"
  style="position:fixed;bottom:16px;right:16px;width:460px;height:700px;border:0;z-index:10000;background:transparent;"
  allow="clipboard-read; clipboard-write"
></iframe>
```

### Параметры подключения

- `data-api-url` - URL API сервера
- `data-widget-url` - URL страницы виджета
- `data-client-id` - стабильный внешний ID клиента (обязателен для склейки сессий)

### Пример полного подключения

```html
<!DOCTYPE html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Ваш сайт</title>
  </head>
  <body>
    <!-- Ваш контент -->
    <h1>Добро пожаловать!</h1>

    <!-- Виджет Кассир - просто добавьте скрипт -->
    <script
      src="https://sferaai.ru/embed.js"
      data-api-url="https://sferaai.ru"
      data-client-id="YOUR_CLIENT_ID"
    ></script>
  </body>
</html>
```

## Управление виджетом через JavaScript

После загрузки виджета доступен глобальный объект `KassirWidgetAPI`:

### Создать нового пользователя

```javascript
KassirWidgetAPI.createNewUser();
```

### Показать/развернуть виджет

```javascript
KassirWidgetAPI.show();
```

### Получить iframe виджета

```javascript
const iframe = KassirWidgetAPI.getIframe();
```

### Пример: кнопка для открытия виджета

```html
<button onclick="KassirWidgetAPI.createNewUser();">Открыть чат</button>
```

### Пример: кнопка для показа виджета

```html
<button onclick="KassirWidgetAPI.show();">Показать чат</button>
```

## Как это работает

1. Скрипт `embed.js` создает iframe на странице
2. В iframe загружается `widget.html` с полным виджетом
3. Связь между родительской страницей и виджетом происходит через `postMessage`
4. Виджет автоматически отображается в свернутом виде (круглая кнопка с аватаром)
5. При клике на кнопку виджет разворачивается

## Примеры использования

### Базовое подключение

```html
<script
  src="https://sferaai.ru/embed.js"
  data-api-url="https://sferaai.ru"
  data-client-id="YOUR_CLIENT_ID"
></script>
```

### С кнопкой открытия

```html
<button id="openChat">Открыть чат</button>

<script
  src="https://sferaai.ru/embed.js"
  data-api-url="https://sferaai.ru"
  data-client-id="YOUR_CLIENT_ID"
></script>
<script>
  document.getElementById('openChat').addEventListener('click', function () {
    window.KassirWidgetAPI.createNewUser();
  });
</script>
```

### Автоматическое открытие при загрузке

```html
<script
  src="https://sferaai.ru/embed.js"
  data-api-url="https://sferaai.ru"
  data-client-id="YOUR_CLIENT_ID"
></script>
<script>
  window.addEventListener('load', function () {
    setTimeout(function () {
      window.KassirWidgetAPI.createNewUser();
    }, 1000); // Открыть через 1 секунду после загрузки
  });
</script>
```
