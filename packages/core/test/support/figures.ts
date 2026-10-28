import { appendFile } from "node:fs/promises";

export type Figure = readonly [name: string, value: string];

export const percentile = (values: readonly number[], fraction: number): number => {
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
};

export const alternating = <T>(length: number, even: T, odd: T): T[] =>
  Array.from({ length }, (_unused, at) => (at % 2 === 0 ? even : odd));

export const inMs = (value: number): string => `${Math.round(value)} ms`;

export const recordFigures = async (heading: string, figures: readonly Figure[]): Promise<void> => {
  process.stdout.write(
    `\n${heading}: ${figures.map(([name, value]) => `${name} ${value}`).join("; ")}\n`,
  );
  const summary = process.env["GITHUB_STEP_SUMMARY"];
  if (summary === undefined || summary === "") return;
  const rows = figures.map(([name, value]) => `| ${name} | ${value} |`);
  await appendFile(
    summary,
    ["", `#### ${heading}`, "", "| Figure | Value |", "| --- | --- |", ...rows, ""].join("\n"),
  );
};
