import { readFileSync } from "node:fs";
import path from "node:path";

import { flagValues } from "../flags.ts";
import { repositoryRoot } from "../paths.ts";
import { renameOver } from "./index.ts";
import type { RenameMode } from "./index.ts";
import { parseRenameMap } from "./map.ts";
import { formatReport } from "./report.ts";

const USAGE =
  "usage: rename --map <name in packages/devtools/renames, or a .json file> [--root <directory>] [--mode dry-run|apply]";

const MODES: readonly RenameMode[] = ["dry-run", "apply"];

/** A bare name is a committed map, so a branch replays the one the sweep merged. */
const mapFile = (name: string): string =>
  name.endsWith(".json")
    ? path.resolve(name)
    : path.join(repositoryRoot, "packages/devtools/renames", `${name}.json`);

const usage = (): number => {
  process.stderr.write(`${USAGE}\n`);
  return 2;
};

/** 0 once the report is written, 2 for arguments it cannot read. */
const replay = (argv: readonly string[]): number => {
  const flags = flagValues(argv);
  if (flags === undefined) return usage();
  const name = flags.get("map");
  const mode = MODES.find((one) => one === (flags.get("mode") ?? "dry-run"));
  if (name === undefined || mode === undefined) return usage();
  const map = parseRenameMap(readFileSync(mapFile(name), "utf8"));
  const root = path.resolve(flags.get("root") ?? repositoryRoot);
  process.stdout.write(formatReport(map, renameOver(root, map, mode), mode));
  return 0;
};

process.exitCode = replay(process.argv.slice(2));
