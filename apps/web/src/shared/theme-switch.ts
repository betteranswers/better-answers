/**
 * The one switch, on `<html>` alone: the bridge's aliases resolve at `:root`. No imports, since
 * `vite.config.ts` reads this file.
 */

/** Stored on readers' browsers, so the key keeps its first name. */
export const THEME_KEPT_UNDER = "better-answers.theme";

export type Theme = "light" | "dark";

export const DEVICE_DARK = "(prefers-color-scheme: dark)";

/** A theme kept on this browser wins; anything else, nothing included, leaves it to the device. */
export const themeShown = (kept: string | null, deviceDark: boolean): Theme => {
  if (kept === "light" || kept === "dark") return kept;
  return deviceDark ? "dark" : "light";
};

export const showTheme = (theme: Theme): void => {
  document.documentElement.dataset["theme"] = theme;
};

/** Runs in the head before the first paint, so it repeats `themeShown`'s rule: no module has loaded. */
export const FIRST_PAINT = `(() => {
  let kept = null;
  try { kept = localStorage.getItem(${JSON.stringify(THEME_KEPT_UNDER)}); } catch {}
  const dark = kept === "dark" || (kept !== "light" && matchMedia(${JSON.stringify(DEVICE_DARK)}).matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
})();`;
