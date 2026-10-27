import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { repositoryRoot } from "@better-answers/devtools/paths";
import { sweptFolder, writeUnder } from "@better-answers/devtools/throwaway-tree";
import type { Tree } from "@better-answers/devtools/throwaway-tree";

const SCRIPT = path.join(repositoryRoot, "scripts/comment-inventory.mjs");

const SAMPLE = "src/sample.ts";

const SAMPLE_SOURCE = `// eslint-disable-next-line no-console -- the probe prints
console.log(1);

// first line of a block
// second line of a block
export const answer = 42; // trailing note

/**
 * A doc block.
 */
type Shape = { readonly side: number };

// a lone block

export const shape: Shape = { side: 1 };
`;

const VIEW = "src/view.tsx";

const VIEW_SOURCE = `export const View = () => (
  <div>
    {/* a note in markup */}
    <span />
  </div>
);
`;

const LOADER = "src/load.ts";

const LOADER_SOURCE = "export const load = (name: string) => import(/* @vite-ignore */ name);\n";

const HOLDER = "test/sample.test.ts";

const HOLDER_SOURCE = `import { it } from "vitest";

it("keeps the answer", () => {});

it("keeps keeps keeps", () => {});
`;

const MODULE = "src/sample.py";

const MODULE_SOURCE = `"""Module doc."""

import os  # noqa: E501  # the probe imports it for its side effect

# first line of a block
# second line of a block
ANSWER = 42  # trailing note
VALUE = os.environ.get("X")  # type: ignore[x]


# the probe's entry
@decorated
def probe() -> int:
    """Function doc here."""

    return ANSWER


class Shape:
    """A class doc."""
`;

const trees: string[] = [];

afterAll(() => {
  for (const tree of trees) rmSync(tree, { recursive: true, force: true });
});

const treeOf = (files: Tree): string => {
  const root = sweptFolder();
  trees.push(root);
  for (const [file, source] of Object.entries(files)) writeUnder(root, file, source);
  return root;
};

const run = (root: string, ...argv: readonly string[]) =>
  spawnSync(process.execPath, [SCRIPT, ...argv], { cwd: root, encoding: "utf8" });

const read = (root: string, file: string): string => readFileSync(path.join(root, file), "utf8");

const inventoryOf = (root: string): string => {
  const ran = run(root, "inventory", "src");
  expect(ran.stderr).toBe("");
  expect(ran.status).toBe(0);
  return ran.stdout;
};

type Classing = { readonly class: string; readonly unit: string; readonly holder?: string };

const classified = (tsv: string, choices: Readonly<Record<string, Classing>>): string =>
  tsv
    .split("\n")
    .map((line) => {
      const fields = line.split("\t");
      const at = `${fields[0] ?? ""}:${fields[1] ?? ""}`;
      const choice = choices[`${at}:${fields[3] ?? ""}`] ?? choices[at];
      if (choice === undefined) return line;
      return [...fields.slice(0, 7), choice.class, choice.holder ?? "", "", choice.unit].join("\t");
    })
    .join("\n");

const unitOne = (classes: Readonly<Record<string, string>>): Record<string, Classing> =>
  Object.fromEntries(Object.entries(classes).map(([at, one]) => [at, { class: one, unit: "1" }]));

const applied = (root: string, tsv: string, unit: string) => {
  writeFileSync(path.join(root, "rows.tsv"), tsv);
  return run(root, "apply", "rows.tsv", "--unit", unit);
};

const located = (tsv: string): readonly string[] =>
  tsv
    .trimEnd()
    .split("\n")
    .slice(1)
    .map((line) => line.split("\t").slice(0, 6).join(" "));

