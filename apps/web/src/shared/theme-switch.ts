/**
 * The one switch, on `<html>` alone: the bridge's aliases resolve at `:root`. Its rule is the
 * schema package's, which the api's pages paint by too.
 */
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
