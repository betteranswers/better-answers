const SOURCE_EXTENSIONS = [
  "cjs",
  "css",
  "cts",
  "go",
  "html",
  "js",
  "json",
  "jsonc",
  "jsx",
  "md",
  "mdx",
  "mjs",
  "mts",
  "py",
  "rs",
  "sh",
  "sql",
  "toml",
  "ts",
  "tsx",
  "yaml",
  "yml",
];

const RANGE = String.raw`\d+(?:[-–]\d+)?`;

const AFTER_A_FILE_NAME = String.raw`[\w@./-]+\.(?:${SOURCE_EXTENSIONS.join("|")}):${RANGE}(?::\d+)?(?!\w)`;

const BACKTICK = "`";

const A_BARE_FRAGMENT = `(?<=${BACKTICK}):${RANGE}(?=${BACKTICK})`;

const LINE_REFERENCE = new RegExp(`${AFTER_A_FILE_NAME}|${A_BARE_FRAGMENT}`, "giu");

type LineReference = { readonly line: number; readonly text: string };

export const lineReferencesIn = (text: string): readonly LineReference[] =>
  text.split("\n").flatMap((content, index) =>
    [...content.matchAll(LINE_REFERENCE)].map((match) => ({
      line: index + 1,
      text: match[0],
    })),
  );
