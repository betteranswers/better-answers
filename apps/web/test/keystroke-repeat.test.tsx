import { cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useKeystroke } from "@/shared/keystrokes.tsx";

afterEach(cleanup);

describe("a single-key keystroke", () => {
  it("acts once while its key is held", () => {
    const act = vi.fn<() => void>();
    renderHook(() => {
      useKeystroke({ key: "o", act: "Open the member in focus" }, act);
    });

    fireEvent.keyDown(document.body, { key: "o" });
    fireEvent.keyDown(document.body, { key: "o", repeat: true });
    fireEvent.keyDown(document.body, { key: "o", repeat: true });

    expect(act).toHaveBeenCalledTimes(1);
  });

  it("keeps a held key from the browser", () => {
    renderHook(() => {
      useKeystroke({ key: "o", act: "Open the member in focus" }, vi.fn<() => void>());
    });

    fireEvent.keyDown(document.body, { key: "o" });

    expect(fireEvent.keyDown(document.body, { key: "o", repeat: true })).toBe(false);
  });
});
