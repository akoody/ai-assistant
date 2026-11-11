import { normalizeClarificationTextForMatch } from '../textUtils.js';

function asksForUnsupportedAreaClarification(text = '', buttons = []) {
  const normalizedText = normalizeClarificationTextForMatch(text);
  const normalizedButtons = Array.isArray(buttons)
    ? buttons.map((item) => normalizeClarificationTextForMatch(item)).filter(Boolean)
    : [];

  const asksAreaInText =
    /(?<![A-Za-zА-Яа-яЁё0-9_])(в каком|какой|какая|какие|уточните|подскажите|выберите)(?![A-Za-zА-Яа-яЁё0-9_]).{0,80}(?<![A-Za-zА-Яа-яЁё0-9_])(район|районе|округ|округе|метро|станц|локац|локации|части города|где встрет|поблизости|ближе к дому|удобнее добираться)(?![A-Za-zА-Яа-яЁё0-9_])/u.test(
      normalizedText
    ) ||
    /(?<![A-Za-zА-Яа-яЁё0-9_])(центральный|западный|восточный|северный|южный)(?![A-Za-zА-Яа-яЁё0-9_])/u.test(
      normalizedText
    );

  const asksAreaInButtons = normalizedButtons.some((button) =>
    /^(центральный|западный|восточный|северный|южный|центр|округ|район|метро)(?![A-Za-zА-Яа-яЁё0-9_])/u.test(
      button
    )
  );

  return asksAreaInText || asksAreaInButtons;
}

function hasLooseClarificationContextMatch(text, knownValue = '') {
  const normalizedText = normalizeClarificationTextForMatch(text);
  const normalizedKnownValue = normalizeClarificationTextForMatch(knownValue);

  if (!normalizedKnownValue) {
    return true;
  }

  if (!normalizedText) {
    return false;
  }

  if (normalizedText.includes(normalizedKnownValue)) {
    return true;
  }

  const textTokens = normalizedText.split(' ').filter(Boolean);
  const knownTokens = normalizedKnownValue.split(' ').filter((token) => token.length >= 4);

  if (knownTokens.length === 0) {
    return false;
  }

  const matchedTokens = knownTokens.filter((token) => {
    const prefixLength = token.length >= 6 ? 5 : token.length >= 5 ? 4 : 3;
    const loosePrefix = token.slice(0, Math.min(prefixLength, token.length));

    return textTokens.some(
      (candidate) => candidate === token || (loosePrefix && candidate.startsWith(loosePrefix))
    );
  }).length;

  return matchedTokens >= Math.max(1, Math.ceil(knownTokens.length / 2));
}

export { asksForUnsupportedAreaClarification, hasLooseClarificationContextMatch };
