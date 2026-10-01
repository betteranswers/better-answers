import { act, cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useJumping } from "@/app/jump-to.tsx";

afterEach(cleanup);

type Modifier = { readonly metaKey: true } | { readonly ctrlKey: true };

/** Answers whether the browser may still act on the chord. */
const pressTheChord = (modifier: Modifier, repeat = false): boolean => {
  let browsers = true;
  act(() => {
    browsers = fireEvent.keyDown(document, { key: "k", ...modifier, repeat });
  });
  return browsers;
};

describe.each<[string, Modifier]>([
  ["⌘K", { metaKey: true }],
  ["Ctrl K", { ctrlKey: true }],
])("the jump-to chord, %s", (_chord, modifier) => {
  it("opens jump-to, and closes it when pressed again", () => {
    const { result } = renderHook(() => useJumping(true));

    pressTheChord(modifier);
    expect(result.current.open).toBe(true);
    pressTheChord(modifier);
    expect(result.current.open).toBe(false);
  });

  it("leaves jump-to open while the chord is held", () => {
    const { result } = renderHook(() => useJumping(true));

    pressTheChord(modifier);
    pressTheChord(modifier, true);

    expect(result.current.open).toBe(true);
  });

  it("keeps a held chord from the browser's own search bar", () => {
    renderHook(() => useJumping(true));

    pressTheChord(modifier);

    expect(pressTheChord(modifier, true)).toBe(false);
  });
});
