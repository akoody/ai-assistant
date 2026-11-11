import { getLLMs } from './configService.js';

const roundRobinIndexes = new Map();

export function getActiveLLMs(type = null) {
  const allLLMs = getLLMs();
  let activeLLMs = allLLMs.filter((llm) => llm.enabled === true);

  if (type) {
    // Фильтруем по типу
    const typedLLMs = activeLLMs.filter(
      (llm) => llm.types && Array.isArray(llm.types) && llm.types.includes(type)
    );

    if (typedLLMs.length > 0) {
      return typedLLMs;
    }
  }

  return activeLLMs;
}

export function selectLLM(type = null) {
  const activeLLMs = getActiveLLMs(type);

  if (activeLLMs.length === 0) {
    return null;
  }

  const key = type || 'default';
  const currentIndex = roundRobinIndexes.get(key) || 0;
  const selectedLLM = activeLLMs[currentIndex % activeLLMs.length];

  roundRobinIndexes.set(key, (currentIndex + 1) % activeLLMs.length);

  return selectedLLM;
}

export function resetBalancer() {
  roundRobinIndexes.clear();
}
