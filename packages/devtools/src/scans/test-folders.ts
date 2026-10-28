import path from "node:path";

import { byCodeUnit } from "@better-answers/schema/code-unit";

export const WHERE_THE_PINS_LIVE = "packages/devtools/src/scans/test-folders.ts";

export const HELPER_FOLDERS: ReadonlySet<string> = new Set([
  "support",
  "fixtures",
  "__snapshots__",
]);

export const GATES_FOLDER = "gates";

export type Pin = {
  readonly folder: string;
  readonly kind: "run" | "mirror" | "split";
  readonly reason: string;
};

export type Tree = {
  readonly tests: string;
  readonly source: string;
  readonly strip?: string;
};

export const PINS: readonly Pin[] = [
  { folder: "apps/api/tests/deploy", kind: "mirror", reason: "deploy" },
  {
    folder: "apps/api/tests/images",
    kind: "run",
    reason: "the images script and the full-images job select it; check excludes it",
  },
  { folder: "apps/api/tests/trpc/members", kind: "split", reason: "apps/api/src/trpc/members.ts" },
  {
    folder: "packages/core/test/readings",
    kind: "run",
    reason: "vitest.readings.config.ts selects it",
  },
  { folder: "packages/devtools/test/ci", kind: "mirror", reason: ".github/workflows" },
  {
    folder: "packages/devtools/test/lint-rules",
    kind: "mirror",
    reason: "packages/devtools/lint-rules",
  },
  {
    folder: "packages/schema/test/migrations",
    kind: "mirror",
    reason: "packages/schema/migrations",
  },
];

export const CORE_TESTS = "packages/core/test";

export const TREES: readonly Tree[] = [
  { tests: CORE_TESTS, source: "packages/core/src" },
  { tests: "packages/schema/test", source: "packages/schema/src" },
  { tests: "packages/devtools/test", source: "packages/devtools/src" },
  { tests: "apps/api/tests", source: "apps/api/src" },
  { tests: "apps/web/test", source: "apps/web/src", strip: "features/" },
  { tests: "apps/web/e2e", source: "apps/web/src", strip: "features/" },
  { tests: "apps/worker/tests", source: "apps/worker/src/better_answers_worker" },
];

export type Report = {
  readonly read: number;
  readonly findings: readonly string[];
};

const holds = (folder: string, file: string): boolean =>
  file === folder || file.startsWith(`${folder}/`);

const foldersUnder = (files: readonly string[], root: string): ReadonlySet<string> => {
  const folders = new Set<string>();
  for (const file of files.filter((one) => one.startsWith(`${root}/`))) {
    let folder = path.posix.dirname(path.posix.relative(root, file));
    while (folder !== ".") {
      folders.add(folder);
      folder = path.posix.dirname(folder);
    }
  }
  return folders;
};

const sourceFoldersOf = (
  files: readonly string[],
  { source, strip }: Tree,
): ReadonlySet<string> => {
  const folders = [...foldersUnder(files, source)];
  if (strip === undefined) return new Set(folders);
  return new Set(
    folders
      .filter((folder) => `${folder}/` !== strip)
      .map((folder) => (folder.startsWith(strip) ? folder.slice(strip.length) : folder)),
  );
};

export const isNamedKind = (
  tests: string,
  folder: string,
  pins: readonly Pin[] = PINS,
): boolean => {
  const segments = folder.split("/");
  return (
    segments.some((segment) => HELPER_FOLDERS.has(segment)) ||
    segments[0] === GATES_FOLDER ||
    pins.some((pin) => holds(pin.folder, `${tests}/${folder}`))
  );
};

const strayReport = (folder: string): string =>
  `${folder}: mirrors no source folder and is not a kind folder. Move its files to the folder of the entry they drive, or add a row to PINS in ${WHERE_THE_PINS_LIVE} with the kind and the reason.`;

const staleReport = (pin: Pin, files: readonly string[]): string | undefined => {
  if (!files.some((file) => holds(pin.folder, file))) {
    return `${pin.folder}: its row in ${WHERE_THE_PINS_LIVE} is stale, since the folder holds no tracked file. Delete the row.`;
  }
  if (pin.kind !== "run" && !files.some((file) => holds(pin.reason, file))) {
    return `${pin.folder}: its row names ${pin.reason}, which holds no tracked file. Point the row at the tree it mirrors, or move the tests into their mirror folder and delete the row.`;
  }
  return undefined;
};

export const reportFor = (
  files: readonly string[],
  pins: readonly Pin[] = PINS,
  trees: readonly Tree[] = TREES,
): Report => {
  const read = trees.map((tree) => ({
    tree,
    folders: foldersUnder(files, tree.tests),
    sources: sourceFoldersOf(files, tree),
  }));
  const strays = read
    .flatMap(({ tree, folders, sources }) =>
      [...folders]
        .filter((folder) => !sources.has(folder) && !isNamedKind(tree.tests, folder, pins))
        .map((folder) => `${tree.tests}/${folder}`),
    )
    .toSorted(byCodeUnit)
    .map(strayReport);
  const stale = pins
    .toSorted((one, other) => byCodeUnit(one.folder, other.folder))
    .flatMap((pin) => staleReport(pin, files) ?? []);
  return {
    read: read.reduce((total, { folders }) => total + folders.size, 0),
    findings: [...strays, ...stale],
  };
};
