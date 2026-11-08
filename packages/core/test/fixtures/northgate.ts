import type { MigratedPostgres } from "@better-answers/schema/testing";

import {
  importBundle,
  overrideConceptSensitivity,
  writeConcept,
  type BundleTree,
  type ConceptWritten,
} from "../../src/concepts/index.ts";
import type { UserPrincipal } from "../../src/kernel/index.ts";
import { addressOf, answered, readingAs } from "../support/suite-postgres.ts";
import {
  IMPORTED,
  NORTHGATE,
  TYPED,
  VERIFIED_AT_IMPORT,
  type Concept,
  type ImportedKey,
} from "./northgate-concepts.ts";
import { groupNamed } from "./sourced-concept.ts";
import { doorsOf, memberOf, principalFor, type Scenario } from "./workspace-with-bundle.ts";

const BUNDLE_ID = "01J9NGXAMP0000000000000000";

type NorthgateKey = (typeof TYPED)[number]["key"] | ImportedKey;

export type Northgate = {
  readonly scenario: Scenario;
  readonly admin: UserPrincipal;
  readonly editor: UserPrincipal;
  readonly viewer: UserPrincipal;

  readonly finance: string;
  readonly reviewer: string;
  readonly iri: (key: NorthgateKey) => string;
};

const pathOf = (concept: Concept): string => `knowledge/${NORTHGATE.collection}/${concept.slug}.md`;

const AUTHOR = { name: "Nadia Editor", email: "nadia@northgate.invalid" } as const;

export const typedBy = async (
  editor: UserPrincipal,
  scenario: Scenario,
  concept: Concept,
): Promise<ConceptWritten> =>
  answered(
    await writeConcept(editor, doorsOf(scenario), {
      mergeKey: `${concept.conceptType}:${concept.slug}`,
      path: pathOf(concept),
      conceptType: concept.conceptType,
      title: concept.title,
      frontmatter: { title: concept.title, type: concept.conceptType, tags: [...concept.tags] },
      body: concept.body,
      message: `Record ${concept.title.toLowerCase()}`,
      author: AUTHOR,
      expects: { base: null },
      status: "stable",
      sensitivity: "Internal",
    }),
  );

const verifiedLines = (reviewer: string, times: number): string =>
  times === 0
    ? ""
    : `verified:\n${Array.from(
        { length: times },
        (_, at) => `  - { by: human:${reviewer}, at: 2026-05-1${2 + at}T09:00:00Z }`,
      ).join("\n")}\n`;

const importedFile = (concept: Concept, reviewer: string, verifications: number): string =>
  `---
type: ${concept.conceptType}
title: ${concept.title}
tags: [${concept.tags.join(", ")}]
${verifiedLines(reviewer, verifications)}---

${concept.body}
`;

export const northgateTree = (
  reviewer: string,
  verifyingAlso: readonly ImportedKey[] = [],
): BundleTree =>
  new Map([
    [
      "manifest.yaml",
      `id: ${BUNDLE_ID}\norigin: company\nref: Northgate Example Ltd's answer library\nowner: Northgate Example Ltd\ncontent_version: 2026-05-12\n`,
    ],
    ...IMPORTED.map((concept): [string, string] => {
      const verifications =
        (VERIFIED_AT_IMPORT.has(concept.key) ? 1 : 0) +
        (verifyingAlso.includes(concept.key) ? 1 : 0);
      return [
        `${NORTHGATE.collection}/${concept.slug}.md`,
        importedFile(concept, reviewer, verifications),
      ];
    }),
  ]);

export const importedBy = async (admin: UserPrincipal, scenario: Scenario, tree: BundleTree) => {
  const run = await importBundle(
    admin,
    { ...doorsOf(scenario), log: { warn: () => undefined } },
    { tree, sensitivity: "Internal" },
  );
  if (!run.ok) throw new Error(`the import was refused: ${JSON.stringify(run.error)}`);
  return run.value;
};

const iriAt = async (db: MigratedPostgres, workspaceId: string, path: string): Promise<string> => {
  const found = await db.pool.query<{ iri: string }>(
    "SELECT iri FROM concept_index WHERE workspace_id = $1 AND path = $2",
    [workspaceId, path],
  );
  const iri = found.rows[0]?.iri;
  if (iri === undefined) throw new Error(`no concept landed at ${path}`);
  return iri;
};

export const northgate = async (db: MigratedPostgres, scenario: Scenario): Promise<Northgate> => {
  const { workspaceId } = scenario;
  const finance = await groupNamed(db, scenario, "finance", [scenario.admin, scenario.editor]);
  const admin = await principalFor(db, workspaceId, scenario.admin.userId);
  const editor = await principalFor(db, workspaceId, scenario.editor.userId);
  const reviewer = addressOf("reviewer");
  await memberOf(db.pool, workspaceId, reviewer);

  const iris = new Map<NorthgateKey, string>();
  for (const concept of TYPED) {
    iris.set(concept.key, (await typedBy(editor, scenario, concept)).iri);
  }
  await importedBy(admin, scenario, northgateTree(reviewer));
  for (const concept of IMPORTED) {
    iris.set(concept.key, await iriAt(db, workspaceId, pathOf(concept)));
  }
  const iri = (key: NorthgateKey): string => {
    const found = iris.get(key);
    if (found === undefined) throw new Error(`Northgate holds no ${key}`);
    return found;
  };

  answered(
    await readingAs(db.runtimePool, admin, (principal, tx) =>
      overrideConceptSensitivity(principal, tx, {
        iri: iri("professionalIndemnity"),
        sensitivity: "Internal",
        audience: "groups",
        audienceGroups: [finance],
      }),
    ),
  );
  return {
    scenario,
    admin,
    editor,
    viewer: scenario.viewer,
    finance,
    reviewer,
    iri,
  };
};