describe("comment-inventory inventory", () => {
  it("emits one row per block, naming its kind and declaration", () => {
    const root = treeOf({ [SAMPLE]: SAMPLE_SOURCE, [VIEW]: VIEW_SOURCE });
    const tsv = inventoryOf(root);
    expect(tsv.split("\n")[0]).toBe(
      "path\tstart\tend\tkind\tattached\twords\ttext\tclass\tholder\tstructure\tunit",
    );
    expect(located(tsv)).toEqual([
      `${SAMPLE} 1 1 directive  6`,
      `${SAMPLE} 4 5 line answer 10`,
      `${SAMPLE} 6 6 trailing  2`,
      `${SAMPLE} 8 10 doc Shape 3`,
      `${SAMPLE} 13 13 line  3`,
      `${VIEW} 3 3 doc  4`,
    ]);
  });

  it("labels `@vite-ignore` a directive, since a bundler reads it", () => {
    const root = treeOf({ [LOADER]: LOADER_SOURCE });
    expect(
      located(inventoryOf(root)),
      "the comment gate exempts no `@vite-ignore`, so the inventory names it itself",
    ).toEqual([`${LOADER} 1 1 directive  1`]);
  });

  it("escapes a tab, a newline and a backslash", () => {
    const root = treeOf({ [SAMPLE]: "/**\n * a\tb \\ c\n */\nexport const one = 1;\n" });
    expect(inventoryOf(root).split("\n")[1]?.split("\t")[6]).toBe("/**\\n * a\\tb \\\\ c\\n */");
  });

  it("skips a generated file", () => {
    const root = treeOf({
      [SAMPLE]: "// Generated, never edited: run it\nexport const one = 1;\n",
    });
    expect(located(inventoryOf(root))).toEqual([]);
  });

  it("emits Python comments and docstrings, naming kind and declaration", () => {
    const root = treeOf({ [MODULE]: MODULE_SOURCE });
    expect(located(inventoryOf(root))).toEqual([
      `${MODULE} 1 1 doc  2`,
      `${MODULE} 3 3 directive  8`,
      `${MODULE} 5 6 line ANSWER 10`,
      `${MODULE} 7 7 trailing  2`,
      `${MODULE} 8 8 directive  0`,
      `${MODULE} 11 11 line probe 3`,
      `${MODULE} 14 14 doc probe 3`,
      `${MODULE} 20 20 doc Shape 3`,
    ]);
  });

  it("skips a generated Python file", () => {
    const root = treeOf({ [MODULE]: "# Generated, never edited: run it\nONE = 1  # a note\n" });
    expect(located(inventoryOf(root))).toEqual([]);
  });

  it("refuses a Python file that does not parse", () => {
    const root = treeOf({ [MODULE]: "def one(:\n    return 1\n" });
    const ran = run(root, "inventory", "src");
    expect(ran.status).toBe(2);
    expect(ran.stderr).toContain(`comment_locator: ${MODULE} could not be read: `);
    expect(ran.stderr).not.toContain("    at ");
  });

  it("reads a Python file behind a byte order mark", () => {
    const root = treeOf({ [MODULE]: "\uFEFF# drop\nONE = 1\n" });
    expect(located(inventoryOf(root))).toEqual([`${MODULE} 1 1 line ONE 1`]);
  });
});

