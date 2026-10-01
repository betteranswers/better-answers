import { act, cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useJumping } from "@/app/jump-to.tsx";

afterEach(cleanup);

/** Answers whether the browser may still act on the chord. */
const pressTheChord = (repeat = false): boolean => {
  let browsers = true;
  act(() => {
    browsers = fireEvent.keyDown(document, { key: "k", metaKey: true, repeat });
  });
  return browsers;
};

describe("the jump-to chord", () => {
  it("opens jump-to, and closes it when pressed again", () => {
    const { result } = renderHook(() => useJumping(true));

    pressTheChord();
    expect(result.current.open).toBe(true);
    pressTheChord();
    expect(result.current.open).toBe(false);
  });

  it("leaves jump-to open while the chord is held", () => {
    const { result } = renderHook(() => useJumping(true));

    pressTheChord();
    pressTheChord(true);

    expect(result.current.open).toBe(true);
  });

  it("keeps a held chord from the browser's own search bar", () => {
    renderHook(() => useJumping(true));

    pressTheChord();

    expect(pressTheChord(true)).toBe(false);
  });
});
