import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { testData } from "./factory.ts";
import { type MigratedPostgres, withRollback } from "./harness.ts";
import { openMigratedPostgres } from "./warm-postgres.ts";

const contractsDir = path.resolve(import.meta.dirname, "../../../contracts");
const redactionContract = z.object({ categories: z.array(z.object({ category: z.string() })) });
const redactionCases = redactionContract.parse(
  JSON.parse(readFileSync(path.join(contractsDir, "redaction", "cases.json"), "utf8")),
);
const DECLARED_CATEGORIES = new Set(redactionCases.categories.map((entry) => entry.category));

const CATEGORY_WORDS_IN_THE_TREE = 10;

const testTreeFiles = (): readonly string[] =>
  readdirSync(import.meta.dirname, { encoding: "utf8", recursive: true })
    .filter((under) => under.endsWith(".ts") && under !== path.basename(import.meta.filename))
    .map((under) => path.join(import.meta.dirname, under));

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
const FINDING_ROW_PATTERN = /INSERT INTO finding\s*\(([^)]*)\)\s*VALUES\s*\(/g;
const SQL_STRING = /^'(.*)'$/;

const PLANTED_CATEGORY = "sort-code";
const FINDING_TABLE = "finding";

// The table is named apart so the tree's scan for raw inserts reads this sample as the text it is.
const plantedCategoryWords = (): string =>
  `{ ...row, category: "${PLANTED_CATEGORY}", tier: "always" },
       INSERT INTO ${FINDING_TABLE} (workspace_id, id, category, tier, rule_id)
              VALUES ($1, $2, '${PLANTED_CATEGORY}', 'always', 'sort-code-with-account-number')`;

const categoryWordsIn = (
  source: string,
  file: string,
): readonly { file: string; category: string }[] => {
  const properties = [...source.matchAll(CATEGORY_PROPERTY)].map((match) => match[1] ?? "");
  const inserted = [...source.matchAll(FINDING_ROW_PATTERN)].flatMap((match) => {
    const columns = (match[1] ?? "").split(",").map((column) => column.trim());
    const items = rowItems(source.slice(match.index + match[0].length));
    const written = SQL_STRING.exec(items[columns.indexOf("category")]?.trim() ?? "");
    return written === null ? [] : [written[1] ?? ""];
  });
  return [...properties, ...inserted].map((category) => ({ file, category }));
};

const categoryWordsInTheTestTree = (): readonly { file: string; category: string }[] =>
  testTreeFiles().flatMap((file) =>
    categoryWordsIn(readFileSync(file, "utf8"), path.basename(file)),
  );

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
    const planted = categoryWordsIn(plantedCategoryWords(), "planted.ts");

    expect(undeclared(planted)).toEqual([
      { file: "planted.ts", category: "sort-code" },
      { file: "planted.ts", category: "sort-code" },
    ]);
  });
});
