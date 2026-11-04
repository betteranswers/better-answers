import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

declare global {
  var fetchBeforeAnyStub: typeof fetch | undefined;
}

/** Vitest has no globals, so Testing Library registers no cleanup of its own. */
afterEach(cleanup);

/**
 * Under Vitest's `isolate: false` a worker keeps modules and the jsdom window across files, so each
 * file starts fresh here.
 */
globalThis.fetchBeforeAnyStub ??= globalThis.fetch;
globalThis.fetch = globalThis.fetchBeforeAnyStub;
vi.resetModules();
vi.unstubAllGlobals();
vi.useRealTimers();
if (typeof document !== "undefined") {
  globalThis.history.replaceState(null, "", "/");
  globalThis.localStorage.clear();
  globalThis.sessionStorage.clear();
  for (const cookie of document.cookie.split(";")) {
    const name = cookie.split("=")[0]?.trim();
    if (name) document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
  }
  document.head.replaceChildren();
  document.body.replaceChildren();
  document.documentElement.removeAttribute("class");
  document.documentElement.removeAttribute("style");
  document.title = "";
}
