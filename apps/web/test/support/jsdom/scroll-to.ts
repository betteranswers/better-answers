import { beforeAll } from "vitest";

// jsdom prints "Not implemented" for every window.scrollTo call. A node-environment file has no window.
beforeAll(() => {
  if (typeof window === "undefined") return;
  Object.defineProperty(window, "scrollTo", {
    configurable: true,
    writable: true,
    value: () => {},
  });
});
