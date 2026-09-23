import fs from "node:fs";
import path from "node:path";

const YAML = "yaml";
const SHELL = "shell";
const TOML = "toml";
const SQL = "sql";

export const LANGUAGE_BY_EXTENSION = new Map([
  [".yml", YAML],
  [".yaml", YAML],
  [".sh", SHELL],
  [".bash", SHELL],
  [".toml", TOML],
  [".sql", SQL],
]);

const endOfLine = (source, index) => {
  const newline = source.indexOf("\n", index);
  return newline === -1 ? source.length : newline;
};

// SQL doubles a quote to escape it, a basic string takes a backslash, a literal string neither.
const endOfQuoted = (source, start, quote, { escapes = false, doubling = false } = {}) => {
  let index = start + 1;
  while (index < source.length) {
    const here = source[index];
    if (escapes && here === "\\") {
      index += 2;
      continue;
    }
    if (here === quote) {
      if (doubling && source[index + 1] === quote) {
        index += 2;
        continue;
      }
      return index + 1;
    }
    index += 1;
  }
  return source.length;
};

const DOLLAR_TAG = /\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/y;
const WORD_CHARACTER = /[A-Za-z0-9_]/;

const sqlSpans = (source) => {
  const spans = [];
  let index = 0;
  while (index < source.length) {
    const here = source[index];
    if (here === "'") {
      // `E'…'` takes backslash escapes where a plain literal does not.
      const prefixed =
        (source[index - 1] === "e" || source[index - 1] === "E") &&
        !WORD_CHARACTER.test(source[index - 2] ?? "");
      index = endOfQuoted(source, index, "'", { escapes: prefixed, doubling: true });
      continue;
    }
    if (here === '"') {
      index = endOfQuoted(source, index, '"', { doubling: true });
      continue;
    }
    if (here === "$") {
      DOLLAR_TAG.lastIndex = index;
      const opened = DOLLAR_TAG.exec(source);
      if (opened !== null) {
        const closed = source.indexOf(opened[0], index + opened[0].length);
        index = closed === -1 ? source.length : closed + opened[0].length;
        continue;
      }
    }
    if (here === "-" && source[index + 1] === "-") {
      const end = endOfLine(source, index);
      spans.push({ start: index, end });
      index = end;
      continue;
    }
    if (here === "/" && source[index + 1] === "*") {
      // Postgres nests a block comment, so the depth is counted rather than the first close taken.
      let depth = 1;
      let scan = index + 2;
      while (scan < source.length && depth > 0) {
        if (source[scan] === "/" && source[scan + 1] === "*") {
          depth += 1;
          scan += 2;
          continue;
        }
        if (source[scan] === "*" && source[scan + 1] === "/") {
          depth -= 1;
          scan += 2;
          continue;
        }
        scan += 1;
      }
      spans.push({ start: index, end: scan });
      index = scan;
      continue;
    }
    index += 1;
  }
  return spans;
};

// A `\` inside `"""…"""` escapes the fence after it, and TOML lets two spare quotes stand
// before the close, so the run is taken whole.
const endOfFence = (source, start, quote) => {
  const fence = quote.repeat(3);
  let index = start + 3;
  while (index < source.length) {
    if (quote === '"' && source[index] === "\\") {
      index += 2;
      continue;
    }
    if (source.startsWith(fence, index)) {
      let run = 0;
      while (source[index + run] === quote) run += 1;
      return index + Math.min(run, 5);
    }
    index += 1;
  }
  return source.length;
};

const tomlSpans = (source) => {
  const spans = [];
  let index = 0;
  while (index < source.length) {
    const here = source[index];
    if (here === '"' || here === "'") {
      if (source.startsWith(here.repeat(3), index)) {
        index = endOfFence(source, index, here);
        continue;
      }
      index = endOfQuoted(source, index, here, { escapes: here === '"' });
      continue;
    }
    if (here === "#") {
      const end = endOfLine(source, index);
      spans.push({ start: index, end });
      index = end;
      continue;
    }
    index += 1;
  }
  return spans;
};

const MARKS_A_VALUE = /^[&*!]/;
const SEQUENCE = /^-( -)*$/;

// A quote opens a scalar only where one may begin; elsewhere it is plain.
const opensAScalar = (line, index, flow) => {
  const before = line.slice(0, index).trimEnd();
  if (before === "") return true;
  const last = before[before.length - 1];
  if (last === "[" || last === "{") return true;
  if (last === ",") return flow > 0;

  // A `:` opens a value only with a space after it, except in flow, where the JSON spelling
  // needs none.
  if (last === ":" || last === "?") return flow > 0 || before.length < index;
  if (last === "-") return before.length < index && SEQUENCE.test(before.trimStart());
  return MARKS_A_VALUE.test(before.slice(before.lastIndexOf(" ") + 1));
};

