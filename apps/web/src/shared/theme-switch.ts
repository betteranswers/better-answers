import type { Theme } from "@better-answers/schema/theme";

export {
  DEVICE_DARK,
  FIRST_PAINT,
  THEME_KEPT_UNDER,
  themeShown,
  type Theme,
} from "@better-answers/schema/theme";

export const showTheme = (theme: Theme): void => {
  document.documentElement.dataset["theme"] = theme;
};
