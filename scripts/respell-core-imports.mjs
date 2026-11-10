#!/usr/bin/env node
import { respellCoreImports } from "../packages/devtools/src/moves/respell-core-imports.ts";

try {
  const changed = respellCoreImports(process.cwd());
  for (const file of changed) process.stdout.write(`${file}\n`);
  process.stdout.write(`respell-core-imports: rewrote ${String(changed.length)} files\n`);
} catch (cause) {
  process.stderr.write(
    `respell-core-imports: ${cause instanceof Error ? cause.message : String(cause)}\n`,
  );
  process.exit(1);
}
