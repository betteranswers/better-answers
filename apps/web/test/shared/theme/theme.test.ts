import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FIRST_PAINT, THEME_KEPT_UNDER, themeShown } from "@/shared/theme/theme-switch.ts";
import type * as ThemeStore from "@/shared/theme/theme.ts";
import { sourceFiles } from "@test/source-files.ts";

const stubDeviceScheme = (dark: boolean) => {
  const listeners = new Set<() => void>();
  const media = {
    matches: dark,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  };
  vi.stubGlobal("matchMedia", () => media);
  return {
    setDark: (next: boolean) => {
      media.matches = next;
      for (const listener of listeners) listener();
    },
  };
};

const theme = () => document.documentElement.dataset["theme"];

const storeTheme = (stored: string | null) => {
  if (stored === null) localStorage.removeItem(THEME_KEPT_UNDER);
  else localStorage.setItem(THEME_KEPT_UNDER, stored);
};

const STORED_AND_DEVICE_CASES = ["light", "dark", "anything else", null].flatMap((stored) =>
  [true, false].map((deviceDark) => ({ stored, deviceDark })),
);

const runHeadScript = () => {
  // oxlint-disable-next-line typescript/no-implied-eval, typescript/no-unsafe-call -- the head script is a string by design, run as the page runs it; lib types `new Function` as the bare Function
  new Function(FIRST_PAINT)();
};

let store: typeof ThemeStore;

beforeEach(async () => {
  vi.resetModules();
  store = await import("@/shared/theme/theme.ts");
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete document.documentElement.dataset["theme"];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the head script", () => {
  it("applies the stored theme over the device's", () => {
    stubDeviceScheme(false);
    localStorage.setItem(THEME_KEPT_UNDER, "dark");
    runHeadScript();
    expect(theme()).toBe("dark");

    stubDeviceScheme(true);
    localStorage.setItem(THEME_KEPT_UNDER, "light");
    runHeadScript();
    expect(theme()).toBe("light");
  });

  it("follows the device when no theme is stored", () => {
    stubDeviceScheme(true);
    runHeadScript();
    expect(theme()).toBe("dark");

    stubDeviceScheme(false);
    runHeadScript();
    expect(theme()).toBe("light");
  });

  it("follows the device when storage cannot be read", () => {
    stubDeviceScheme(true);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("refused", "SecurityError");
    });
    runHeadScript();
    expect(theme()).toBe("dark");
  });

  it.each(STORED_AND_DEVICE_CASES)(
    "matches the app with stored $stored, dark device $deviceDark",
    ({ stored, deviceDark }) => {
      stubDeviceScheme(deviceDark);
      storeTheme(stored);
      runHeadScript();
      expect(theme()).toBe(themeShown(stored, deviceDark));
    },
  );
});

describe("the theme storage key", () => {
  it("keeps the name existing browsers already use", () => {
    expect(THEME_KEPT_UNDER).toBe("better-answers.theme");
  });
});

describe("choosing a theme", () => {
  it("follows the device until a theme is chosen", () => {
    const device = stubDeviceScheme(false);
    const { result } = renderHook(() => {
      store.useThemeFollowed();
      return store.useThemeChoice();
    });
    expect(result.current).toBe("device");
    expect(theme()).toBe("light");

    act(() => {
      device.setDark(true);
    });
    expect(theme()).toBe("dark");

    act(() => {
      store.chooseTheme("light");
    });
    expect(result.current).toBe("light");
    expect(theme()).toBe("light");
    expect(localStorage.getItem(THEME_KEPT_UNDER)).toBe("light");

    act(() => {
      device.setDark(false);
      device.setDark(true);
    });
    expect(theme()).toBe("light");
  });

  it("clears the stored theme when the device is chosen", () => {
    stubDeviceScheme(true);
    localStorage.setItem(THEME_KEPT_UNDER, "light");
    const { result } = renderHook(() => {
      store.useThemeFollowed();
      return store.useThemeChoice();
    });
    expect(theme()).toBe("light");

    act(() => {
      store.chooseTheme("device");
    });
    expect(result.current).toBe("device");
    expect(localStorage.getItem(THEME_KEPT_UNDER)).toBeNull();
    expect(theme()).toBe("dark");
  });

  it("applies a chosen theme even when storage fails", () => {
    stubDeviceScheme(false);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    const { result } = renderHook(() => {
      store.useThemeFollowed();
      return store.useThemeChoice();
    });

    act(() => {
      store.chooseTheme("dark");
    });
    expect(result.current).toBe("dark");
    expect(theme()).toBe("dark");
  });

  it("applies a theme chosen in another tab", () => {
    stubDeviceScheme(false);
    const { result } = renderHook(() => {
      store.useThemeFollowed();
      return store.useThemeChoice();
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

describe("the theme switch module", () => {
  it("is the only code that sets data-theme", () => {
    expect(files.length).toBeGreaterThan(0);
    const writers = files
      .filter(({ text }) =>
        /dataset(?:\.theme|\["theme"\])\s*=|setAttribute\(\s*["']data-theme/.test(text),
      )
      .map(({ file }) => file);
    expect(writers).toEqual(["shared/theme/theme-switch.ts"]);
  });

  it("is not paired with a `.dark` class", () => {
    const darkClass = /(?:^|[\s,(])\.dark\b/m;
    const selectsDarkClass = (text: string) =>
      darkClass.test(text.replaceAll(/\/\*[\s\S]*?\*\//g, ""));
    expect(files.filter(({ text }) => selectsDarkClass(text)).map(({ file }) => file)).toEqual([]);
    expect(selectsDarkClass(bridge), "the Tailwind bridge selects a `.dark` class").toBe(false);
  });
});