describe("comment-inventory apply", () => {
  it("deletes exactly one unit's rows, leaving kept classes", () => {
    const root = treeOf({ [SAMPLE]: SAMPLE_SOURCE, [VIEW]: VIEW_SOURCE, [HOLDER]: HOLDER_SOURCE });
    const tsv = classified(inventoryOf(root), {
      [`${SAMPLE}:1`]: { class: "suppression", unit: "1" },
      [`${SAMPLE}:4`]: { class: "narration", unit: "1" },
      [`${SAMPLE}:6`]: { class: "held", unit: "1", holder: `${HOLDER} › keeps the answer` },
      [`${SAMPLE}:8`]: { class: "narration", unit: "2" },
      [`${SAMPLE}:13`]: { class: "foreign", unit: "1" },
      [`${VIEW}:3`]: { class: "structure", unit: "1", holder: `${SAMPLE} › type Shape =` },
    });
    const ran = applied(root, tsv, "1");
    expect(ran.stderr).toBe("");
    expect(ran.status).toBe(0);
    expect(ran.stdout).toBe(
      `${SAMPLE}: deleted 2 blocks, lines 4-5, 6\n${VIEW}: deleted 1 block, lines 3\n`,
    );
    expect(read(root, SAMPLE)).toBe(`// eslint-disable-next-line no-console -- the probe prints
console.log(1);

export const answer = 42;

/**
 * A doc block.
 */
type Shape = { readonly side: number };

// a lone block

export const shape: Shape = { side: 1 };
`);
    expect(read(root, VIEW)).toBe(VIEW_SOURCE.replace("    {/* a note in markup */}\n", ""));
  });

  it("reads back an escaped tab, newline and backslash", () => {
    const source = "/**\n * a\tb \\ c\n */\nexport const one = 1;\n";
    const root = treeOf({ [SAMPLE]: source });
    const tsv = classified(inventoryOf(root), { [`${SAMPLE}:1`]: { class: "lost", unit: "1" } });
    expect(applied(root, tsv, "1").status).toBe(0);
    expect(read(root, SAMPLE)).toBe("export const one = 1;\n");
  });

  it("finds a block whose lines moved since the inventory", () => {
    const root = treeOf({ [SAMPLE]: SAMPLE_SOURCE });
    const tsv = classified(inventoryOf(root), {
      [`${SAMPLE}:8`]: { class: "narration", unit: "1" },
    });
    writeFileSync(path.join(root, SAMPLE), `export const added = 0;\n\n${SAMPLE_SOURCE}`);
    expect(applied(root, tsv, "1").status).toBe(0);
    expect(read(root, SAMPLE)).toBe(
      `export const added = 0;\n\n${SAMPLE_SOURCE.replace("/**\n * A doc block.\n */\n", "")}`,
    );
  });

  it("leaves no blank line beside a bracket", () => {
    const source = "export const f = () => {\n  // opening\n\n  return 1;\n\n  // closing\n};\n";
    const root = treeOf({ [SAMPLE]: source });
    const tsv = classified(inventoryOf(root), {
      [`${SAMPLE}:2`]: { class: "narration", unit: "1" },
      [`${SAMPLE}:6`]: { class: "narration", unit: "1" },
    });
    expect(applied(root, tsv, "1").status).toBe(0);
    expect(read(root, SAMPLE)).toBe("export const f = () => {\n  return 1;\n};\n");
  });

  it("leaves no blank line at the file's edge", () => {
    const source = "// top\n\nexport const one = 1;\n\n// bottom\n";
    const root = treeOf({ [SAMPLE]: source });
    const tsv = classified(inventoryOf(root), {
      [`${SAMPLE}:1`]: { class: "narration", unit: "1" },
      [`${SAMPLE}:5`]: { class: "narration", unit: "1" },
    });
    expect(applied(root, tsv, "1").status).toBe(0);
    expect(read(root, SAMPLE)).toBe("export const one = 1;\n");
  });

  it("leaves one blank line where a block sat between two", () => {
    const source = "export const one = 1;\n\n// between\n\nexport const two = 2;\n";
    const root = treeOf({ [SAMPLE]: source });
    const tsv = classified(inventoryOf(root), {
      [`${SAMPLE}:3`]: { class: "narration", unit: "1" },
    });
    expect(applied(root, tsv, "1").status).toBe(0);
    expect(read(root, SAMPLE)).toBe("export const one = 1;\n\nexport const two = 2;\n");
  });

  it("keeps the braces round a JSX comment the unit leaves", () => {
    const source =
      "export const W = () => (\n  <p>\n    {/* keep */\n    /* drop */}\n  </p>\n);\n";
    const root = treeOf({ [VIEW]: source });
    const tsv = classified(inventoryOf(root), {
      [`${VIEW}:4`]: { class: "narration", unit: "1" },
    });
    expect(applied(root, tsv, "1").status).toBe(0);
    expect(read(root, VIEW)).toBe("export const W = () => <p>{/* keep */}</p>;\n");
  });

  it("leaves each file it deletes from as oxfmt writes it", () => {
    const source =
      "export const P = ({ value }: { value: string }) => (\n  <p>\n    {/* a note */}\n    {value}\n  </p>\n);\n";
    const root = treeOf({ [VIEW]: source });
    const tsv = classified(inventoryOf(root), {
      [`${VIEW}:3`]: { class: "narration", unit: "1" },
    });
    const ran = applied(root, tsv, "1");
    expect(ran.stderr).toBe("");
    expect(ran.status).toBe(0);
    expect(read(root, VIEW)).toBe(
      "export const P = ({ value }: { value: string }) => <p>{value}</p>;\n",
    );
  });

  it("formats no file when the unit deletes nothing", () => {
    const source = "// kept\nexport const   spaced = 1;\n";
    const root = treeOf({ [SAMPLE]: source });
    const tsv = classified(inventoryOf(root), {
      [`${SAMPLE}:1`]: { class: "foreign", unit: "1" },
    });
    expect(applied(root, tsv, "1").status).toBe(0);
    expect(read(root, SAMPLE)).toBe(source);
  });

  it("resolves a holder whose line an earlier unit's deletion moved", () => {
    const root = treeOf({ [SAMPLE]: SAMPLE_SOURCE });
    const tsv = classified(inventoryOf(root), {
      [`${SAMPLE}:4`]: { class: "narration", unit: "1" },
      [`${SAMPLE}:8`]: { class: "held", unit: "2", holder: `${SAMPLE} › export const shape` },
    });
    expect(applied(root, tsv, "1").status).toBe(0);
    const ran = applied(root, tsv, "2");
    expect(ran.stderr).toBe("");
    expect(ran.status).toBe(0);
    expect(read(root, SAMPLE)).not.toContain("A doc block.");
  });

  it("deletes an open row naming its tracker issue", () => {
    const root = treeOf({ [SAMPLE]: SAMPLE_SOURCE });
    const tsv = classified(inventoryOf(root), {
      [`${SAMPLE}:8`]: { class: "open", unit: "1", holder: "BA-196" },
    });
    const ran = applied(root, tsv, "1");
    expect(ran.stderr).toBe("");
    expect(ran.stdout).toBe(`${SAMPLE}: deleted 1 block, lines 8-10\n`);
    expect(read(root, SAMPLE)).toBe(SAMPLE_SOURCE.replace("/**\n * A doc block.\n */\n", ""));
  });

  it("deletes identical blocks together when the unit names each", () => {
    const source = "// twin\nexport const one = 1;\n// twin\nexport const two = 2;\n";
    const root = treeOf({ [SAMPLE]: source });
    const tsv = classified(inventoryOf(root), {
      [`${SAMPLE}:1`]: { class: "narration", unit: "1" },
      [`${SAMPLE}:3`]: { class: "narration", unit: "1" },
    });
    expect(applied(root, tsv, "1").status).toBe(0);
    expect(read(root, SAMPLE)).toBe("export const one = 1;\nexport const two = 2;\n");
  });

  it("deletes Python rows, leaving a docstring-only body as `...`", () => {
    const root = treeOf({ [MODULE]: MODULE_SOURCE });
    const tsv = classified(
      inventoryOf(root),
      unitOne({
        [`${MODULE}:1`]: "narration",
        [`${MODULE}:3`]: "suppression",
        [`${MODULE}:5`]: "foreign",
        [`${MODULE}:7`]: "narration",
        [`${MODULE}:8`]: "suppression",
        [`${MODULE}:11`]: "contract",
        [`${MODULE}:14`]: "narration",
        [`${MODULE}:20`]: "narration",
      }),
    );
    const ran = applied(root, tsv, "1");
    expect(ran.stderr).toBe("");
    expect(ran.status).toBe(0);
    expect(ran.stdout).toBe(`${MODULE}: deleted 4 blocks, lines 1, 7, 14, 20\n`);
    expect(read(root, MODULE))
      .toBe(`import os  # noqa: E501  # the probe imports it for its side effect

# first line of a block
# second line of a block
ANSWER = 42
VALUE = os.environ.get("X")  # type: ignore[x]


# the probe's entry
@decorated
def probe() -> int:
    return ANSWER


class Shape: ...
`);
  });

  it("leaves each Python file as ruff writes it", () => {
    const source = "def one() -> int:\n    return 1\n# between\ndef two() -> int:\n    return 2\n";
    const root = treeOf({ [MODULE]: source });
    const tsv = classified(
      inventoryOf(root),
      unitOne({
        [`${MODULE}:3`]: "narration",
      }),
    );
    expect(applied(root, tsv, "1").status).toBe(0);
    expect(read(root, MODULE)).toBe(
      "def one() -> int:\n    return 1\n\n\ndef two() -> int:\n    return 2\n",
    );
  });

  it("cuts a trailing comment, never its twin earlier", () => {
    const root = treeOf({ [MODULE]: 'NOTE = "# note"  # note\n' });
    const tsv = classified(inventoryOf(root), unitOne({ [`${MODULE}:1`]: "narration" }));
    expect(applied(root, tsv, "1").status).toBe(0);
    expect(read(root, MODULE)).toBe('NOTE = "# note"\n');
  });

  it("cuts a docstring, never its twin in a default", () => {
    const root = treeOf({ [MODULE]: 'def f(x="a"): "a"  # c\n' });
    const tsv = classified(inventoryOf(root), unitOne({ [`${MODULE}:1:doc`]: "narration" }));
    expect(applied(root, tsv, "1").status).toBe(0);
    expect(read(root, MODULE)).toBe('def f(x="a"): ...  # c\n');
  });

  it.each([
    ["a form feed", "\f\f\n", ""],
    ["a line separator", 'S = "\u2028\u2028\u2028"\n', 'S = "\u2028\u2028\u2028"\n'],
  ])("keeps a trailing comment trailing after %s", (_, head, kept) => {
    const root = treeOf({ [MODULE]: `${head}# own\nx = 1  # trailing\n` });
    const tsv = inventoryOf(root);
    expect(located(tsv)).toEqual([`${MODULE} 2 2 line x 1`, `${MODULE} 3 3 trailing  1`]);
    const ran = applied(root, classified(tsv, unitOne({ [`${MODULE}:3`]: "narration" })), "1");
    expect(ran.status).toBe(0);
    expect(read(root, MODULE)).toBe(`${kept}# own\nx = 1\n`);
  });

  it.each([
    [SAMPLE, "// drop\nexport const one = 1;\n", "\uFEFFexport const one = 1;\n"],
    [MODULE, "# drop\nONE = 1\n", "ONE = 1\n"],
  ])("deletes line one of %s behind a byte order mark", (file, source, kept) => {
    const root = treeOf({ [file]: `\uFEFF${source}` });
    const tsv = classified(inventoryOf(root), unitOne({ [`${file}:1`]: "narration" }));
    expect(applied(root, tsv, "1").status).toBe(0);
    expect(read(root, file)).toBe(kept);
  });

  it("drops the blanks a deletion leaves where oxfmt cannot", () => {
    const source =
      "// top\n\nexport const one = 1;\n\n// between\n\nexport const two = 2; // trailing\n";
    const root = treeOf({
      [SAMPLE]: source,
      ".oxfmtrc.json": `{ "ignorePatterns": ["${SAMPLE}"] }\n`,
    });
    const tsv = classified(
      inventoryOf(root),
      unitOne({
        [`${SAMPLE}:1`]: "narration",
        [`${SAMPLE}:5`]: "narration",
        [`${SAMPLE}:7`]: "narration",
      }),
    );
    expect(applied(root, tsv, "1").status).toBe(0);
    expect(read(root, SAMPLE)).toBe("export const one = 1;\n\nexport const two = 2;\n");
  });

  it("runs no formatter for a language the unit leaves", () => {
    const root = treeOf({
      [SAMPLE]: "// drop\nexport const one = 1;\n",
      [MODULE]: "ONE = 1\n",
      "pyproject.toml": '[tool.ruff]\nline-length = "wide"\n',
    });
    const tsv = classified(
      inventoryOf(root),
      unitOne({
        [`${SAMPLE}:1`]: "narration",
      }),
    );
    const ran = applied(root, tsv, "1");
    expect(ran.stderr).toBe("");
    expect(ran.status).toBe(0);
  });
});

