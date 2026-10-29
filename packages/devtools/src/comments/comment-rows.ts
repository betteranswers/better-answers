import { z } from "zod";

export const KINDS = ["doc", "line", "trailing", "directive"] as const;

export type Kind = (typeof KINDS)[number];

const CLASSES = [
  "narration",
  "held",
  "structure",
  "open",
  "foreign",
  "contract",
  "suppression",
  "lost",
] as const;

type Class = (typeof CLASSES)[number] | "";

export const KEPT: ReadonlySet<Class> = new Set(["foreign", "contract", "suppression"]);

export const NEEDS_A_HOLDER: ReadonlySet<Class> = new Set(["held", "structure"]);

export const TRACKER_ISSUE = /^BA-\d+$/u;

const COLUMNS = [
  "path",
  "start",
  "end",
  "kind",
  "attached",
  "words",
  "text",
  "class",
  "holder",
  "structure",
  "unit",
] as const;

const HEADER = COLUMNS.join("\t");

const ESCAPED = new Map([
  ["\\", "\\\\"],
  ["\t", "\\t"],
  ["\n", "\\n"],
  ["\r", "\\r"],
]);

const UNESCAPED = new Map([...ESCAPED].map(([one, written]) => [written.slice(1), one]));

const WELL_ESCAPED = /^(?:[^\\]|\\[\\tnr])*$/u;

const escaped = (value: string): string =>
  value.replace(/[\\\t\n\r]/gu, (one) => ESCAPED.get(one) ?? one);

const field = z
  .string()
  .refine((raw) => WELL_ESCAPED.test(raw), "a backslash escapes only \\, t, n or r")
  .transform((raw) => raw.replace(/\\([\\tnr])/gu, (_, one: string) => UNESCAPED.get(one) ?? one));

const counted = (least: number) => field.pipe(z.coerce.number<string>().int().min(least));

const rowSchema = z
  .object({
    path: field.pipe(z.string().min(1)),
    start: counted(1),
    end: counted(1),
    kind: field.pipe(z.enum(KINDS)),
    attached: field,
    words: counted(0),
    text: field.pipe(z.string().min(1)),
    class: field.pipe(z.union([z.enum(CLASSES), z.literal("")])),
    holder: field,
    structure: field,
    unit: field,
  })
  .refine((row) => row.end >= row.start, { message: "ends before it starts", path: ["end"] });

export type Row = Readonly<z.output<typeof rowSchema>>;

export type Outcome<T> = { readonly value: T } | { readonly refused: readonly string[] };

const rowAt = (line: string, number: number): Outcome<Row> => {
  const fields = line.split("\t");
  if (fields.length !== COLUMNS.length) {
    return { refused: [`line ${number}: ${fields.length} fields, not ${COLUMNS.length}`] };
  }
  const read = rowSchema.safeParse(
    Object.fromEntries(COLUMNS.map((column, index) => [column, fields[index]])),
  );
  if (read.success) return { value: read.data };
  const [issue] = read.error.issues;
  return { refused: [`line ${number}: ${issue?.path.join(".")} ${issue?.message}`] };
};

export const rowsIn = (tsv: string): Outcome<readonly Row[]> => {
  const [header, ...lines] = tsv.replace(/\n$/u, "").split("\n");
  if (header !== HEADER) return { refused: [`line 1: the header is not ${COLUMNS.join(", ")}`] };
  const rows: Row[] = [];
  for (const [index, line] of lines.entries()) {
    const read = rowAt(line, index + 2);
    if ("refused" in read) return read;
    rows.push(read.value);
  }
  return { value: rows };
};

export const tsvOf = (rows: readonly Row[]): string =>
  [HEADER, ...rows.map((row) => COLUMNS.map((column) => escaped(String(row[column]))).join("\t"))]
    .map((line) => `${line}\n`)
    .join("");
