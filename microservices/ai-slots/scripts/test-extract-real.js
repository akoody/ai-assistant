import { loadRootEnv, resolveInternalApiKey } from '../../../shared/runtimeEnv.js';
loadRootEnv(import.meta.url);
import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME;
const AI_SLOTS_URL = process.env.AI_SLOTS_URL || 'http://localhost:3002';
const API_KEY = resolveInternalApiKey({
  serviceName: 'ai-slots client',
  settingName: 'testApiKey',
  envName: 'AI_SLOTS_API_KEY',
});

// Генерируем уникальный userId (но не удаляем его после теста)
const testUserId = `real-test-user-${Date.now()}`;
const testText = 'хочу рок концерт завтра вечером в Москве';

async function testExtract() {
  let mongoClient = null;

  try {
    console.log('🧪 Тестирование извлечения слотов через API с реальной БД...\n');
    console.log(`📝 Текст: "${testText}"`);
    console.log(`👤 userId: ${testUserId}`);
    console.log(`🌐 API URL: ${AI_SLOTS_URL}\n`);

    // Шаг 1: Отправляем запрос к API
    console.log('📤 Отправка запроса к API...');
    const response = await fetch(`${AI_SLOTS_URL}/api/slots/extract`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: testText,
        userId: testUserId,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('❌ Ошибка запроса:', data.error || data);
      process.exit(1);
    }

    console.log('✅ Запрос успешно обработан\n');
    console.log('📦 Результат API:');
    console.log(`   Найдено слотов: ${data.totalFound || 0}`);
    console.log(`   Отфильтровано: ${data.filtered || 0}`);
    console.log(`   Порог уверенности: ${data.confidenceThreshold || 'N/A'}\n`);

    if (data.slots && data.slots.length > 0) {
      console.log('🎯 Извлеченные слоты:');
      data.slots.forEach((slot, index) => {
        let slotInfo = `   ${index + 1}. ${slot.name}: "${slot.value}" (confidence: ${slot.confidence})`;

        // Добавляем информацию о парсированной дате
        if (slot.parsedDate) {
          const parsedDateStr = new Date(slot.parsedDate).toLocaleString('ru-RU');
          slotInfo += `\n      📅 parsedDate: ${parsedDateStr}`;
        }

        // Добавляем информацию о диапазоне дат
        if (slot.dateRange) {
          const startDateStr = new Date(slot.dateRange.startDate).toLocaleString('ru-RU');
          const endDateStr = new Date(slot.dateRange.endDate).toLocaleString('ru-RU');
          slotInfo += `\n      📆 dateRange: ${startDateStr} - ${endDateStr}`;
        }

        console.log(slotInfo);
      });
    } else {
      console.log('⚠️  Слоты не найдены или отфильтрованы');
    }

    // Шаг 2: Ждем немного для обработки (очередь может быть асинхронной)
    console.log('\n⏳ Ожидание обработки запроса (3 секунды)...');
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Шаг 3: Проверяем БД
    console.log('\n🔍 Проверка данных в БД...');
    mongoClient = new MongoClient(MONGODB_URI, {
      useUnifiedTopology: true,
      useNewUrlParser: true,
    });

    await mongoClient.connect();
    const db = mongoClient.db(DB_NAME);
    const usersCollection = db.collection('users');

    const user = await usersCollection.findOne({ userId: testUserId });

    if (!user) {
      console.error(`❌ Пользователь ${testUserId} не найден в БД!`);
      console.error('   Возможно, запрос еще обрабатывается или произошла ошибка сохранения.');
      process.exit(1);
    }

    console.log(`✅ Пользователь найден в БД`);
    console.log(
      `   createdAt: ${user.createdAt ? new Date(user.createdAt).toLocaleString('ru-RU') : 'N/A'}`
    );
    console.log(
      `   updatedAt: ${user.updatedAt ? new Date(user.updatedAt).toLocaleString('ru-RU') : 'N/A'}`
    );

    if (!user.slots || user.slots.length === 0) {
      console.error('❌ У пользователя нет сохраненных слотов!');
      process.exit(1);
    }

    console.log(`\n📦 Сохранено слотов в БД: ${user.slots.length}\n`);

    // Сортируем слоты по дате извлечения (новые сначала)
    const sortedSlots = [...user.slots].sort((a, b) => {
      const dateA = a.extractedAt ? new Date(a.extractedAt).getTime() : 0;
      const dateB = b.extractedAt ? new Date(b.extractedAt).getTime() : 0;
      return dateB - dateA;
    });

    console.log('💾 Слоты в БД (отсортированы по дате, новые первые):');
    let slotsWithParsedDate = 0;
    let slotsWithDateRange = 0;

    sortedSlots.forEach((slot, index) => {
      let slotInfo = `   ${index + 1}. ${slot.name}: "${slot.value}" (confidence: ${slot.confidence})`;

      if (slot.extractedAt) {
        const extractedAtStr = new Date(slot.extractedAt).toLocaleString('ru-RU');
        slotInfo += `\n      🕐 Извлечен: ${extractedAtStr}`;
      }

      // Проверяем парсированную дату
      if (slot.parsedDate) {
        slotsWithParsedDate++;
        const parsedDate =
          slot.parsedDate instanceof Date ? slot.parsedDate : new Date(slot.parsedDate);
        const parsedDateStr = parsedDate.toLocaleString('ru-RU');
        slotInfo += `\n      ✅ 📅 parsedDate: ${parsedDateStr} (UTC: ${parsedDate.toISOString()})`;
      }

      // Проверяем диапазон дат
      if (slot.dateRange) {
        slotsWithDateRange++;
        const startDate =
          slot.dateRange.startDate instanceof Date
            ? slot.dateRange.startDate
            : new Date(slot.dateRange.startDate);
        const endDate =
          slot.dateRange.endDate instanceof Date
            ? slot.dateRange.endDate
            : new Date(slot.dateRange.endDate);
        const startDateStr = startDate.toLocaleString('ru-RU');
        const endDateStr = endDate.toLocaleString('ru-RU');
        slotInfo += `\n      ✅ 📆 dateRange: ${startDateStr} - ${endDateStr}`;
      }

      if (!slot.parsedDate && !slot.dateRange) {
        slotInfo += `\n      ⚠️  Нет парсированной даты`;
      }

      console.log(slotInfo);
    });

    // Итоговая статистика
    console.log(`\n${'═'.repeat(70)}`);
    console.log('📊 ИТОГОВАЯ СТАТИСТИКА:');
    console.log(`   Всего слотов: ${sortedSlots.length}`);
    console.log(`   Слотов с parsedDate: ${slotsWithParsedDate}`);
    console.log(`   Слотов с dateRange: ${slotsWithDateRange}`);
    console.log(
      `   Слотов без парсированных дат: ${sortedSlots.length - slotsWithParsedDate - slotsWithDateRange}`
    );
    console.log(`${'═'.repeat(70)}\n`);

    if (slotsWithParsedDate > 0 || slotsWithDateRange > 0) {
      console.log('✅ УСПЕХ! Парсированные даты сохранены в БД!');
      console.log(`\n💾 Данные сохранены в БД и останутся там.`);
      console.log(`   userId: ${testUserId}`);
      console.log(`   Проверить можно командой: node scripts/check-users.js\n`);
    } else {
      console.log('⚠️  ВНИМАНИЕ: Парсированные даты не найдены в БД!');
      console.log('   Возможно, в тексте нет относительных дат или произошла ошибка парсинга.\n');
    }
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
    if (error.message.includes('fetch failed')) {
      console.error('   Проверьте, что AI Slots запущен на порту 3002');
      console.error(`   URL: ${AI_SLOTS_URL}`);
    }
    process.exit(1);
  } finally {
    if (mongoClient) {
      await mongoClient.close();
      console.log('🔌 Подключение к MongoDB закрыто');
    }
  }
}

testExtract();