describe("comment-inventory apply restores every file when a formatter fails", () => {
  it.each([
    ["oxfmt", ".oxfmtrc.json", '{ "ignorePatterns": [', "Failed to load configuration file"],
    ["ruff format", "pyproject.toml", '[tool.ruff]\nline-length = "wide"\n', "Failed to parse"],
  ])("%s", (formatter, config, broken, says) => {
    const files = {
      [SAMPLE]: "// drop\nexport const   one = 1;\n",
      [MODULE]: "# drop\nONE   = 1\n",
    };
    const root = treeOf(files);
    const tsv = classified(
      inventoryOf(root),
      unitOne({
        [`${SAMPLE}:1`]: "narration",
        [`${MODULE}:1`]: "narration",
      }),
    );
    writeFileSync(path.join(root, config), broken);
    const ran = applied(root, tsv, "1");
    expect(ran.status).toBe(2);
    expect(ran.stdout).toBe("");
    expect(ran.stderr).toContain("unit 1: the formatter failed, so no file changed:");
    expect(ran.stderr).toContain(`${formatter}: `);
    expect(ran.stderr).toContain(says);
    expect(ran.stderr).not.toContain("    at ");
    expect(Object.keys(files).map((file) => read(root, file))).toEqual(Object.values(files));
  });
});

