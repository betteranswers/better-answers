import React from "react";

/* Phosphor. In an application this is `@phosphor-icons/react`:
     import { MagnifyingGlass } from "@phosphor-icons/react";
     <MagnifyingGlass size={16} weight="regular" />
   In a static page or a card it is the same set delivered as `@phosphor-icons/web`,
   which is what this component renders. The kebab-case `name` is identical across
   both, so a screen built here ports to the app with no glyph changes.

   Load the weights you use, once, before React mounts:
     <link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/regular/style.css">
     <link rel="stylesheet" href="https://unpkg.com/@phosphor-icons/web@2.1.1/src/bold/style.css">
   npm: `@phosphor-icons/react` (app) · `@phosphor-icons/web` (static). */

const CLS = {
  thin: "ph-thin",
  light: "ph-light",
  regular: "ph",
  bold: "ph-bold",
  fill: "ph-fill",
  duotone: "ph-duotone",
};

export function Icon({
  name,
  size = 16,
  weight = "regular",
  color = "currentColor",
  label,
  style,
  ...rest
}) {
  return (
    <i
      className={`${CLS[weight] || CLS.regular} ph-${name}`}
      aria-hidden={label ? undefined : "true"}
      role={label ? "img" : undefined}
      aria-label={label || undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        fontSize: size,
        lineHeight: 1,
        flexShrink: 0,
        color,
        ...style,
      }}
      {...rest}
    />
  );
}
