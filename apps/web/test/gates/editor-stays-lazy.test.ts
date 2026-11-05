import path from "node:path";

import { describe, expect, it } from "vitest";

import { sourceFiles } from "@test/source-files.ts";

const ENTRY = "main.tsx";

const EDITING = "features/knowledge/editing";

const EDITOR_LIBRARY = /^(?:@tiptap\/|@codemirror\/|@lezer\/|codemirror$|prosemirror-)/u;

const STATIC_IMPORT =
  /^[ \t]*(?:import|export)\s+(?!type\b)(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/gmu;

const files = new Map(sourceFiles(/\.tsx?$/).map(({ file, text }) => [file, text]));

const specifiersOf = (text: string): readonly string[] =>
  [...text.matchAll(STATIC_IMPORT)].flatMap((found) => (found[1] === undefined ? [] : [found[1]]));

const placeOf = (from: string, specifier: string): string | undefined => {
  if (specifier.startsWith("@/")) return specifier.slice(2);
  return specifier.startsWith(".") ? path.join(path.dirname(from), specifier) : undefined;
};

const reachedStatically = (): {
  readonly reached: ReadonlySet<string>;
  readonly libraries: readonly string[];
} => {
  const reached = new Set<string>();
  const libraries: string[] = [];
  const pending = [ENTRY];
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    const text = files.get(file);
    if (text === undefined || reached.has(file)) continue;
    reached.add(file);
    for (const specifier of specifiersOf(text)) {
      if (EDITOR_LIBRARY.test(specifier)) libraries.push(`${file} imports ${specifier}`);
      const place = placeOf(file, specifier);
      if (place !== undefined) pending.push(place);
    }
  }
  return { reached, libraries };
};

const importsALibrary = (name: string): boolean =>
  specifiersOf(files.get(`${EDITING}/${name}`) ?? "").some((each) => EDITOR_LIBRARY.test(each));

describe("the concept editor's libraries", () => {
  it("stay out of the entry's static imports", () => {
    const { reached, libraries } = reachedStatically();

    expect(reached, "the walk did not reach the concept page's launcher").toContain(
      `${EDITING}/concept-actions.tsx`,
    );
    expect(reached, "the editing session is imported statically").not.toContain(
      `${EDITING}/concept-session.tsx`,
    );
    expect(libraries).toEqual([]);
  });

  it("are imported by the editor's own files", () => {
    const own = ["visual-body.tsx", "source-body.tsx", "markdown-round-trip.ts"].map(
      importsALibrary,
    );

    expect(own).toEqual([true, true, true]);
  });
});
