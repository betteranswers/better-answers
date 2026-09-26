import { spawnSync } from "node:child_process";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const packageRoot = (name: string): string => path.dirname(require.resolve(`${name}/package.json`));

const strykerRoot = packageRoot("@stryker-mutator/core");
const runnerRoot = packageRoot("@stryker-mutator/vitest-runner");

/** The runner's own vitest, the one its patch under `patches/` is written against. */
const vitestRoot = path.dirname(
  createRequire(path.join(runnerRoot, "package.json")).resolve("vitest/package.json"),
);

export const writtenTree = (root: string, files: Readonly<Record<string, string>>): string => {
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), text);
  }
  return root;
};

export const strykerWorkspace = (root: string, files: Readonly<Record<string, string>>): string => {
  mkdirSync(path.join(root, "node_modules/@stryker-mutator"), { recursive: true });
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "throwaway", private: true, type: "module" }),
  );
  writtenTree(root, files);
  symlinkSync(strykerRoot, path.join(root, "node_modules/@stryker-mutator/core"));
  symlinkSync(runnerRoot, path.join(root, "node_modules/@stryker-mutator/vitest-runner"));
  symlinkSync(vitestRoot, path.join(root, "node_modules/vitest"));
  return root;
};

export const runStryker = (root: string, ...flags: readonly string[]): void => {
  const run = spawnSync(
    process.execPath,
    [path.join(strykerRoot, "bin/stryker.js"), "run", ...flags],
    { cwd: root, encoding: "utf8" },
  );
  if (run.status !== 0) {
    throw new Error(`stryker exited ${String(run.status)}:\n${run.stdout}\n${run.stderr}`);
  }
};
