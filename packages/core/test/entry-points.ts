import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PACKAGE_JSON = path.resolve(import.meta.dirname, "../package.json");

export const loadEveryEntryPoint = async (): Promise<void> => {
  const manifest: { exports: Readonly<Record<string, string>> } = JSON.parse(
    readFileSync(PACKAGE_JSON, "utf8"),
  );
  for (const relative of Object.values(manifest.exports)) {
    const file = pathToFileURL(path.resolve(path.dirname(PACKAGE_JSON), relative)).href;
    await import(/* @vite-ignore */ file);
  }
};