const yamlCommentStart = (line, open, depth) => {
  let quote = open;
  let flow = depth;
  let index = 0;
  while (index < line.length) {
    const here = line[index];
    if (quote !== null) {
      if (quote === '"' && here === "\\") index += 1;
      else if (quote === "'" && here === quote && line[index + 1] === quote) index += 1;
      else if (here === quote) quote = null;
      index += 1;
      continue;
    }
    if (here === "[" || here === "{") flow += 1;
    else if (here === "]" || here === "}") flow -= 1;
    else if ((here === "'" || here === '"') && opensAScalar(line, index, flow)) {
      quote = here;
      index += 1;
      continue;
    } else if (
      here === "#" &&
      (index === 0 || line[index - 1] === " " || line[index - 1] === "\t")
    ) {
      return { at: index, open: null, flow };
    }
    index += 1;
  }
  return { at: -1, open: quote, flow };
};

const BLOCK_SCALAR = /(?:^|\s)[|>][+-]?\d*[+-]?\s*$/;

// A block scalar's body is a key's value, so a `#` there is the step's script, not a comment.
const yamlSpans = (source) => {
  const spans = [];
  let offset = 0;
  let bodyBelow = null;
  let open = null;
  let flow = 0;
  for (const line of source.split("\n")) {
    const indent = line.length - line.trimStart().length;
    if (bodyBelow !== null) {
      if (line.trim() === "" || indent > bodyBelow) {
        offset += line.length + 1;
        continue;
      }
      bodyBelow = null;
    }
    const continuing = open !== null || flow > 0;
    const answer = yamlCommentStart(line, open, flow);
    open = answer.open;
    flow = answer.flow;
    if (answer.at !== -1) spans.push({ start: offset + answer.at, end: offset + line.length });
    const code = answer.at === -1 ? line : line.slice(0, answer.at);
    if (!continuing && open === null && flow === 0 && BLOCK_SCALAR.test(code)) bodyBelow = indent;
    offset += line.length + 1;
  }
  return spans;
};

// `${ … }` is a parameter, so a `#` in it is a length or a pattern, never a comment.
const endOfBraces = (source, start) => {
  let index = start + 2;
  let depth = 1;
  while (index < source.length) {
    const here = source[index];
    if (here === "\\") {
      index += 2;
      continue;
    }
    if (here === "'" || here === '"') {
      index = endOfQuoted(source, index, here, { escapes: here === '"' });
      continue;
    }
    if (here === "{") depth += 1;
    else if (here === "}") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
    index += 1;
  }
  return source.length;
};