describe("comment-inventory apply refuses, changing no file", () => {
  const refusedOver = (
    files: Tree,
    choices: Readonly<Record<string, Classing>>,
    edit?: (root: string) => void,
  ) => {
    const root = treeOf(files);
    const tsv = classified(inventoryOf(root), choices);
    edit?.(root);
    const before = Object.keys(files).map((file) => read(root, file));
    const ran = applied(root, tsv, "1");
    expect(Object.keys(files).map((file) => read(root, file))).toEqual(before);
    expect(ran.status).toBe(1);
    return ran.stderr;
  };

  const narrationAt4 = { [`${SAMPLE}:4`]: { class: "narration", unit: "1" } };

  it.each([
    ["text found nowhere", `${HOLDER} › drops the answer`, "holds this text 0 times"],
    ["text found twice", `${SAMPLE} › export const`, "holds this text 2 times"],
    ["text that overlaps itself", `${HOLDER} › keeps keeps`, "holds this text 2 times"],
    ["text a deletion removes", `${SAMPLE} › second line of a block`, "0 times"],
    ["in a missing file", "test/missing.test.ts › keeps the answer", "names no file"],
    ["a line number", `${HOLDER}:3`, "is not path › text: anchor it on text"],
  ])("when a held row's holder is %s", (_form, holder, why) => {
    const stderr = refusedOver(
      { [SAMPLE]: SAMPLE_SOURCE, [HOLDER]: HOLDER_SOURCE },
      { ...narrationAt4, [`${SAMPLE}:8`]: { class: "held", unit: "1", holder } },
    );
    expect(stderr).toContain(`${SAMPLE}:8: `);
    expect(stderr).toContain(why);
  });

  it.each([
    ["no holder", ""],
    ["a path › text holder", `${HOLDER} › keeps the answer`],
    ["an issue of another tracker", "LIN-12"],
  ])("when an open row names %s", (_form, holder) => {
    const stderr = refusedOver(
      { [SAMPLE]: SAMPLE_SOURCE, [HOLDER]: HOLDER_SOURCE },
      { ...narrationAt4, [`${SAMPLE}:8`]: { class: "open", unit: "1", holder } },
    );
    expect(stderr).toContain(`${SAMPLE}:8: an open row's holder is the tracker issue`);
  });

  it("when a holder's text only a later unit's deletion holds", () => {
    const stderr = refusedOver(
      { [SAMPLE]: SAMPLE_SOURCE },
      {
        [`${SAMPLE}:8`]: { class: "held", unit: "1", holder: `${SAMPLE} › a lone block` },
        [`${SAMPLE}:13`]: { class: "narration", unit: "2" },
      },
    );
    expect(stderr).toContain("holds this text 0 times");
  });

  it("when a row's text is no longer in the file", () => {
    const stderr = refusedOver(
      { [SAMPLE]: SAMPLE_SOURCE },
      { ...narrationAt4, [`${SAMPLE}:13`]: { class: "narration", unit: "1" } },
      (root) => {
        writeFileSync(path.join(root, SAMPLE), SAMPLE_SOURCE.replace("a lone", "an edited"));
      },
    );
    expect(stderr).toContain(`${SAMPLE}:13: the file holds this block 0 times`);
  });

  it("when a row's text is found twice", () => {
    const source = "// twin\nexport const one = 1;\n// twin\nexport const two = 2;\n";
    const stderr = refusedOver(
      { [SAMPLE]: source },
      { [`${SAMPLE}:3`]: { class: "narration", unit: "1" } },
    );
    expect(stderr).toContain(`${SAMPLE}:3: the file holds this block 2 times`);
  });

  it("when a row names a file of neither language", () => {
    const root = treeOf({ [SAMPLE]: SAMPLE_SOURCE, "src/notes.md": "// a note\n" });
    const tsv = classified(inventoryOf(root), narrationAt4).replace(
      `${SAMPLE}\t4\t`,
      "src/notes.md\t1\t",
    );
    const ran = applied(root, tsv, "1");
    expect(ran.status).toBe(1);
    expect(ran.stderr).toContain("src/notes.md:1: neither TypeScript nor Python");
    expect(read(root, "src/notes.md")).toBe("// a note\n");
  });

  it("when a row in the unit is unclassified", () => {
    const stderr = refusedOver(
      { [SAMPLE]: SAMPLE_SOURCE },
      { ...narrationAt4, [`${SAMPLE}:13`]: { class: "", unit: "1" } },
    );
    expect(stderr).toContain(`${SAMPLE}:13: unclassified`);
  });
});

