// Jest setup for unit tests: a real HTTP call would make results depend on whichever
// services happen to run locally. Tests that need a response replace globalThis.fetch.
globalThis.fetch = async (input) => {
  const url = typeof input === 'string' ? input : input?.url;
  throw new TypeError(`Network access is disabled in unit tests: ${url}`);
};
