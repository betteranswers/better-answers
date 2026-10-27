import { Fragment } from "react";

import { cn } from "@/shared/lib/utils.ts";

type Part = { readonly from: number; readonly text: string };

const partsOf = (address: string): readonly Part[] => {
  const parts: Part[] = [];
  let from = 0;
  for (const text of address.match(/[^@.]*[@.]|[^@.]+$/gu) ?? []) {
    parts.push({ from, text });
    from += text.length;
  }
  return parts;
};

export function Address(properties: { readonly address: string; readonly className?: string }) {
  return (
    <span className={cn("wrap-anywhere", properties.className)}>
      {partsOf(properties.address).map((part) => (
        <Fragment key={part.from}>
          {part.from === 0 ? null : <wbr />}
          {part.text}
        </Fragment>
      ))}
    </span>
  );
}
