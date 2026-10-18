/**
 * The theme's contract: the web keeps it, and the api's pages paint it too. No imports, only
 * syntax Node strips: `vite.config.ts` loads this through Node.
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

export const FIRST_PAINT = `(() => {
  let kept = null;
  try { kept = localStorage.getItem(${JSON.stringify(THEME_KEPT_UNDER)}); } catch {}
  const shown = ${themeShown.toString()};
  document.documentElement.dataset.theme = shown(kept, matchMedia(${JSON.stringify(DEVICE_DARK)}).matches);
})();`;
