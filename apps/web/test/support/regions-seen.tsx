import { Profiler, type ReactNode } from "react";

/** A `Profiler` hears every commit in its tree, even one that only a component deep inside rendered. */
export const regionsSeen = (selector: string) => {
  const seen: (string | undefined)[] = [];
  function Seen(properties: { readonly children: ReactNode }) {
    return (
      <Profiler
        id="regions-seen"
        onRender={() => {
          seen.push(document.querySelector(selector)?.textContent ?? undefined);
        }}
      >
        {properties.children}
      </Profiler>
    );
  }
  return { seen, Seen };
};
