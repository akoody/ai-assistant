import { extractChildAgeFromText } from '../../../../../shared/childAgeUtils.js';
import { hasChildAgeSlot, normalizeGuardText } from './timeGrounding.js';

function appendHeuristicChildAgeSlot(slots = [], text = '') {
  const target = Array.isArray(slots) ? slots : [];
  if (hasChildAgeSlot(target)) {
    return target;
  }

  const childAge = extractChildAgeFromText(text);
  if (!Number.isFinite(childAge)) {
    return target;
  }

  target.push({
    name: 'возраст_ребенка',
    value: String(childAge),
    confidence: 0.98,
    source: 'heuristic_child_age',
  });
  console.log(`[queueService] Добавлен эвристический слот возраста ребёнка: "${childAge}"`);
  return target;
}

function appendHeuristicSeniorAudienceSlots(slots = [], text = '') {
  const target = Array.isArray(slots) ? slots : [];
  const normalized = normalizeGuardText(text);
  if (!normalized) {
    return target;
  }

  const hasSeniorSignal =
    /(?:^|[^\p{L}])(?:бабушк[\p{L}\d]*|бабк[\p{L}\d]*|бабул[\p{L}\d]*|дедушк[\p{L}\d]*|дедул[\p{L}\d]*|дед(?:а|у|ом|е)?|пенсионер[\p{L}\d]*|пожил[\p{L}\d]*|старш[\p{L}\d]*\s+поколени[\p{L}\d]*)(?=$|[^\p{L}])/u.test(
      normalized
    );
  if (!hasSeniorSignal) {
    return target;
  }

  const upsertSlot = (name, value) => {
    const existingIndex = target.findIndex((slot) => slot && slot.name === name);
    const nextSlot = {
      name,
      value,
      confidence: 0.98,
      source: 'heuristic_senior_companion',
    };

    if (existingIndex >= 0) {
      target.splice(existingIndex, 1, nextSlot);
      return;
    }

    target.push(nextSlot);
  };

  upsertSlot('контекст_события', 'семейный');
  upsertSlot('возрастное_ограничение', 'взрослые');
  upsertSlot('аудитория_спутник', 'пожилой');
  console.log(
    '[queueService] Добавлены эвристические senior-friendly слоты: семейный, взрослые, пожилой спутник'
  );
  return target;
}

export { appendHeuristicChildAgeSlot, appendHeuristicSeniorAudienceSlots };
