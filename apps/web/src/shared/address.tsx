import { Fragment } from "react";

import { cn } from "@/shared/lib/utils.ts";

type Part = { readonly from: number; readonly text: string };

/** Each part ends at an `@` or a `.`, the places an address may break without splitting a word. */
const partsOf = (address: string): readonly Part[] => {
  const parts: Part[] = [];
  let from = 0;
  for (const text of address.match(/[^@.]*[@.]|[^@.]+$/g) ?? []) {
    parts.push({ from, text });
    from += text.length;
  }
  return parts;
};

/**
 * `<wbr>` adds no character, so a reader and a spec read the address itself. A part too long for
 * its line still breaks.
 */
export function Address(properties: { readonly address: string; readonly className?: string }) {
  return (
    <span className={cn("wrap-break-word", properties.className)}>
      {partsOf(properties.address).map((part) => (
        <Fragment key={part.from}>
          {part.from === 0 ? null : <wbr />}
          {part.text}
        </Fragment>
      ))}
    </span>
  );
}
