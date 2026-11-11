import { parseBudgetSlotAmount } from './preferenceFeedback.js';
import { filterEventsByBudget } from '../offerService.js';
import { filterEventsByRequestedType } from '../offerService.js';
import { filterEventsByChildAge } from '../offerService.js';
import { filterEventsByExplicitDate } from '../offerDateFilter.js';
import { filterEventsByMonth } from '../offerService.js';
import { rankEvents } from '../offerService.js';

export async function recoverPreviousOffer({
  canCheckPrevious,
  isEventDetailsRequest,
  slotsChanged,
  isExplicitAnyBudget,
  isExplicitAnyDate,
  effectiveSlots,
  session,
  dateSlotChanged,
  shownEventsHistory,
  userId,
  sessionId,
  offerEvents,
  userMessage,
  freshSearchDetected,
  noResultsDetected,
}) {
  if (
    canCheckPrevious &&
    !isEventDetailsRequest &&
    (slotsChanged || isExplicitAnyBudget || isExplicitAnyDate)
  ) {
    const budgetSlot = effectiveSlots.find((s) => s.name === 'бюджет');
    const priceToSlot = effectiveSlots.find((s) => s.name === 'цена_до');
    let budget = parseBudgetSlotAmount(budgetSlot) ?? parseBudgetSlotAmount(priceToSlot);
    if (isNaN(budget)) {
      budget = 0; // Treat non-numeric budgets like "Любой" as 0
    }

    // Проверяем, был ли добавлен слот бюджета (сравниваем с предыдущим snapshot)
    const previousSlotsSnapshot = session.slotsSnapshot || [];
    const previousBudgetSlot = previousSlotsSnapshot.find((s) => s && s.name === 'бюджет');
    const previousPriceToSlot = previousSlotsSnapshot.find((s) => s && s.name === 'цена_до');
    let previousBudget =
      parseBudgetSlotAmount(previousBudgetSlot) ?? parseBudgetSlotAmount(previousPriceToSlot);
    if (isNaN(previousBudget)) {
      previousBudget = 0; // Treat non-numeric previous budgets as 0
    }

    // Проверяем, изменилось ли значение слота бюджета (или цена_до)
    // Для сравнения изменений используем строковые значения, чтобы отличать "Любой" от чисел
    const currentBudgetValue = budgetSlot?.value || priceToSlot?.value;
    const previousBudgetValue = previousBudgetSlot?.value || previousPriceToSlot?.value;
    const budgetSlotChanged = String(currentBudgetValue) !== String(previousBudgetValue);

    // Если бюджет был добавлен или изменен, и есть ранее показанные события
    // Поддерживаем случай "Любой" бюджет (budget <= 0 или null)
    const budgetWasAdded = (!previousBudget || previousBudget <= 0) && budget && budget > 0;
    const budgetWasChanged = previousBudget && budget && budget > 0 && previousBudget !== budget;
    // Если бюджет стал "Любой" (или <= 0) И при этом слот бюджета изменился (или был добавлен) ИЛИ пользователь явно выбрал "Любой"
    const budgetResetToAny = (!budget || budget <= 0) && (budgetSlotChanged || isExplicitAnyBudget);

    const shouldCheckPreviousEvents =
      budgetWasAdded ||
      budgetWasChanged ||
      budgetResetToAny ||
      dateSlotChanged ||
      isExplicitAnyDate;

    if (shouldCheckPreviousEvents && shownEventsHistory.length > 0) {
      const budgetLabel = budget && budget > 0 ? `${budget} руб.` : 'Любой';
      const changeReason = dateSlotChanged ? 'дата' : 'бюджет';
      console.log(
        `💰 [${userId}][${sessionId}] Параметры изменены (${changeReason}). Проверяю ранее показанные события (${shownEventsHistory.length} шт.)...`
      );

      // Фильтруем ранее показанные события по новому бюджету
      const filteredPreviousEvents = filterEventsByBudget(shownEventsHistory, effectiveSlots);

      if (filteredPreviousEvents.length > 0) {
        console.log(
          `✅ [${userId}][${sessionId}] Найдено ${filteredPreviousEvents.length} ранее показанных событий, подходящих под бюджет ${budgetLabel}`
        );

        // Создаем Set для быстрой проверки дубликатов по ID и подписи
        const seenIds = new Set();
        const seenSignatures = new Set();

        // Добавляем ID и подписи новых событий
        offerEvents.forEach((event) => {
          if (event.id) {
            seenIds.add(String(event.id).trim());
          }
          // Создаем подпись для события (название + дата + место)
          if (event.title && (event.date || event.venue)) {
            const signature = `${(event.title || '').toLowerCase().trim()}|${(event.date || '').toLowerCase().trim()}|${(event.venue || '').toLowerCase().trim()}`;
            if (signature.length > 2) {
              seenSignatures.add(signature);
            }
          }
        });

        // Добавляем ранее показанные события, исключая дубликаты
        const uniquePreviousEvents = [];
        filteredPreviousEvents.forEach((event) => {
          // Проверяем по ID
          if (event.id && seenIds.has(String(event.id).trim())) {
            return;
          }

          // Проверяем по подписи
          if (event.title && (event.date || event.venue)) {
            const signature = `${(event.title || '').toLowerCase().trim()}|${(event.date || '').toLowerCase().trim()}|${(event.venue || '').toLowerCase().trim()}`;
            if (signature.length > 2 && seenSignatures.has(signature)) {
              return;
            }
            seenSignatures.add(signature);
          }

          // Добавляем ID в seenIds
          if (event.id) {
            seenIds.add(String(event.id).trim());
          }

          uniquePreviousEvents.push(event);
        });

        const previousEventsMatchingRequestedType = filterEventsByRequestedType(
          filterEventsByChildAge(uniquePreviousEvents, effectiveSlots),
          effectiveSlots
        );

        const previousEventsMatchingCurrentDate =
          dateSlotChanged || isExplicitAnyDate
            ? filterEventsByExplicitDate(
                filterEventsByMonth(
                  previousEventsMatchingRequestedType,
                  effectiveSlots,
                  userMessage
                ),
                effectiveSlots,
                userMessage
              )
            : previousEventsMatchingRequestedType;

        // Уже показанные события больше не подмешиваем обратно после уточнений.
        // Если по новым ограничениям новых вариантов нет, лучше честно показать no-results,
        // чем повторять уже просмотренные карточки.

        const hasNewEvents = offerEvents && offerEvents.length > 0;
        let shouldAddPreviousEvents = false;

        if (freshSearchDetected) {
          console.log(
            `🆕 [${userId}][${sessionId}] Это новый независимый запрос. Ранее показанные события не подмешиваю обратно.`
          );
          shouldAddPreviousEvents = false;
        } else if (isExplicitAnyBudget) {
          // Если выбран "Любой" бюджет:
          // ВАЖНО: Если новые события есть, но они ВСЕ являются дубликатами старых (т.е. offerEvents == 0 после фильтрации),
          // то мы всё равно должны попробовать показать старые, чтобы не возвращать пустоту.
          // Но offerEvents здесь - это уже отфильтрованные новые события.

          // Если offerEvents не пустой, значит мы нашли что-то новое -> показываем ТОЛЬКО новое
          if (hasNewEvents) {
            console.log(
              `🆕 [${userId}][${sessionId}] Выбран 'Любой' бюджет и найдены НОВЫЕ события (${offerEvents.length} шт.) - НЕ добавляем предыдущие.`
            );
            shouldAddPreviousEvents = false;
          } else {
            // Если новых нет вообще -> показываем старые (fallback)
            // НО! Если пользователь жалуется, что выдает "то же самое", возможно, стоит вернуть ПУСТОЙ список,
            // чтобы LLM сказала "больше ничего нет".
            // Однако, если мы вернем пустой список, noResultsDetected станет true, и будет сгенерирован текст "К сожалению...".
            // Это лучше, чем дубликаты.
            console.log(
              `🔄 [${userId}][${sessionId}] Выбран 'Любой' бюджет, но новые события не найдены. Не показываю старые, чтобы избежать дублей.`
            );
            shouldAddPreviousEvents = false;
          }
        } else if (dateSlotChanged || isExplicitAnyDate) {
          // Если дата изменена:
          // Аналогично, если мы нашли новые события на новую дату, показываем их.
          // Если не нашли - лучше сказать "нет событий на эту дату", чем показывать старые (которые скорее всего на другую дату).
          // Исключение: если старые события (uniquePreviousEvents) тоже подходят под новую дату (например, длинные фестивали).

          if (hasNewEvents) {
            console.log(
              `🆕 [${userId}][${sessionId}] Дата изменена и найдены НОВЫЕ события (${offerEvents.length} шт.) - НЕ добавляем предыдущие.`
            );
            shouldAddPreviousEvents = false;
          } else {
            // Проверяем, подходят ли старые события под новую дату?
            // Если дата сброшена на "Любая" (нет слота даты), то старые события точно подходят.
            const dateSlot = effectiveSlots.find((s) => s.name === 'дата_события');
            const isAnyDate = !dateSlot || !dateSlot.value;

            if (isAnyDate) {
              console.log(
                `🔄 [${userId}][${sessionId}] Дата сброшена на 'Любая'. Новые события не найдены, показываю старые (так как они подходят под 'Любую').`
              );
              shouldAddPreviousEvents = uniquePreviousEvents.length > 0;
            } else {
              if (previousEventsMatchingCurrentDate.length > 0) {
                console.log(
                  `🔄 [${userId}][${sessionId}] Дата изменена, новых событий нет, ` +
                    `но ${previousEventsMatchingCurrentDate.length} ранее показанных всё ещё подходят по новой дате.`
                );
                shouldAddPreviousEvents = true;
              } else {
                console.log(
                  `⛔ [${userId}][${sessionId}] Дата изменена, а ранее показанные события ` +
                    `не подходят под новый диапазон. Не возвращаю старые карточки.`
                );
                shouldAddPreviousEvents = false;
              }
            }
          }
        } else {
          console.log(
            `🔁 [${userId}][${sessionId}] Новые параметры заданы, но повторно показывать уже просмотренные события не буду.`
          );
          shouldAddPreviousEvents = false;
        }

        if (shouldAddPreviousEvents) {
          const previousEventsToMerge =
            dateSlotChanged || isExplicitAnyDate
              ? previousEventsMatchingCurrentDate
              : uniquePreviousEvents;

          console.log(
            `🔄 [${userId}][${sessionId}] Добавляю ${previousEventsToMerge.length} ранее показанных событий к новым (${offerEvents.length} шт.)`
          );

          // Объединяем новые и ранее показанные события
          const allEvents = [...offerEvents, ...previousEventsToMerge];

          // Ранжируем все события вместе
          const rankedAllEvents = rankEvents(allEvents, effectiveSlots, userMessage);

          // Повторно применяем детерминированные фильтры, чтобы fallback не возвращал события
          // с неподходящей датой или бюджетом.
          const filteredAllEvents = filterEventsByBudget(rankedAllEvents, effectiveSlots);
          const filteredAllEventsByChildAge = filterEventsByChildAge(
            filteredAllEvents,
            effectiveSlots
          );
          const filteredAllEventsByMonth = filterEventsByMonth(
            filteredAllEventsByChildAge,
            effectiveSlots,
            userMessage
          );
          const filteredAllEventsByDate = filterEventsByExplicitDate(
            filteredAllEventsByMonth,
            effectiveSlots,
            userMessage
          );
          const filteredAllEventsByType = filterEventsByRequestedType(
            filteredAllEventsByDate,
            effectiveSlots
          );

          // Берем топ-5
          const MAX_EVENTS_PER_OFFER = 5;
          offerEvents = filteredAllEventsByType.slice(0, MAX_EVENTS_PER_OFFER);

          console.log(
            `🎯 [${userId}][${sessionId}] После объединения и ранжирования: ${offerEvents.length} событий (из ${allEvents.length} объединенных)`
          );

          if (offerEvents.length > 0) {
            noResultsDetected = false;
          } else if (allEvents.length > 0) {
            console.log(
              `⚠️ [${userId}][${sessionId}] После объединения и ранжирования все события удалены. Устанавливаю noResultsDetected = true.`
            );
            noResultsDetected = true;
          }
        } else {
          console.log(
            `ℹ️ [${userId}][${sessionId}] Ранее показанные события не подмешиваю обратно в выдачу.`
          );
        }
      } else {
        console.log(
          `ℹ️ [${userId}][${sessionId}] Нет ранее показанных событий, подходящих под бюджет ${budgetLabel}`
        );
      }
    }
  }

  return { offerEvents, noResultsDetected };
}
