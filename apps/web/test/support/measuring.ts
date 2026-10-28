import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

const NOTHING = () => undefined;

/** The popper measures what it places, which jsdom cannot. */
const measuresNothing = class {
  observe = NOTHING;
  unobserve = NOTHING;
  disconnect = NOTHING;
};

export const placedWithoutMeasuring = (): void => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", measuresNothing);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });
};
