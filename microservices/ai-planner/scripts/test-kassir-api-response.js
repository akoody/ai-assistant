import { loadRootEnv, resolveInternalApiKey } from '../../../shared/runtimeEnv.js';
loadRootEnv(import.meta.url);
// Используем прямое значение или переменные окружения
const AI_TOOLS_URL = process.env.AI_TOOLS_URL || 'http://localhost:3003';
const API_KEY = resolveInternalApiKey({
  serviceName: 'ai-tools client',
  settingName: 'testApiKey',
  envNames: ['AI_TOOLS_API_KEY', 'TEST_API_KEY'],
});

async function testKassirApiResponse() {
  console.log('🧪 Тестирование ответа API Кассир через AI Tools...\n');
  console.log(`🌐 AI Tools URL: ${AI_TOOLS_URL}`);

  // Тестовый запрос: поиск концертов в Москве на завтра
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  const formatDateForKassir = (date) => {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}.${month}.${year}`;
  };

  const searchParams = {
    keyword: 'концерт',
    date_from: formatDateForKassir(tomorrow),
    domain: 'msk.kassir.ru',
    slug: '/category/',
    sort: 0,
    platformState: 'website',
    page: 1,
  };

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📋 Параметры поиска:');
  console.log(JSON.stringify(searchParams, null, 2));
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  try {
    const response = await fetch(`${AI_TOOLS_URL}/api/tools/kassir-api/search`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(searchParams),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('❌ Ошибка запроса:', response.status, errorData);
      return;
    }

    const data = await response.json();

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📊 СТРУКТУРА ОТВЕТА');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    console.log('✅ Статус ответа:', data.success ? 'успешно' : 'ошибка');
    console.log('📦 Инструмент:', data.tool);
    console.log('⚙️ Операция:', data.operation);

    if (data.data) {
      console.log('\n📋 Данные поиска:');
      console.log(`   - Всего найдено: ${data.data.total || 0}`);
      console.log(`   - Вернуно: ${data.data.items?.length || 0}`);

      if (data.data.items && data.data.items.length > 0) {
        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🔍 ДЕТАЛЬНАЯ СТРУКТУРА ПЕРВОГО СОБЫТИЯ');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        const firstEvent = data.data.items[0];

        console.log('📌 Все ключи верхнего уровня:');
        console.log(JSON.stringify(Object.keys(firstEvent), null, 2));
        console.log('\n');

        console.log('📄 ПОЛНАЯ СТРУКТУРА ПЕРВОГО СОБЫТИЯ:');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(JSON.stringify(firstEvent, null, 2));
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

        // Проверяем наличие поля object
        if (firstEvent.object) {
          console.log('📦 Поле "object" найдено!');
          console.log('   Ключи в object:');
          console.log(JSON.stringify(Object.keys(firstEvent.object), null, 2));
          console.log('\n   Содержимое object:');
          console.log(JSON.stringify(firstEvent.object, null, 2));
          console.log('\n');
        }

        // Проверяем activity если есть
        if (firstEvent.object?.activity) {
          console.log('🎭 Поле "activity" найдено в object!');
          console.log('   Ключи в activity:');
          console.log(JSON.stringify(Object.keys(firstEvent.object.activity), null, 2));
          console.log('\n   Содержимое activity:');
          console.log(JSON.stringify(firstEvent.object.activity, null, 2));
          console.log('\n');
        }

        // Показываем все остальные события кратко
        if (data.data.items.length > 1) {
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          console.log(`📋 ОСТАЛЬНЫЕ СОБЫТИЯ (${data.data.items.length - 1}):`);
          console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

          data.data.items.slice(1).forEach((event, index) => {
            console.log(`\nСобытие ${index + 2}:`);
            console.log(`   - Тип: ${event.type || 'N/A'}`);
            console.log(`   - Название: ${event.title || event.object?.title || 'N/A'}`);
            console.log(`   - ID: ${event.id || event.object?.id || 'N/A'}`);
            console.log(
              `   - Дата: ${event.beginsAt || event.object?.beginsAt || event.object?.dateRange?.beginsAt || 'N/A'}`
            );
            console.log(
              `   - Площадка: ${event.venue?.name || event.object?.venue?.name || event.venueName || 'N/A'}`
            );
            console.log(`   Ключи: ${Object.keys(event).join(', ')}`);
          });
        }

        // Сохраняем полный ответ в файл для дальнейшего анализа
        const fs = await import('fs');
        const path = await import('path');
        const filePath = path.join(process.cwd(), 'kassir-api-response-full.json');
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
        console.log(`\n💾 Полный ответ сохранен в файл: ${filePath}`);
      } else {
        console.log('\n⚠️ События не найдены');
        console.log('   Полный ответ:', JSON.stringify(data, null, 2));
      }
    } else {
      console.log('\n⚠️ Данные не найдены в ответе');
      console.log('   Полный ответ:', JSON.stringify(data, null, 2));
    }
  } catch (error) {
    console.error('❌ Ошибка выполнения запроса:', error.message);
    console.error('   Stack:', error.stack);
  }
}

testKassirApiResponse().catch((error) => {
  console.error('❌ Критическая ошибка:', error);
  process.exit(1);
});
