import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Band } from "@/app/shell/band.tsx";

const MEASURED = 84;

/** jsdom has no layout, so this observer reports the stubbed height straight away. */
const ImmediateResizeObserver = class {
  readonly #onResize: () => void;

  constructor(onResize: () => void) {
    this.#onResize = onResize;
  }

  observe = () => this.#onResize();
  disconnect = () => undefined;
};

const bandHeightVariable = () => document.documentElement.style.getPropertyValue("--band-drawn-h");

const renderWideBand = async () => {
  vi.stubGlobal("ResizeObserver", ImmediateResizeObserver);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    DOMRect.fromRect({ height: MEASURED }),
  );
  const root = createRootRoute({
    component: () => (
      <Band
        wide
        home="/"
        switcher={null}
        navigation={null}
        jumpTo={null}
        keystrokes={null}
        parts={[]}
        person={undefined}
        signingOut={false}
        onSignOut={() => undefined}
        outcome={{ tone: "said", words: "Changes saved." }}
      />
    ),
  });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the wide band's height variable", () => {
  it("is set while rendered and cleared on unmount", async () => {
    await renderWideBand();
    expect(bandHeightVariable()).toBe(`${String(MEASURED)}px`);

    cleanup();

    expect(bandHeightVariable(), "--band-drawn-h was not cleared on unmount").toBe("");
  });
});
