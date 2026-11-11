import { mergeSlots } from '../slotUtils.js';
import { removeSlotsByName } from '../slotUtils.js';
import { GENRE_SLOT_NAMES } from '../categoryRouting.js';
import { AMBIGUOUS_GENRE_SNAPSHOT_SOURCE } from '../categoryRouting.js';
import { updateSessionSlotsSnapshot } from '../../sessionService.js';
import { markClarificationAsked } from '../../sessionService.js';
import { updateStatus } from '../../statusService.js';
import { getMessageHistory } from '../../messagesStorage.js';
import { buildAmbiguousGenreCategoryClarificationResponse } from '../categoryRouting.js';
import { buildKnownCityClarificationResponseViaLlm } from '../clarification.js';

export async function respondToAmbiguousGenre({
  currentSlotsBeforeSpecialClarification,
  extractedSlotsForOffTopicCheck,
  ambiguousGenreChoice,
  userId,
  sessionId,
  session,
  knownCityBeforeSpecialClarification,
  requestId,
  userMessage,
}) {
  const ambiguousSnapshotBase = mergeSlots(
    currentSlotsBeforeSpecialClarification,
    extractedSlotsForOffTopicCheck
  );
  const ambiguousSnapshot = mergeSlots(
    removeSlotsByName(
      ambiguousSnapshotBase,
      new Set([
        ...GENRE_SLOT_NAMES,
        'тип_мероприятия',
        'тип_события',
        'категория',
        'category',
        'event_type',
        'исполнитель',
        'название_мероприятия',
        'поисковый_запрос',
      ])
    ),
    [
      {
        name: 'жанр',
        value: ambiguousGenreChoice.genre,
        confidence: 0.92,
        source: AMBIGUOUS_GENRE_SNAPSHOT_SOURCE,
      },
    ]
  );

  await updateSessionSlotsSnapshot(userId, sessionId, ambiguousSnapshot);
  session.slotsSnapshot = ambiguousSnapshot;
  await markClarificationAsked(userId, sessionId);
  session.clarificationAsked = true;

  console.log(
    `🧭 [${userId}][${sessionId}] Неоднозначный жанр "${ambiguousGenreChoice.genre}" — запрашиваю выбор категории`,
    { categories: ambiguousGenreChoice.categories, knownCity: knownCityBeforeSpecialClarification }
  );
  if (requestId) updateStatus(requestId, 'Формируем ответ...');

  const history = await getMessageHistory(userId, sessionId);
  const fallbackResponse = buildAmbiguousGenreCategoryClarificationResponse({
    genre: ambiguousGenreChoice.genre,
    buttons: ambiguousGenreChoice.buttons,
    knownCity: knownCityBeforeSpecialClarification,
  });

  return await buildKnownCityClarificationResponseViaLlm({
    userId,
    sessionId,
    userMessage,
    requestId,
    knownCity: knownCityBeforeSpecialClarification,
    slots: ambiguousSnapshot,
    targetHint: 'ambiguous_category',
    originalText: fallbackResponse.message,
    originalButtons: ambiguousGenreChoice.buttons,
    history,
  });
}
