/** Better Auth keeps the `fetch` it found when made, so this gives it one that asks the stub standing now. */
const original = globalThis.fetch;

const forwarding: typeof fetch = (input, init) =>
  globalThis.fetch === forwarding ? original(input, init) : globalThis.fetch(input, init);

globalThis.fetch = forwarding;
