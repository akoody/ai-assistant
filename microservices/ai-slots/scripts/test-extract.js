const testUserId = `test-user-${Date.now()}`;
const testText = 'хочу рок концерт завтра вечером в Москве';

async function testExtract() {
  try {
    console.log('🧪 Тестирование извлечения слотов...\n');
    console.log(`📝 Текст: "${testText}"`);
    console.log(`👤 userId: ${testUserId}\n`);

    const response = await fetch('http://localhost:3002/api/slots/extract', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-api-key-123',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: testText,
        userId: testUserId,
      }),
    });

    const data = await response.json();

    if (response.ok) {
      console.log('✅ Запрос успешно обработан\n');
      console.log('📦 Результат:');
      console.log(`   Найдено слотов: ${data.totalFound}`);
      console.log(`   Отфильтровано: ${data.filtered}`);
      console.log(`   Порог уверенности: ${data.confidenceThreshold}\n`);

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

      console.log(`\n💾 Слоты должны быть сохранены в БД для userId: ${testUserId}`);
      console.log(`\n🔍 Проверьте БД командой: node scripts/check-users.js`);
    } else {
      console.error('❌ Ошибка запроса:', data.error);
    }
  } catch (error) {
    console.error('❌ Ошибка:', error.message);
    if (error.message.includes('fetch failed')) {
      console.error('   Проверьте, что AI Slots запущен на порту 3002');
    }
  }
}

testExtract();
