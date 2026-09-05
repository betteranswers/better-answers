import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * The pnpm workspaces, read from `pnpm-workspace.yaml` rather than listed in a test: a
 * second list ages alone, and the entry the first one to list them missed —
 * `packages/design-system` — is exactly the omission that makes a test quietly weaker
 * than it reads.
 *
 * Read with a reader rather than a YAML parser because `apps/api` has no YAML dependency
 * and the shape being read is one list of plain strings — the moment it is not, this
 * throws rather than returning an empty list, because every caller here asserts over what
 * it returns and an empty list asserts nothing.
 *
 * The root is not in that file and is an importer all the same, so a caller that counts it
 * as a project adds it.
 */

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");

const PACKAGES_BLOCK = /^packages:\n((?:[ \t]*-[ \t]+\S+[ \t]*\n)+)/m;

/** Every workspace directory the `packages:` globs reach, relative to the repository root. */
export const workspacePackages = (): readonly string[] => {
  const file = readFileSync(path.join(repositoryRoot, "pnpm-workspace.yaml"), "utf8");
  const block = PACKAGES_BLOCK.exec(file)?.[1];
  if (block === undefined) throw new Error("pnpm-workspace.yaml has no `packages:` list");

  const patterns = block
    .split("\n")
    .map((line) =>
      line
        .replace(/^[ \t]*-[ \t]+/, "")
        .trim()
        .replace(/^["']|["']$/g, ""),
    )
    .filter((entry) => entry.length > 0);

  const expand = (pattern: string): readonly string[] => {
    if (!pattern.endsWith("/*")) return [pattern];
    const parent = pattern.slice(0, -2);
    return readdirSync(path.join(repositoryRoot, parent), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${parent}/${entry.name}`);
  };

  return patterns
    .flatMap(expand)
    .filter((project) => existsSync(path.join(repositoryRoot, project, "package.json")))
    .sort();
};
