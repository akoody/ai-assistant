import {
  buildProvocationRedirectResponse,
  isProvocationOrInsult,
} from '../../provocationService.js';
import { updateStatus } from '../../statusService.js';
import { buildProvocationRedirectResponseViaLlm } from '../redirects.js';

// Criticism of the assistant or an insult gets a calm apology and a redirect to the
// categories. Returns the reply outcome, or null for other messages.
export async function respondToAssistantCriticism({
  assistantCriticismIntent,
  assistantCriticismProfile,
  requestId,
  sessionId,
  userId,
  userMessage,
}) {
  if (assistantCriticismIntent || isProvocationOrInsult(userMessage)) {
    console.log(
      `🛡️ [${userId}][${sessionId}] Провокация/оскорбление — возвращаю мягкий ответ и редирект к категориям`
    );
    if (requestId) updateStatus(requestId, 'Формируем ответ...');
    const provocationScenario = assistantCriticismIntent ? 'assistant_criticism' : 'provocation';
    const useProvocationLlm = process.env.PROVOCATION_REDIRECT_USE_LLM !== '0';
    if (useProvocationLlm) {
      return {
        kind: 'reply',
        response: await buildProvocationRedirectResponseViaLlm({
          userId,
          sessionId,
          userMessage,
          requestId,
          scenario: provocationScenario,
          criticismProfile: assistantCriticismProfile,
        }),
      };
    }
    return {
      kind: 'reply',
      response: await buildProvocationRedirectResponse({
        userId,
        sessionId,
        userMessage,
        scenario: provocationScenario,
        criticismProfile: assistantCriticismProfile,
      }),
    };
  }
  return null;
}