const HEREDOC = /<<-?\s*\\?(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/y;
const OPENS_A_WORD = new Set([" ", "\t", ";", "(", "&", "|", "{", "!"]);
const HOLDS_A_COMMAND = new Set([";", "&", "|", "{", "!"]);
const KEEPS_A_COMMAND = new Set(["then", "do", "else", "elif"]);
const PLAIN_WORD = /[A-Za-z_][A-Za-z0-9_]*/y;

const plainWordAt = (source, index) => {
  PLAIN_WORD.lastIndex = index;
  return PLAIN_WORD.exec(source)?.[0];
};

const endOfHeredoc = (source, start, delimiter) => {
  let index = start;
  while (index < source.length) {
    const end = endOfLine(source, index);
    if (source.slice(index, end).trim() === delimiter) return Math.min(end + 1, source.length);
    index = end + 1;
  }
  return source.length;
};

const shellSpans = (source) => {
  const spans = [];
  const pending = [];
  const frames = [];
  let index = 0;
  let opens = true;
  let commands = true;
  let inCase = 0;
  while (index < source.length) {
    const here = source[index];
    const quoted = frames.at(-1)?.kind === "double";
    if (here === "\\") {
      index += 2;
      opens = false;
      continue;
    }
    if (here === "$" && source[index + 1] === "(") {
      frames.push({ kind: "command", inCase });
      index += 2;
      opens = true;
      commands = true;
      continue;
    }
    if (here === "$" && source[index + 1] === "{") {
      index = endOfBraces(source, index);
      opens = false;
      continue;
    }

    // `$'…'` takes backslash escapes; a plain `'…'` takes none, and inside a double quote the
    // whole spelling is literal.
    if (here === "$" && source[index + 1] === "'" && !quoted) {
      index = endOfQuoted(source, index + 1, "'", { escapes: true });
      opens = false;
      continue;
    }
    if (here === '"') {
      if (quoted) frames.pop();
      else frames.push({ kind: "double", inCase });
      index += 1;
      opens = false;
      continue;
    }
    if (quoted) {
      index += 1;
      continue;
    }
    if (here === "\n") {
      index += 1;
      while (pending.length > 0) index = endOfHeredoc(source, index, pending.shift());
      opens = true;
      commands = true;
      continue;
    }

    // A `case` pattern's `)` opened nothing, so a frame closes only where its `(` stood, and
    // the two words count only at a command's start.
    if (opens) {
      const word = plainWordAt(source, index);
      if (word !== undefined) {
        if (commands && word === "case") inCase += 1;
        else if (commands && word === "esac") inCase = Math.max(0, inCase - 1);
        commands = KEEPS_A_COMMAND.has(word);
        index += word.length;
        opens = false;
        continue;
      }
    }

    if (here === "(") {
      frames.push({ kind: "subshell", inCase });
      index += 1;
      opens = true;
      commands = true;
      continue;
    }
    if (here === ")") {
      const top = frames.at(-1);
      if (top !== undefined && top.kind !== "double" && top.inCase === inCase) frames.pop();
      index += 1;
      opens = false;
      commands = false;
      continue;
    }
    if (here === "'" || here === "`") {
      index = endOfQuoted(source, index, here);
      opens = false;
      commands = false;
      continue;
    }
    if (here === "#" && opens) {
      const end = endOfLine(source, index);
      spans.push({ start: index, end });
      index = end;
      continue;
    }
    if (here === "<" && source[index + 1] === "<") {
      HEREDOC.lastIndex = index;
      const opened = HEREDOC.exec(source);
      if (opened !== null) {
        pending.push(opened[2]);
        index += opened[0].length;
        opens = false;
        continue;
      }
    }

    // Whitespace leaves the command position where it was; a separator restores it.
    if (OPENS_A_WORD.has(here)) {
      index += 1;
      opens = true;
      if (HOLDS_A_COMMAND.has(here)) commands = true;
      continue;
    }
    index += 1;
    opens = false;
    commands = false;
  }
  return spans;
};

const SPANS = new Map([
  [YAML, yamlSpans],
  [SHELL, shellSpans],
  [TOML, tomlSpans],
  [SQL, sqlSpans],
]);

const commentSpans = (language, source) => {
  const scan = SPANS.get(language);
  if (scan === undefined) throw new Error(`config-comments: no syntax for ${language}`);
  return scan(source);
};

// A word this list does not carry is prose, however tool-shaped it reads.
const DIRECTIVE_WORD = /^(?:shellcheck|renovate|yaml-language-server|noqa)\b/i;

const BREAKPOINT_BODY = "statement-breakpoint";
const SEPARATOR = `--> ${BREAKPOINT_BODY}`;
const BREAKPOINT = new RegExp(`^${BREAKPOINT_BODY}$`);

const MARKER = path.resolve(import.meta.dirname, "../packages/devtools/migration-marker.json");

const markerIn = (file) => {
  const { marker } = JSON.parse(fs.readFileSync(file, "utf8"));
  // A key that moved would leave `undefined` here and strip every marker in the tree.
  if (typeof marker !== "string" || marker.trim() === "") throw new Error(`${file} carries none`);
  return marker;
};

export const CUSTOM_MIGRATION = markerIn(MARKER);

// A bare number is a step or a count, so a version says so: a leading `v`, a dot, or a commit.
const VERSION = /^(?:v\d+(?:\.\d+)*|\d+(?:\.\d+)+)$/;
const COMMIT = /^[0-9a-f]{7,40}$/;
const OPENER = /^(?:#+|--+>?|\/\*)/;

const namesAVersion = (body) => {
  const words = body.split(/\s+/).filter((word) => word !== "");
  if (words.length === 0 || words.length > 2) return false;
  const last = words.at(-1);
  return VERSION.test(last) || COMMIT.test(last);
};

const isDirective = (source, span) => {
  if (span.start === 0 && source.startsWith("#!")) return true;
  const raw = source.slice(span.start, span.end);
  if (raw.trimEnd() === CUSTOM_MIGRATION) return true;
  const body = raw.replace(OPENER, "").replace(/\*\/$/, "").trim();
  if (DIRECTIVE_WORD.test(body) || BREAKPOINT.test(body)) return true;
  const opened = source.lastIndexOf("\n", span.start - 1) + 1;
  const beside = source.slice(opened, span.start).trim() !== "";
  return beside && namesAVersion(body);
};

const CUT = "\u0000";
const WHITESPACE = /\s/;

// A comment with code on both sides leaves a space, or `a/* why */FROM` closes up into one word.
export const withoutComments = (language, source) => {
  const removable = commentSpans(language, source).filter((span) => !isDirective(source, span));
  if (removable.length === 0) return source;

  let marked = "";
  let read = 0;
  for (const span of removable) {
    const joined =
      !WHITESPACE.test(source[span.start - 1] ?? " ") && !WHITESPACE.test(source[span.end] ?? " ");
    marked += source.slice(read, span.start) + (joined ? " " : "") + CUT;
    read = span.end;
  }
  marked += source.slice(read);

  const kept = [];
  for (const line of marked.split("\n")) {
    if (!line.includes(CUT)) {
      kept.push(line);
      continue;
    }
    const without = line.replaceAll(CUT, "");
    if (without.trim() === "") continue;
    kept.push(without.trimEnd());
  }
  return kept.join("\n");
};

// The migrator splits on this token wherever it sits, so the line it is written on is layout.
const withSeparatorUnfolded = (source) => source.split(SEPARATOR).join(`\n${SEPARATOR}\n`);

export const normalized = (language, source) => {
  const stripped = withoutComments(language, source);
  return (language === SQL ? withSeparatorUnfolded(stripped) : stripped)
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line !== "")
    .join("\n");
};
