import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { testData } from "./factory.ts";
import { type MigratedPostgres, withRollback } from "./harness.ts";
import { openMigratedPostgres } from "./warm-postgres.ts";

/**
 * The `finding` category words this package writes, held to the redaction agreement that
 * declares them — `contracts/redaction/cases.json`, ADR 0031's fixtured form — by reading
 * the fixture rather than restating its words. `packages/core`'s own `REDACTION_CATEGORIES`
 * already holds the TypeScript side of that agreement against this same file
 * (`packages/core/test/redaction.contract.test.ts`); `packages/schema` carries no category
 * list of its own by design, so this suite asks the narrower question: is a category word
 * this package writes one of the words the agreement declares. The negative case names the
 * one word a prior defect actually seeded and the fixture has never declared — an empty or
 * mis-read set would still pass the first assertion, so this is what says the declared set
 * was read rather than merely non-empty.
 *
 * The factory's default is asked through the database, seeded with no overrides and read
 * back through the select schema. Every other category word in this package is spelled by
 * hand in a test, and the column carries no CHECK, so nothing between the keyboard and the
 * row refuses a word the agreement never declared; the second pair of cases therefore reads
 * the test tree itself, so the fixture stays the one place a category word is declared rather
 * than merely the place the factory happens to agree with.
 */

const contractsDir = path.resolve(import.meta.dirname, "../../../contracts");
const redactionCases = JSON.parse(
  readFileSync(path.join(contractsDir, "redaction", "cases.json"), "utf8"),
) as { readonly categories: ReadonlyArray<{ readonly category: string }> };
const DECLARED_CATEGORIES = new Set(redactionCases.categories.map((entry) => entry.category));

/**
 * Today's census of the tree: six category words written as an object property and four
 * written into a raw `INSERT INTO finding`. A floor rather than an equality, so a row added
 * later needs no edit here. What it catches is the other direction — a scan that has stopped
 * seeing the rows it reads today, because a pattern that matches nothing asserts nothing and
 * would pass in silence.
 */
const CATEGORY_WORDS_IN_THE_TREE = 10;

/**
 * Every `.ts` file under this package's test tree, less this one. The case below plants an
 * undeclared word on purpose, so that the walk's empty answer can be read as a reading rather
 * than as a pattern that has stopped matching; a walk that took this file in would report that
 * plant as the very defect the plant exists to prove it can find.
 */
const testTreeFiles = (): readonly string[] =>
  readdirSync(import.meta.dirname, { encoding: "utf8", recursive: true })
    .filter((under) => under.endsWith(".ts") && under !== path.basename(import.meta.filename))
    .map((under) => path.join(import.meta.dirname, under));

/**
 * One `VALUES (…)` row's items, split at the commas that are the row's own: a comma inside a
 * quoted literal belongs to the literal, and the bracket `now()` closes is not the row's.
 */
const rowItems = (afterTheOpeningBracket: string): readonly string[] => {
  const items: string[] = [];
  let item = "";
  let depth = 0;
  let quoted = false;
  for (const character of afterTheOpeningBracket) {
    if (quoted) quoted = character !== "'";
    else if (character === "'") quoted = true;
    else if (character === "(") depth += 1;
    else if (character === ")" && depth > 0) depth -= 1;
    else if (character === ")") return [...items, item];
    else if (character === "," && depth === 0) {
      items.push(item);
      item = "";
      continue;
    }
    item += character;
  }
  return [...items, item];
};

