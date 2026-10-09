import { appendFile } from "node:fs/promises";

export type Figure = readonly [name: string, value: string];

export const percentile = (values: readonly number[], fraction: number): number => {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
};

export const inMs = (value: number): string => `${Math.round(value)} ms`;

/** Prints the figures under `heading`, and adds them as a table to CI's step summary when it runs. */
export const recordFigures = async (heading: string, figures: readonly Figure[]): Promise<void> => {
  process.stdout.write(
    `\n${heading}: ${figures.map(([name, value]) => `${name} ${value}`).join("; ")}\n`,
  );
  const summary = process.env["GITHUB_STEP_SUMMARY"];
  if (summary === undefined) return;
  const rows = figures.map(([name, value]) => `| ${name} | ${value} |`);
  await appendFile(
    summary,
    ["", `#### ${heading}`, "", "| Figure | Value |", "| --- | --- |", ...rows, ""].join("\n"),
  );
};
