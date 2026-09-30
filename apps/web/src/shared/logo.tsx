import LOGO from "@better-answers/design-system/assets/logo.svg?raw";

/** Inline, so it takes the text's colour; hidden, so the name beside it is heard once. */
export function Logo() {
  return (
    <span
      aria-hidden="true"
      className="[&>svg]:block [&>svg]:size-6"
      // The design system's own file, bundled at build time: no reader's input reaches it.
      dangerouslySetInnerHTML={{ __html: LOGO }}
    />
  );
}
