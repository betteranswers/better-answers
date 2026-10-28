import path from "node:path";

import { byCodeUnit } from "@better-answers/schema/code-unit";

export const LOOSE_FILE_LIMIT = 15;

export const WHERE_THE_CAPS_LIVE = "packages/devtools/src/scans/loose-files.ts";

export type Cap = {
  readonly folder: string;
  readonly cap: number;
  readonly kind: "awaiting" | "pinned";
  readonly reason: string;
};

const AWAITS = "awaits the folder restructure, docs/plans/008-folder-restructure.md";

const awaiting = (folder: string, cap: number): Cap => ({
  folder,
  cap,
  kind: "awaiting",
  reason: AWAITS,
});

const pinned = (folder: string, cap: number, reason: string): Cap => ({
  folder,
  cap,
  kind: "pinned",
  reason,
});

export const CAPS: readonly Cap[] = [
  awaiting("apps/web/e2e", 56),
  awaiting("apps/web/src/app", 18),
  awaiting("apps/web/src/features/auth", 47),
  awaiting("apps/web/src/features/console", 25),
  awaiting("apps/web/src/features/people", 49),
  awaiting("apps/web/src/shared", 43),
  pinned(
    "apps/web/src/shared/ui",
    29,
    "the shadcn CLI's target, named in apps/web/components.json",
  ),
  awaiting("apps/web/test", 111),
  pinned(
    "apps/worker/src/better_answers_worker/redaction",
    16,
    "the image's early COPY and the CI cache keys name it",
  ),
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
  const held = `${folder}: ${String(count)} files directly inside, over`;
  if (cap === undefined) {
    return `${held} the limit of ${String(LOOSE_FILE_LIMIT)}. Move files into a subfolder by capability.`;
  }
  const overCap = `${held} its cap of ${String(cap.cap)} in ${WHERE_THE_CAPS_LIVE}.`;
  if (cap.kind === "pinned") {
    return `${overCap} The folder is pinned (${cap.reason}), so it cannot be split by capability. Raise the cap to ${String(count)} in the same change.`;
  }
  return `${overCap} Move files into a subfolder by capability; never raise the cap.`;
};

const staleReport = ({ folder, cap }: Cap, count: number): string => {
  const stale = `${folder}: its cap of ${String(cap)} in ${WHERE_THE_CAPS_LIVE} is stale, since the folder`;
  if (count === 0) return `${stale} holds no tracked file. Delete the entry.`;
  if (count <= LOOSE_FILE_LIMIT) {
    return `${stale} holds ${String(count)}, within the limit of ${String(LOOSE_FILE_LIMIT)}. Delete the entry.`;
  }
  return `${stale} holds ${String(count)}. Lower the cap to ${String(count)}.`;
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
