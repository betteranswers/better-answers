import LOGO from "@better-answers/design-system/assets/logo.svg?raw";

export function Logo() {
  return (
    <span
      aria-hidden="true"
      className="[&>svg]:block [&>svg]:size-6"
      dangerouslySetInnerHTML={{ __html: LOGO }}
    />
  );
}
