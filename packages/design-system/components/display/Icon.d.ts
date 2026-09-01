import * as React from "react";

/** The only icon primitive. Renders one Phosphor glyph — `@phosphor-icons/react` in an
 *  application, `@phosphor-icons/web` on a static page. Icons never carry meaning
 *  alone: pair with a visible label, or pass `label` for an accessible name ([A11Y1]). */
export interface IconProps extends React.HTMLAttributes<HTMLElement> {
  /** Phosphor name, kebab-case: "magnifying-glass", "check-circle", "sliders-horizontal". */
  name: string;
  /** Square box in px. 16 in the interface, 18–20 in empty states. Default 16. */
  size?: number;
  /** Phosphor weight. Default "regular". "bold" for an active nav item or a heading glyph;
   *  "fill" only inside a solid accent chip. Never "duotone". */
  weight?: "thin" | "light" | "regular" | "bold" | "fill" | "duotone";
  /** Default "currentColor" — an icon never sets its own colour. */
  color?: string;
  /** Accessible name. Supply only when the icon is the sole content of its control. */
  label?: string;
}
export declare function Icon(props: IconProps): JSX.Element;
