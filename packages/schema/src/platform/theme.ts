/**
 * Theme rules for the web app and the api's pages. No imports, and only TypeScript syntax Node can
 * strip, because Node loads this for `vite.config.ts`.
 */

/** Readers' browsers already store this key, so it must not be renamed. */
export const THEME_KEPT_UNDER = "better-answers.theme";

export type Theme = "light" | "dark";

export const DEVICE_DARK = "(prefers-color-scheme: dark)";

/**
 * A theme stored in this browser wins. Any other stored value, or none, falls back to the device
 * setting.
 */
export const themeShown = (kept: string | null, deviceDark: boolean): Theme => {
  if (kept === "light" || kept === "dark") return kept;
  return deviceDark ? "dark" : "light";
};

export const FIRST_PAINT = `(() => {
  let kept = null;
  try { kept = localStorage.getItem(${JSON.stringify(THEME_KEPT_UNDER)}); } catch {}
  const shown = ${themeShown.toString()};
  document.documentElement.dataset.theme = shown(kept, matchMedia(${JSON.stringify(DEVICE_DARK)}).matches);
})();`;
