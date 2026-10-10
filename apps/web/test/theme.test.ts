import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FIRST_PAINT, THEME_KEPT_UNDER, themeShown } from "@/shared/theme-switch.ts";
import { chooseTheme, useThemeChoice, useThemeFollowed } from "@/shared/theme.ts";

import { sourceFiles } from "./source-files.ts";

/** A device whose colour scheme a test sets, and tells the page of as a browser does. */
const aDevice = (dark: boolean) => {
  const listeners = new Set<() => void>();
  const media = {
    matches: dark,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  };
  vi.stubGlobal("matchMedia", () => media);
  return {
    turns: (next: boolean) => {
      media.matches = next;
      for (const listener of listeners) listener();
    },
  };
};

const theme = () => document.documentElement.dataset["theme"];

const firstPaint = () => {
  // oxlint-disable-next-line typescript/no-implied-eval -- the head script is a string by design, run here as the page runs it
  new Function(FIRST_PAINT)();
};

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete document.documentElement.dataset["theme"];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the head script", () => {
  it("paints the kept theme over the device's", () => {
    aDevice(false);
    localStorage.setItem(THEME_KEPT_UNDER, "dark");
    firstPaint();
    expect(theme()).toBe("dark");

    aDevice(true);
    localStorage.setItem(THEME_KEPT_UNDER, "light");
    firstPaint();
    expect(theme()).toBe("light");
  });

  it("follows the device when nothing is kept", () => {
    aDevice(true);
    firstPaint();
    expect(theme()).toBe("dark");

    aDevice(false);
    firstPaint();
    expect(theme()).toBe("light");
  });

  it("follows the device when the store refuses to be read", () => {
    aDevice(true);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("refused", "SecurityError");
    });
    firstPaint();
    expect(theme()).toBe("dark");
  });

  it("decides as the page does for every kept value", () => {
    for (const kept of ["light", "dark", "anything else", null]) {
      for (const deviceDark of [true, false]) {
        aDevice(deviceDark);
        if (kept === null) localStorage.removeItem(THEME_KEPT_UNDER);
        else localStorage.setItem(THEME_KEPT_UNDER, kept);
        firstPaint();
        expect(theme(), `kept ${String(kept)}, device dark ${String(deviceDark)}`).toBe(
          themeShown(kept, deviceDark),
        );
      }
    }
  });
});

describe("choosing a theme", () => {
  it("follows the device until a theme is chosen", () => {
    const device = aDevice(false);
    const { result } = renderHook(() => {
      useThemeFollowed();
      return useThemeChoice();
    });
    expect(result.current).toBe("device");
    expect(theme()).toBe("light");

    act(() => {
      device.turns(true);
    });
    expect(theme()).toBe("dark");

    act(() => {
      chooseTheme("light");
    });
    expect(result.current).toBe("light");
    expect(theme()).toBe("light");
    expect(localStorage.getItem(THEME_KEPT_UNDER)).toBe("light");

    act(() => {
      device.turns(false);
      device.turns(true);
    });
    expect(theme()).toBe("light");
  });

  it("forgets the kept theme when the device is chosen again", () => {
    aDevice(true);
    localStorage.setItem(THEME_KEPT_UNDER, "light");
    const { result } = renderHook(() => {
      useThemeFollowed();
      return useThemeChoice();
    });
    expect(theme()).toBe("light");

    act(() => {
      chooseTheme("device");
    });
    expect(result.current).toBe("device");
    expect(localStorage.getItem(THEME_KEPT_UNDER)).toBeNull();
    expect(theme()).toBe("dark");
  });

  it("takes a theme chosen in another tab", () => {
    aDevice(false);
    const { result } = renderHook(() => {
      useThemeFollowed();
      return useThemeChoice();
    });

    act(() => {
      localStorage.setItem(THEME_KEPT_UNDER, "dark");
      window.dispatchEvent(new StorageEvent("storage", { key: THEME_KEPT_UNDER }));
    });
    expect(result.current).toBe("dark");
    expect(theme()).toBe("dark");
  });
});

const files = sourceFiles(/\.(?:tsx?|css)$/);

const bridge = readFileSync(
  createRequire(import.meta.url).resolve(
    "@better-answers/design-system/tokens/tailwind-bridge.css",
  ),
  "utf8",
);

describe("the one switch", () => {
  it("is written by the switch alone", () => {
    expect(files.length).toBeGreaterThan(0);
    const writers = files
      .filter(({ text }) =>
        /dataset(?:\.theme|\["theme"\])\s*=|setAttribute\(\s*["']data-theme/.test(text),
      )
      .map(({ file }) => file);
    expect(writers).toEqual(["shared/theme-switch.ts"]);
  });

  it("answers to no `.dark` class", () => {
    const darkClass = /(?:^|[\s,(])\.dark\b/m;
    const selecting = (text: string) => darkClass.test(text.replaceAll(/\/\*[\s\S]*?\*\//g, ""));
    expect(files.filter(({ text }) => selecting(text)).map(({ file }) => file)).toEqual([]);
    expect(selecting(bridge), "the bridge honours `.dark`").toBe(false);
  });
});
