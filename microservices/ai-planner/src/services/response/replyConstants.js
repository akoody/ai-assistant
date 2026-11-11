const DEFAULT_CITY_SELECTION_BUTTONS = Object.freeze([
  'Москва',
  'Санкт-Петербург',
  'Екатеринбург',
  'Новосибирск',
  'Казань',
  'Нижний Новгород',
  'Другой город',
]);

const EMPTY_PREFERENCES_BUTTONS = Object.freeze(['Стендап', 'Концерты', 'Театры', 'Выставки']);

const CITY_CHANGE_CATEGORY_BUTTONS = Object.freeze([
  'Концерты',
  'Театры',
  'Выставки',
  'Музеи',
  'Стендап',
  'Покажи все',
]);

const CLARIFICATION_DECLINE_BUTTONS = Object.freeze([
  'Концерты',
  'Театры',
  'Выставки',
  'Музеи',
  'Покажи все',
]);

const POSITIVE_FEEDBACK_ACK_BUTTONS = Object.freeze(['Показать другие варианты', 'Может, позже']);

export {
  DEFAULT_CITY_SELECTION_BUTTONS,
  EMPTY_PREFERENCES_BUTTONS,
  CITY_CHANGE_CATEGORY_BUTTONS,
  CLARIFICATION_DECLINE_BUTTONS,
  POSITIVE_FEEDBACK_ACK_BUTTONS,
};
