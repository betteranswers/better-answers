#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  declarationConfig,
  declarationPath,
  libraryNamed,
  TSC,
  refusalsOf,
} from "../packages/devtools/src/auth-seam-scan.ts";
import { executableOf } from "../packages/devtools/src/throwaway-tree.ts";

/** The tree it is run in, not the tree it lives in, so a suite can spawn it over a throwaway. */
const root = process.cwd();
const named = process.argv.slice(2);

if (named.length !== 2) {
  process.stderr.write("auth-seam-scan: name the workspace's tsconfig and the seam file\n");
  process.exit(2);
}

const [config, file] = named;
const seam = { config, file };

const scanIn = (scratch) => {
  const emitted = path.join(scratch, "emitted");
  const scanConfig = path.join(scratch, "tsconfig.json");
  writeFileSync(scanConfig, JSON.stringify(declarationConfig(root, seam, emitted)));

  const tsc = spawnSync(executableOf(TSC), ["-p", scanConfig, "--pretty", "false"], {
    cwd: root,
    encoding: "utf8",
  });
  if (tsc.error !== undefined) {
    process.stderr.write(`auth-seam-scan: tsc did not run: ${String(tsc.error)}\n`);
    return 2;
  }

  const written = declarationPath(root, seam, emitted);
  const found = [
    ...refusalsOf(root, seam, tsc.stdout),
    ...(existsSync(written) ? libraryNamed(seam, readFileSync(written, "utf8")) : []),
  ];
  for (const one of found) process.stdout.write(`${one}\n`);
  if (found.length > 0) return 1;

  // No declaration and no reason is a gate that read nothing, never a seam that leaks nothing.
  if (!existsSync(written)) {
    process.stderr.write(`auth-seam-scan: tsc wrote no declaration for ${file}\n${tsc.stdout}`);
    return 2;
  }

  process.stdout.write(`${file}: its declarations name no Better Auth type\n`);
  return 0;
};

const scratch = mkdtempSync(path.join(tmpdir(), "auth-seam-scan-"));
let exitCode;
try {
  exitCode = scanIn(scratch);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
process.exit(exitCode);
