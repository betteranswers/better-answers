import * as React from "react";

/** A section's coverage: expectation minus what is included (CONTEXT.md "expectation"). The count is the signal; the bar repeats it. */
export interface CoverageBarProps extends React.HTMLAttributes<HTMLDivElement> {
  included?: number;
  expected?: number;
  label?: string;
}
export function CoverageBar(props: CoverageBarProps): JSX.Element;
