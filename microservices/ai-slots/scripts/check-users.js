import { loadRootEnv } from '../../../shared/runtimeEnv.js';
loadRootEnv(import.meta.url);
import { MongoClient } from 'mongodb';

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME;

async function checkUsers() {
  let client;

  try {
    console.log('🔌 Подключение к MongoDB...');
    client = new MongoClient(MONGODB_URI, {
      useUnifiedTopology: true,
      useNewUrlParser: true,
    });

    await client.connect();
    console.log('✅ Подключение установлено\n');

    const db = client.db(DB_NAME);
    const usersCollection = db.collection('users');

    // Получаем всех пользователей
    const users = await usersCollection.find({}).toArray();

    console.log(`📊 Всего пользователей в БД: ${users.length}\n`);

    if (users.length === 0) {
      console.log('ℹ️  В коллекции users пока нет данных');
      console.log('   Слоты будут сохранены после успешного извлечения через API\n');
      return;
    }

    // Подсчитываем статистику
    let totalSlots = 0;
    let slotsWithParsedDate = 0;
    let slotsWithDateRange = 0;

    // Выводим информацию о каждом пользователе
    users.forEach((user, index) => {
      console.log(`\n${'═'.repeat(70)}`);
      console.log(`👤 Пользователь #${index + 1}:`);
      console.log(`   userId: ${user.userId}`);
      console.log(
        `   createdAt: ${user.createdAt ? new Date(user.createdAt).toLocaleString('ru-RU') : 'N/A'}`
      );
      console.log(
        `   updatedAt: ${user.updatedAt ? new Date(user.updatedAt).toLocaleString('ru-RU') : 'N/A'}`
      );

      if (user.slots && user.slots.length > 0) {
        totalSlots += user.slots.length;
        console.log(`   📦 Всего слотов: ${user.slots.length}`);

        // Сортируем слоты по дате извлечения (новые сначала)
        const sortedSlots = [...user.slots].sort((a, b) => {
          const dateA = a.extractedAt ? new Date(a.extractedAt).getTime() : 0;
          const dateB = b.extractedAt ? new Date(b.extractedAt).getTime() : 0;
          return dateB - dateA;
        });

        console.log(`   Слоты (отсортированы по дате, новые первые):`);
        sortedSlots.forEach((slot, slotIndex) => {
          let slotInfo = `      ${slotIndex + 1}. ${slot.name}: "${slot.value}" (confidence: ${slot.confidence})`;

          // Добавляем дату извлечения
          if (slot.extractedAt) {
            const extractedAtStr = new Date(slot.extractedAt).toLocaleString('ru-RU');
            slotInfo += `\n         🕐 Извлечен: ${extractedAtStr}`;
          }

          // Добавляем информацию о парсированной дате
          if (slot.parsedDate) {
            slotsWithParsedDate++;
            const parsedDate =
              slot.parsedDate instanceof Date ? slot.parsedDate : new Date(slot.parsedDate);
            const parsedDateStr = parsedDate.toLocaleString('ru-RU');
            slotInfo += `\n         📅 parsedDate: ${parsedDateStr} (UTC: ${parsedDate.toISOString()})`;
          }

          // Добавляем информацию о диапазоне дат
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
            slotInfo += `\n         📆 dateRange: ${startDateStr} - ${endDateStr}`;
          }

          if (!slot.parsedDate && !slot.dateRange) {
            slotInfo += `\n         ⚠️  Нет парсированной даты`;
          }

          console.log(slotInfo);
        });
      } else {
        console.log(`   ⚠️  У пользователя нет сохраненных слотов`);
      }
    });

    // Выводим общую статистику
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`📊 ОБЩАЯ СТАТИСТИКА:`);
    console.log(`   Всего пользователей: ${users.length}`);
    console.log(`   Всего слотов: ${totalSlots}`);
    console.log(`   Слотов с parsedDate: ${slotsWithParsedDate}`);
    console.log(`   Слотов с dateRange: ${slotsWithDateRange}`);
    console.log(
      `   Слотов без парсированных дат: ${totalSlots - slotsWithParsedDate - slotsWithDateRange}`
    );
    console.log(`${'═'.repeat(70)}`);

    console.log('\n✅ Проверка завершена');
  } catch (error) {
    console.error('❌ Ошибка при проверке пользователей:', error);
    process.exit(1);
  } finally {
    if (client) {
      await client.close();
      console.log('\n🔌 Подключение закрыто');
    }
  }
}

checkUsers();
