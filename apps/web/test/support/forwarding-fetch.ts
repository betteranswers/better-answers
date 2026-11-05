/** Better Auth captures `fetch` at creation, so this gives it one that forwards to the current stub. */
const original = globalThis.fetch;

const forwarding: typeof fetch = (input, init) =>
  globalThis.fetch === forwarding ? original(input, init) : globalThis.fetch(input, init);

globalThis.fetch = forwarding;
