import { existsSync, globSync } from "node:fs";
import path from "node:path";

import { Project, ts } from "ts-morph";
import type { ResolutionHostFactory } from "ts-morph";

const TYPESCRIPT = "**/*.{ts,tsx,mts,cts}";

const prunes = (entry: string): boolean => {
  const name = path.basename(entry);
  return name === "node_modules" || name.startsWith(".");
};

const optionsIn = (config: string): ts.CompilerOptions => {
  const read = ts.readConfigFile(config, (file) => ts.sys.readFile(file));
  return ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(config)).options;
};

/** The options of the tsconfig nearest a directory, looking no higher than the root. */
const nearestOptions = (
  root: string,
  fallback: ts.CompilerOptions,
): ((directory: string) => ts.CompilerOptions) => {
  const known = new Map<string, ts.CompilerOptions>();
  const optionsFor = (directory: string): ts.CompilerOptions => {
    const seen = known.get(directory);
    if (seen !== undefined) return seen;
    const config = path.join(directory, "tsconfig.json");
    const above = path.dirname(directory);
    const options = existsSync(config)
      ? optionsIn(config)
      : directory === root || above === directory
        ? fallback
        : optionsFor(above);
    known.set(directory, options);
    return options;
  };
  return optionsFor;
};

/** An installed package can ship a tsconfig of its own, which says nothing about this tree. */
const isInstalled = (root: string, file: string): boolean => {
  const relative = path.relative(root, file);
  return relative.startsWith("..") || relative.split(path.sep).includes("node_modules");
};

/** Each file resolves its imports under its own workspace's tsconfig, as the web app's `@/` needs. */
const byWorkspace =
  (root: string, fallback: ts.CompilerOptions): ResolutionHostFactory =>
  (host) => {
    const optionsFor = nearestOptions(root, fallback);
    const caches = new Map<ts.CompilerOptions, ts.ModuleResolutionCache>();
    const cacheFor = (options: ts.CompilerOptions): ts.ModuleResolutionCache => {
      const cache =
        caches.get(options) ?? ts.createModuleResolutionCache(root, (file) => file, options);
      caches.set(options, cache);
      return cache;
    };
    return {
      resolveModuleNames: (names, containingFile, _reused, _redirected, _options, containing) => {
        const options = isInstalled(root, containingFile)
          ? fallback
          : optionsFor(path.dirname(containingFile));
        return names.map(
          (name) =>
            ts.resolveModuleName(
              name,
              containingFile,
              options,
              host,
              cacheFor(options),
              undefined,
              containing?.impliedNodeFormat,
            ).resolvedModule,
        );
      },
    };
  };

/** Every TypeScript file in the tree, so a reference in any package is renamed with its symbol. */
export const projectAt = (root: string): Project => {
  const rootConfig = ["tsconfig.json", "tsconfig.base.json"]
    .map((name) => path.join(root, name))
    .find((file) => existsSync(file));
  const fallback = rootConfig === undefined ? {} : optionsIn(rootConfig);
  const project = new Project({
    compilerOptions: fallback,
    skipAddingFilesFromTsConfig: true,
    resolutionHost: byWorkspace(root, fallback),
  });
  for (const file of globSync(TYPESCRIPT, { cwd: root, exclude: prunes })) {
    project.addSourceFileAtPath(path.join(root, file));
  }
  return project;
};
