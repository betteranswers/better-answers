import path from "node:path";

import { byCodeUnit } from "@better-answers/schema/code-unit";

export const LOOSE_FILE_LIMIT = 15;

export const WHERE_THE_CAPS_LIVE = "packages/devtools/src/scans/loose-files.ts";

export type Cap = {
  readonly folder: string;
  readonly cap: number;
  readonly reason: string;
};

export const CAPS: readonly Cap[] = [
  {
    folder: "apps/web/src/shared/ui",
    cap: 29,
    reason: "the shadcn CLI writes its components there, as apps/web/components.json sets",
  },
  {
    folder: "apps/worker/src/better_answers_worker/redaction",
    cap: 16,
    reason: "the image's early COPY and the CI cache keys name it",
  },
];

const READ_TREES = /^(?:apps\/[^/]+\/(?:src|test|tests|e2e)|packages\/[^/]+\/(?:src|test))\//u;

const NEVER_COUNTED: ReadonlySet<string> = new Set(["fixtures", "__snapshots__"]);

export const isCounted = (file: string): boolean =>
  READ_TREES.test(file) &&
  !path.posix
    .dirname(file)
    .split("/")
    .some((segment) => NEVER_COUNTED.has(segment));

export const countsIn = (files: readonly string[]): ReadonlyMap<string, number> => {
  const counts = new Map<string, number>();
  for (const file of files.filter(isCounted)) {
    const folder = path.posix.dirname(file);
    counts.set(folder, (counts.get(folder) ?? 0) + 1);
  }
  return counts;
};

const overReport = (folder: string, count: number, cap: Cap | undefined): string => {
  const held = `${folder} has ${String(count)} files directly inside it.`;
  if (cap === undefined) {
    return `${held} The limit is ${String(LOOSE_FILE_LIMIT)}. Move files into subfolders by capability.`;
  }
  return `${held} Its cap in ${WHERE_THE_CAPS_LIVE} is ${String(cap.cap)}. The folder cannot be split, because ${cap.reason}. Raise the cap to ${String(count)} in the same change.`;
};

const staleReport = ({ folder, cap }: Cap, count: number): string => {
  const entry = `its cap of ${String(cap)} in ${WHERE_THE_CAPS_LIVE}`;
  if (count === 0)
    return `${folder} has no tracked files, so ${entry} is not needed. Delete the entry.`;
  if (count <= LOOSE_FILE_LIMIT) {
    return `${folder} has ${String(count)} files, within the limit of ${String(LOOSE_FILE_LIMIT)}, so ${entry} is not needed. Delete the entry.`;
  }
  return `${folder} has ${String(count)} files, fewer than ${entry}. Lower the cap to ${String(count)}.`;
};

export const findingsFor = (
  counts: ReadonlyMap<string, number>,
  caps: readonly Cap[] = CAPS,
): readonly string[] => {
  const capOf = new Map(caps.map((one) => [one.folder, one]));
  const over = [...counts]
    .filter(([folder, count]) => count > (capOf.get(folder)?.cap ?? LOOSE_FILE_LIMIT))
    .toSorted(([one], [other]) => byCodeUnit(one, other))
    .map(([folder, count]) => overReport(folder, count, capOf.get(folder)));
  const stale = caps
    .filter(({ folder, cap }) => (counts.get(folder) ?? 0) < cap)
    .toSorted((one, other) => byCodeUnit(one.folder, other.folder))
    .map((one) => staleReport(one, counts.get(one.folder) ?? 0));
  return [...over, ...stale];
};
