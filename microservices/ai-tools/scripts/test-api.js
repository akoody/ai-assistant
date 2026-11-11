import { loadRootEnv, resolveInternalApiKey } from '../../../shared/runtimeEnv.js';
loadRootEnv(import.meta.url);
const AI_TOOLS_URL = process.env.AI_TOOLS_URL || 'http://localhost:3003';
const API_KEY = resolveInternalApiKey({
  serviceName: 'ai-tools client',
  settingName: 'testApiKey',
  envName: 'AI_TOOLS_API_KEY',
});

async function testApiTools() {
  console.log('🧪 Тестирование AI Tools микросервиса...\n');
  console.log(`🌐 URL: ${AI_TOOLS_URL}`);

  // Тест 1: Health check
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('1️⃣  Health Check');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  try {
    const healthResponse = await fetch(`${AI_TOOLS_URL}/api/tools/health`);
    const healthData = await healthResponse.json();
    console.log('✅ Health check:', healthData);
  } catch (error) {
    console.error('❌ Ошибка health check:', error.message);
    console.error('   Убедитесь, что микросервис запущен на порту 3003');
    process.exit(1);
  }

  // Тест 2: Получение категорий (не требует обязательных параметров)
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('2️⃣  Получение категорий');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  try {
    const categoriesResponse = await fetch(`${AI_TOOLS_URL}/api/tools/kassir-api/categories`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    const categoriesData = await categoriesResponse.json();

    if (!categoriesResponse.ok) {
      console.error('❌ Ошибка:', categoriesData);
    } else {
      console.log('✅ Успешно получены категории');
      if (categoriesData.data && Array.isArray(categoriesData.data)) {
        console.log(`   Найдено категорий: ${categoriesData.data.length}`);
        if (categoriesData.data.length > 0) {
          console.log(`   Первая категория: ${categoriesData.data[0].name || 'N/A'}`);
        }
      } else {
        console.log('   Ответ:', JSON.stringify(categoriesData, null, 2));
      }
    }
  } catch (error) {
    console.error('❌ Ошибка получения категорий:', error.message);
  }

  // Тест 3: Быстрый поиск (требует параметр q)
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('3️⃣  Быстрый поиск (q="концерт")');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  try {
    const quickSearchResponse = await fetch(`${AI_TOOLS_URL}/api/tools/kassir-api/quick-search`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: 'концерт',
      }),
    });

    const quickSearchData = await quickSearchResponse.json();

    if (!quickSearchResponse.ok) {
      console.error('❌ Ошибка:', quickSearchData);
    } else {
      console.log('✅ Успешно выполнен быстрый поиск');
      if (quickSearchData.data && quickSearchData.data.suggestions) {
        console.log(`   Найдено предложений: ${quickSearchData.data.suggestions.length}`);
        if (quickSearchData.data.suggestions.length > 0) {
          console.log(
            `   Первое предложение: ${quickSearchData.data.suggestions[0].text || 'N/A'}`
          );
        }
      } else {
        console.log('   Ответ:', JSON.stringify(quickSearchData, null, 2));
      }
    }
  } catch (error) {
    console.error('❌ Ошибка быстрого поиска:', error.message);
  }

  // Тест 4: Поиск событий
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('4️⃣  Поиск событий (q="концерт", limit=5)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  try {
    const searchResponse = await fetch(`${AI_TOOLS_URL}/api/tools/kassir-api/search`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        q: 'концерт',
        limit: 5,
      }),
    });

    const searchData = await searchResponse.json();

    if (!searchResponse.ok) {
      console.error('❌ Ошибка:', searchData);
    } else {
      console.log('✅ Успешно выполнен поиск событий');
      if (searchData.data && searchData.data.items) {
        console.log(`   Всего найдено: ${searchData.data.total || 0}`);
        console.log(`   Вернуно: ${searchData.data.items.length}`);
        if (searchData.data.items.length > 0) {
          const firstItem = searchData.data.items[0];
          console.log(`   Первое событие: ${firstItem.title || 'N/A'}`);
          console.log(`   Тип: ${firstItem.type || 'N/A'}`);
        }
      } else {
        console.log('   Ответ:', JSON.stringify(searchData, null, 2));
      }
    }
  } catch (error) {
    console.error('❌ Ошибка поиска событий:', error.message);
  }

  // Тест 5: Статистика очереди
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('5️⃣  Статистика очереди');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  try {
    const statsResponse = await fetch(`${AI_TOOLS_URL}/api/tools/queue-stats`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
      },
    });

    const statsData = await statsResponse.json();

    if (!statsResponse.ok) {
      console.error('❌ Ошибка:', statsData);
    } else {
      console.log('✅ Статистика очереди:', statsData.stats);
    }
  } catch (error) {
    console.error('❌ Ошибка получения статистики:', error.message);
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ Тестирование завершено');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

testApiTools().catch((error) => {
  console.error('❌ Критическая ошибка:', error);
  process.exit(1);
});
