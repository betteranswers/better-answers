import { readFileSync } from "node:fs";
import path from "node:path";

import { z } from "zod";

const manifest = z.looseObject({ scripts: z.record(z.string(), z.string()).default({}) });

const repositoryRoot = path.resolve(import.meta.dirname, "../../..");

export const rootScripts = (): Readonly<Record<string, string>> =>
  manifest.parse(JSON.parse(readFileSync(path.join(repositoryRoot, "package.json"), "utf8")))
    .scripts;
