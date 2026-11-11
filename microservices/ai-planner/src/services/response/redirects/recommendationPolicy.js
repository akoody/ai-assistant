function shouldBypassVagueClarificationForShowMore({
  isShowMoreRequest,
  hasPreviouslyShownEvents,
  hasValidCity,
}) {
  return Boolean(isShowMoreRequest && hasPreviouslyShownEvents && hasValidCity);
}

function shouldRepeatOfferForSameRecommendationRequest({
  shouldSkipOfferGeneration = false,
  offerEvents = null,
  session = null,
  allRequiredCollected = false,
  wantsRecommendations = false,
  hasSpecificEventType = false,
  showAllRequested = false,
  isShowMoreRequest = false,
  isChangeCityRequest = false,
  isChangeDateRequest = false,
  isChangePreferencesRequest = false,
  isHealthComplaintRequest = false,
  isEventDetailsRequest = false,
  slotsChanged = false,
  categoryChanged = false,
  isExplicitAnyBudget = false,
  isExplicitAnyDate = false,
} = {}) {
  const hasPreparedOffer = Array.isArray(offerEvents) && offerEvents.length > 0;

  return (
    !shouldSkipOfferGeneration &&
    !hasPreparedOffer &&
    Boolean(session?.quickOfferSent) &&
    !session?.finalOfferSent &&
    allRequiredCollected &&
    wantsRecommendations &&
    hasSpecificEventType &&
    !showAllRequested &&
    !isShowMoreRequest &&
    !isChangeCityRequest &&
    !isChangeDateRequest &&
    !isChangePreferencesRequest &&
    !isHealthComplaintRequest &&
    !isEventDetailsRequest &&
    !slotsChanged &&
    !categoryChanged &&
    !isExplicitAnyBudget &&
    !isExplicitAnyDate
  );
}

export { shouldBypassVagueClarificationForShowMore, shouldRepeatOfferForSameRecommendationRequest };
