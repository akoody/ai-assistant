import { routeRequest } from './routeRequest.js';
import { reconcileSlots } from './reconcileSlots.js';
import { resolveSearchSlots } from './resolveSearchSlots.js';
import { prepareSearchContext } from './prepareSearchContext.js';
import { generateOffers } from './generateOffers.js';
import { composeReply } from './composeReply.js';
import { finalizeReply } from './finalizeReply.js';

/**
 * The dialogue pipeline. Every stage either answers the request
 * (`{ kind: 'reply', response }`) or hands its results to the following stages
 * (`{ kind: 'continue', context }`). Results are kept per stage under `name`, so a stage
 * declares in its signature which earlier stage each input comes from:
 *
 *   request        userId, sessionId, userMessage, slotExtractionResult, requestId
 *   routing        detected intents and routing flags        (routeRequest)
 *   slots          slots reconciled with session and history (reconcileSlots)
 *   searchSlots    effective search slots and request type   (resolveSearchSlots)
 *   searchContext  search validity and clarification needs   (prepareSearchContext)
 *   offers         found events and offer flags              (generateOffers)
 *   reply          assistant text and described events      (composeReply)
 */
const responseStages = [
  { name: 'routing', run: routeRequest },
  { name: 'slots', run: reconcileSlots },
  { name: 'searchSlots', run: resolveSearchSlots },
  { name: 'searchContext', run: prepareSearchContext },
  { name: 'offers', run: generateOffers },
  { name: 'reply', run: composeReply },
  { name: 'final', run: finalizeReply },
];

export async function generateResponse(
  userId,
  sessionId,
  userMessage,
  slotExtractionResult = null,
  requestId = null
) {
  let context = { request: { userId, sessionId, userMessage, slotExtractionResult, requestId } };
  try {
    for (const stage of responseStages) {
      const result = await stage.run(context);
      if (result.kind === 'reply') return result.response;
      context = { ...context, [stage.name]: result.context };
    }
    throw new Error('Response pipeline completed without a reply');
  } catch (error) {
    console.error('Ошибка генерации ответа LLM:', error);
    throw error;
  }
}
