import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { BundleTree } from "@better-answers/core/concepts";

/** Every file at any depth, as UTF-8, keyed by its path under `directory` with `/` separators. */
export const readTreeUnder = async (directory: string): Promise<BundleTree> => {
  const entries = await readdir(directory, { recursive: true, withFileTypes: true });
  const tree = new Map<string, string>();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const file = path.join(entry.parentPath, entry.name);
    tree.set(
      path.relative(directory, file).split(path.sep).join("/"),
      await readFile(file, "utf8"),
    );
  }
  return tree;
};
