import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Band } from "@/app/band.tsx";
import { PICKER_WORDS } from "@/features/auth/workspace-words.ts";

const MEASURED = 84;

/** jsdom lays nothing out, so the band answers the height a browser would measure. */
const measuresTheBand = class {
  readonly #seen: () => void;

  constructor(seen: () => void) {
    this.#seen = seen;
  }

  observe = () => this.#seen();
  disconnect = () => undefined;
};

const drawnHeight = () => document.documentElement.style.getPropertyValue("--band-drawn-h");

const openTheWideBand = async () => {
  vi.stubGlobal("ResizeObserver", measuresTheBand);
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
        outcome={{ tone: "said", words: PICKER_WORDS.opening }}
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

describe("the wide band's drawn height", () => {
  it("publishes its whole height while drawn, and lets it go", async () => {
    await openTheWideBand();
    expect(drawnHeight()).toBe(`${String(MEASURED)}px`);

    cleanup();

    expect(drawnHeight(), "a narrow layout would keep the wide band's height").toBe("");
  });
});
