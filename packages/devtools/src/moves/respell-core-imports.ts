import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import type {
  ExportAllDeclaration,
  ExportNamedDeclaration,
  ImportDeclaration,
  Program,
} from "oxc-parser";
import { z } from "zod";

import { corePackageOf, importFinding } from "../../lint-rules/rules/import-direction.ts";
import type { CorePackage } from "../../lint-rules/rules/import-direction.ts";
import { parsedSource } from "../parsed-source.ts";
import { trackedFiles } from "../paths.ts";

const CORE_PACKAGE = "packages/core";

const CORE_TEST = /^packages\/core\/test\/.+\.[cm]?tsx?$/u;

const manifestSchema = z.object({ name: z.unknown(), exports: z.unknown() });

const NAMES_A_MODULE: ReadonlySet<string> = new Set([
  "ImportDeclaration",
  "ExportAllDeclaration",
  "ExportNamedDeclaration",
]);

type Statement = Program["body"][number];

type NamesAModule = ImportDeclaration | ExportAllDeclaration | ExportNamedDeclaration;

const namesAModule = (node: Statement): node is NamesAModule => NAMES_A_MODULE.has(node.type);

type Edit = { readonly start: number; readonly end: number; readonly text: string };

const editOf = (pkg: CorePackage, file: string, node: NamesAModule): Edit | undefined => {
  const specifier = node.source;
  if (specifier === null) return undefined;
  const found = importFinding(pkg, file, specifier.value);
  const entry = found?.messageId === "testRelativeFace" ? found.data?.["entry"] : undefined;
  if (entry === undefined) return undefined;
  return {
    start: specifier.start + 1,
    end: specifier.end - 1,
    text: `@better-answers/core/${entry}`,
  };
};

export const respelledSource = (pkg: CorePackage, file: string, source: string): string => {
  const { program } = parsedSource(file, source);
  return program.body
    .filter(namesAModule)
    .flatMap((node) => editOf(pkg, file, node) ?? [])
    .toSorted((one, other) => other.start - one.start)
    .reduce(
      (text, { start, end, text: spelled }) => text.slice(0, start) + spelled + text.slice(end),
      source,
    );
};

export const respellCoreImports = (root: string): readonly string[] => {
  const coreRoot = path.join(root, CORE_PACKAGE);
  const manifest = manifestSchema.parse(
    JSON.parse(readFileSync(path.join(coreRoot, "package.json"), "utf8")),
  );
  const pkg = corePackageOf(coreRoot, manifest);
  if (pkg === null) throw new Error(`${CORE_PACKAGE}/package.json is not the core package`);
  return trackedFiles(root)
    .filter((file) => CORE_TEST.test(file))
    .filter((file) => {
      const absolute = path.join(root, file);
      const before = readFileSync(absolute, "utf8");
      const after = respelledSource(pkg, absolute, before);
      if (after === before) return false;
      writeFileSync(absolute, after);
      return true;
    });
};
