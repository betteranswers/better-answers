import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import { workspaceRoot } from "../support/roots/roots.ts";

const manifestShape = z.object({ exports: z.record(z.string(), z.string()) });

const PACKAGE_JSON = path.resolve(workspaceRoot, "package.json");

export const loadEveryEntryPoint = async (): Promise<void> => {
  const manifest = manifestShape.parse(JSON.parse(readFileSync(PACKAGE_JSON, "utf8")));
  for (const relative of Object.values(manifest.exports)) {
    const file = pathToFileURL(path.resolve(path.dirname(PACKAGE_JSON), relative)).href;
    await import(/* @vite-ignore */ file);
  }
};