const CATEGORY_PROPERTY = /\bcategory:\s*"([^"]*)"/g;
const FINDING_INSERT = /INSERT INTO finding\s*\(([^)]*)\)\s*VALUES\s*\(/g;
const SQL_STRING = /^'(.*)'$/;

/**
 * Every category word written by hand in one file's source, tagged with the name the failure
 * should print: the object property a factory or a hand-built row uses, and the value standing
 * under `category` in a raw `INSERT INTO finding`. The column list is read for where `category`
 * sits rather than assumed, so a row that names its columns in another order is still read at
 * the right one. A row that passes the word as a bind parameter writes no word, so there is
 * nothing in it to read. Source and name are taken apart rather than a path read from disk, so
 * the case that plants a word can hand this the same reader the walk uses.
 */
const categoryWordsIn = (
  source: string,
  file: string,
): readonly { file: string; category: string }[] => {
  const properties = [...source.matchAll(CATEGORY_PROPERTY)].map((match) => match[1] ?? "");
  const inserted = [...source.matchAll(FINDING_INSERT)].flatMap((match) => {
    const columns = (match[1] ?? "").split(",").map((column) => column.trim());
    const items = rowItems(source.slice(match.index + match[0].length));
    const written = SQL_STRING.exec(items[columns.indexOf("category")]?.trim() ?? "");
    return written === null ? [] : [written[1] ?? ""];
  });
  return [...properties, ...inserted].map((category) => ({ file, category }));
};

/** Every category word the test tree writes, read file by file. */
const categoryWordsInTheTestTree = (): readonly { file: string; category: string }[] =>
  testTreeFiles().flatMap((file) =>
    categoryWordsIn(readFileSync(file, "utf8"), path.basename(file)),
  );

/**
 * The words in a scan the agreement has not declared, which is what a failure prints.
 *
 * One word is let through: the boundary suite lists a category of whitespace alone among the
 * rows the `finding`'s boundary schema must refuse, and the refusal is the zod refinement's,
 * before any insert exists to fail — `finding.category` is `text NOT NULL` and carries no CHECK
 * at all (migration 0023). A declared word in that row would prove nothing it was written to
 * prove. A blank is a word the agreement can never declare, so nothing else can hide behind it.
 */
const undeclared = (
  written: readonly { file: string; category: string }[],
): readonly { file: string; category: string }[] =>
  written.filter((row) => row.category.trim() !== "" && !DECLARED_CATEGORIES.has(row.category));

let db: MigratedPostgres;

beforeAll(async () => {
  db = await openMigratedPostgres();
});

afterAll(async () => {
  await db.stop();
});

describe("the finding factory's default category", () => {
  it("is one of the redaction agreement's own declared categories", async () => {
    const seeded = await withRollback(db.pool, (client) => testData(client).finding());

    expect(DECLARED_CATEGORIES.has(seeded.category)).toBe(true);
  });

  it("is not a word the fixture has never declared", () => {
    expect(DECLARED_CATEGORIES.has("sort-code")).toBe(false);
  });
});

describe("the finding factory's default span", () => {
  it("is a span of its own, so two findings seeded in one document under one rule are two rows", async () => {
    // A finding is unique on its document, its rule and its two offsets (migration 0040), and
    // a suite opens a factory per seeding — so the span nobody placed is counted per process
    // and never per factory, which is the only reading under which the second seeding below
    // lands at all.
    const spans = await withRollback(db.pool, async (client) => {
      const first = await testData(client).finding();
      const second = await testData(client).finding({
        workspaceId: first.workspaceId,
        documentId: first.documentId,
      });
      return [first, second].map((row) => row.charEnd - row.charStart);
    });

    expect(spans).toEqual([8, 8]);
  });
});

describe("the category words this package's tests spell by hand", () => {
  it("names only categories the redaction agreement declares, in every file of the test tree", () => {
    const written = categoryWordsInTheTestTree();

    expect(written.length).toBeGreaterThanOrEqual(CATEGORY_WORDS_IN_THE_TREE);
    expect(undeclared(written)).toEqual([]);
  });

  it("names an undeclared word written either way, which is what the walk's silence rests on", () => {
    // The control the walk above needs to be read at all: an assertion that nothing was found
    // passes just as well when nothing can be found, so each of the two patterns is handed a
    // word it must return, and the two are put through the same filter the walk's answer is.
    const planted = categoryWordsIn(
      `{ ...row, category: "sort-code", tier: "always" },
       INSERT INTO finding (workspace_id, id, category, tier, rule_id)
              VALUES ($1, $2, 'sort-code', 'always', 'sort-code-with-account-number')`,
      "planted.ts",
    );

    expect(undeclared(planted)).toEqual([
      { file: "planted.ts", category: "sort-code" },
      { file: "planted.ts", category: "sort-code" },
    ]);
  });
});
