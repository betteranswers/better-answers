import path from "node:path";

const LIBRARY_NAMED = /@?better-(?:auth|fetch)\b[\w./-]*|[\w./-]*\bauth-client(?:\.ts)?\b/u;

const EXPORTED =
  /^export (?:declare )?(?:(?:const|function|class|type|interface) (\w+)|(?:type )?\{ (\w+))/u;

const DIAGNOSTIC = /^(?<file>.+?)\((?<line>\d+),\d+\): error (?<code>TS\d+): (?<said>.*)$/u;

export const TSC = { package: "typescript", path: ["bin", "tsc"] } as const;

export const SCAN_EXECUTABLE = {
  package: "@better-answers/devtools",
  path: ["..", "..", "scripts", "auth-seam-scan.mjs"],
} as const;

export type Seam = { readonly config: string; readonly file: string };

export const declarationConfig = (root: string, seam: Seam, emitted: string) => {
  const config = path.resolve(root, seam.config);
  return {
    extends: config,
    compilerOptions: {
      noEmit: false,
      declaration: true,
      emitDeclarationOnly: true,
      types: [],
      rootDir: path.dirname(config),
      outDir: emitted,
    },
    files: [path.resolve(root, seam.file)],
    include: [],
  };
};

export const declarationPath = (root: string, seam: Seam, emitted: string): string =>
  path.join(
    emitted,
    path
      .relative(path.dirname(path.resolve(root, seam.config)), path.resolve(root, seam.file))
      .replace(/\.tsx?$/u, ".d.ts"),
  );

export const refusalsOf = (root: string, seam: Seam, tscOutput: string): readonly string[] =>
  tscOutput.split("\n").flatMap((text) => {
    const said = DIAGNOSTIC.exec(text)?.groups;
    if (said?.["file"] === undefined) return [];
    if (path.resolve(root, said["file"]) !== path.resolve(root, seam.file)) return [];
    return [
      `${seam.file}:${String(said["line"])}: TypeScript refused the file (${String(said["code"])}: ${String(said["said"])}), so its declarations cannot be read. Where an export's inferred type cannot be named, write the type out in the platform's own types.`,
    ];
  });

const exportOn = (text: string): string | undefined => {
  const declared = EXPORTED.exec(text);
  return declared?.[1] ?? declared?.[2];
};

export const libraryNamed = (seam: Seam, declaration: string): readonly string[] => {
  const leaks = new Map<string, string>();
  let exported = "an export";
  for (const text of declaration.split("\n")) {
    exported = exportOn(text) ?? exported;
    const named = LIBRARY_NAMED.exec(text)?.[0];
    if (named !== undefined && !leaks.has(exported)) leaks.set(exported, named);
  }
  return [...leaks].map(
    ([exportName, named]) =>
      `${seam.file}: the declaration of \`${exportName}\` names \`${named}\`. Map Better Auth's answer to the platform's own type inside this file, and give \`${exportName}\` that type.`,
  );
};