describe("comment-inventory reading a malformed file", () => {
  it("refuses the whole file, naming the line", () => {
    const root = treeOf({ [SAMPLE]: SAMPLE_SOURCE });
    const tsv = classified(inventoryOf(root), {
      [`${SAMPLE}:4`]: { class: "narration", unit: "1" },
      [`${SAMPLE}:6`]: { class: "obvious", unit: "1" },
    });
    const ran = applied(root, tsv, "1");
    expect(ran.status).toBe(2);
    expect(ran.stderr).toContain("rows.tsv: line 4: class");
    expect(read(root, SAMPLE)).toBe(SAMPLE_SOURCE);
  });
});

describe("comment-inventory check", () => {
  it("reports each unit's deletions and writes nothing", () => {
    const root = treeOf({ [SAMPLE]: SAMPLE_SOURCE });
    const tsv = classified(inventoryOf(root), {
      [`${SAMPLE}:4`]: { class: "narration", unit: "1" },
      [`${SAMPLE}:8`]: { class: "lost", unit: "2" },
    });
    writeFileSync(path.join(root, "rows.tsv"), tsv);
    const ran = run(root, "check", "rows.tsv");
    expect(ran.status).toBe(0);
    expect(ran.stdout).toBe(
      `unit 1: ${SAMPLE}: would delete 1 block, lines 4-5\nunit 2: ${SAMPLE}: would delete 1 block, lines 8-10\n`,
    );
    expect(read(root, SAMPLE)).toBe(SAMPLE_SOURCE);
  });

  it("reports a Python unit's deletions and writes nothing", () => {
    const root = treeOf({ [MODULE]: MODULE_SOURCE });
    const tsv = classified(
      inventoryOf(root),
      unitOne({
        [`${MODULE}:5`]: "narration",
        [`${MODULE}:20`]: "lost",
      }),
    );
    writeFileSync(path.join(root, "rows.tsv"), tsv);
    const ran = run(root, "check", "rows.tsv");
    expect(ran.stderr).toBe("");
    expect(ran.status).toBe(0);
    expect(ran.stdout).toBe(`unit 1: ${MODULE}: would delete 2 blocks, lines 5-6, 20\n`);
    expect(read(root, MODULE)).toBe(MODULE_SOURCE);
  });
});
