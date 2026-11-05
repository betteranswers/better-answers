import { Profiler, type ReactNode } from "react";

/** A `Profiler` reports every commit in its tree, including commits from deeply nested components. */
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
