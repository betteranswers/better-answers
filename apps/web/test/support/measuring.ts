import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

const NOTHING = () => undefined;

/** The popper measures what it places, which jsdom cannot. */
const measuresNothing = class {
  observe = NOTHING;
  unobserve = NOTHING;
  disconnect = NOTHING;
};

/** jsdom lays nothing out, and a select scrolls its chosen choice into view as it opens. */
export const choosing = (trigger: HTMLElement, choice: string): void => {
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    value: NOTHING,
    configurable: true,
  });
  try {
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(screen.getByRole("option", { name: choice }));
  } finally {
    Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  }
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
