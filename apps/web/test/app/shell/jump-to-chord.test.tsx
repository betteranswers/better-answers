import { act, cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useJumping } from "@/app/shell/jump-to.tsx";

afterEach(cleanup);

type Modifier = { readonly metaKey: true } | { readonly ctrlKey: true };

const pressChord = (modifier: Modifier, repeat = false): boolean => {
  let notPrevented = true;
  act(() => {
    notPrevented = fireEvent.keyDown(document, { key: "k", ...modifier, repeat });
  });
  return notPrevented;
};

describe.each<[string, Modifier]>([
  ["⌘K", { metaKey: true }],
  ["Ctrl K", { ctrlKey: true }],
])("the jump-to chord, %s", (_chord, modifier) => {
  it("opens jump-to, and closes it when pressed again", () => {
    const { result } = renderHook(() => useJumping(true));

    pressChord(modifier);
    expect(result.current.open).toBe(true);
    pressChord(modifier);
    expect(result.current.open).toBe(false);
  });

  it("leaves jump-to open while the chord is held", () => {
    const { result } = renderHook(() => useJumping(true));

    pressChord(modifier);
    pressChord(modifier, true);

    expect(result.current.open).toBe(true);
  });

  it("blocks the browser's default action for a held chord", () => {
    renderHook(() => useJumping(true));

    pressChord(modifier);

    expect(pressChord(modifier, true)).toBe(false);
  });
});
