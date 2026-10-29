import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { type TestData, testData } from "./support/factory.ts";
import { type MigratedPostgres, withRollback } from "./support/harness.ts";
import { repositoryRoot } from "./support/roots/roots.ts";
import { openMigratedPostgres } from "./support/warm-postgres.ts";

const contractsDir = path.resolve(repositoryRoot, "contracts");
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

const quotedAfter = (character: string, quoted: boolean): boolean =>
  quoted ? character !== "'" : character === "'";

const depthAfter = (character: string, depth: number): number | "closed" => {
  if (character === "(") return depth + 1;
  if (character !== ")") return depth;
  return depth > 0 ? depth - 1 : "closed";
};

const rowItems = (afterTheOpeningBracket: string): readonly string[] => {
  const items: string[] = [];
  let item = "";
  let depth = 0;
  let quoted = false;
  for (const character of afterTheOpeningBracket) {
    const inAString = quoted || character === "'";
    quoted = quotedAfter(character, quoted);
    if (!inAString) {
      const next = depthAfter(character, depth);
      if (next === "closed") return [...items, item];
      if (character === "," && depth === 0) {
        items.push(item);
        item = "";
        continue;
      }
      depth = next;
    }
    item += character;
  }
  return [...items, item];
};

const CATEGORY_PROPERTY = /\bcategory:\s*"([^"]*)"/g;
const FINDING_ROW_PATTERN = /INSERT INTO finding\s*\(([^)]*)\)\s*VALUES\s*\(/g;
const SQL_STRING = /^'(.*)'$/;

const PLANTED_CATEGORY = "sort-code";
const FINDING_TABLE_NAMED_APART_FROM_THE_RAW_INSERT_SCAN = "finding";

const plantedCategoryWords = (): string =>
  `{ ...row, category: "${PLANTED_CATEGORY}", tier: "always" },
       INSERT INTO ${FINDING_TABLE_NAMED_APART_FROM_THE_RAW_INSERT_SCAN} (workspace_id, id, category, tier, rule_id)
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

const seedingInOneDocument = <T>(
  work: (
    seed: TestData,
    inDocument: { readonly workspaceId: string; readonly documentId: string },
  ) => Promise<T>,
): Promise<T> =>
  withRollback(db.pool, async (client) => {
    const seed = testData(client);
    const document = await seed.sourceDocument();
    return work(seed, { workspaceId: document.workspaceId, documentId: document.id });
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
  it("starts each document's spans at nought, whatever was seeded before", async () => {
    const spans = await withRollback(db.pool, async (client) => {
      const seed = testData(client);
      const first = await seed.finding();
      const besideIt = await seed.finding({
        workspaceId: first.workspaceId,
        documentId: first.documentId,
      });
      const elsewhere = await seed.finding({ workspaceId: first.workspaceId });
      return [first, besideIt, elsewhere].map((row) => [row.charStart, row.charEnd]);
    });

    expect(spans).toEqual([
      [0, 8],
      [8, 16],
      [0, 8],
    ]);
  });

  it("lands two defaults seeded at once on separate spans", async () => {
    const spans = await seedingInOneDocument(async (seed, inDocument) => {
      const both = await Promise.all([seed.finding(inDocument), seed.finding(inDocument)]);
      return both.map((row) => [row.charStart, row.charEnd]);
    });

    expect(spans).toEqual([
      [0, 8],
      [8, 16],
    ]);
  });

  it("seeds again on the same connection after a refused finding", async () => {
    const spans = await seedingInOneDocument(async (seed, inDocument) => {
      await expect(seed.finding({ ...inDocument, score: 2 })).rejects.toThrow(/score/);
      const after = await seed.finding(inDocument);
      return [after.charStart, after.charEnd];
    });

    expect(spans).toEqual([0, 8]);
  });

  it("lands past every span its document already holds", async () => {
    const spans = await withRollback(db.pool, async (client) => {
      const seed = testData(client);
      const byHand = await seed.finding({ charStart: 8, charEnd: 16 });
      const defaulted = await seed.finding({
        workspaceId: byHand.workspaceId,
        documentId: byHand.documentId,
      });
      return [byHand, defaulted].map((row) => [row.charStart, row.charEnd]);
    });

    expect(spans).toEqual([
      [8, 16],
      [16, 24],
    ]);
  });
});

describe("the category words this package's tests spell by hand", () => {
  it("names only declared categories, in every file of the tree", () => {
    const written = categoryWordsInTheTestTree();

    expect(written.length).toBeGreaterThanOrEqual(CATEGORY_WORDS_IN_THE_TREE);
    expect(undeclared(written)).toEqual([]);
  });

  it("names an undeclared word written either way", () => {
    const planted = categoryWordsIn(plantedCategoryWords(), "planted.ts");

    expect(undeclared(planted)).toEqual([
      { file: "planted.ts", category: "sort-code" },
      { file: "planted.ts", category: "sort-code" },
    ]);
  });
});
