import { updateStatus } from '../../statusService.js';
import { isBuyTicketsCommand } from '../offerText.js';

// "Купить билеты" points the user to the ticket links of the cards already shown.
// Returns the reply outcome, or null for other messages.
export async function respondToBuyTicketsCommand({ requestId, session, userMessage }) {
  if (isBuyTicketsCommand(userMessage)) {
    if (requestId) updateStatus(requestId, 'Формируем ответ...');

    const selectedEvent = session?.selectedEvent || null;
    const selectedUrl = typeof selectedEvent?.url === 'string' ? selectedEvent.url.trim() : '';

    if (selectedEvent && selectedUrl) {
      return {
        kind: 'reply',
        response: {
          message:
            'Чтобы купить билеты, нажмите на карточку события выше — откроется страница для покупки.',
          buttons: ['Показать другие варианты'],
          offer: {
            events: [selectedEvent],
            type: 'details',
          },
        },
      };
    }

    return {
      kind: 'reply',
      response: {
        message:
          'Подскажите, для какого события вы хотите купить билеты? Напишите номер из списка (например, "1") или название.',
        buttons: [],
        offer: null,
      },
    };
  }
  return null;
}
