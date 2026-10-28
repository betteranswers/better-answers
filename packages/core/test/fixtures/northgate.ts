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
import { groupNamed } from "./sourced-concept.ts";
import { doorsOf, memberOf, principalFor, type Scenario } from "./workspace-with-bundle.ts";

export const NORTHGATE = {
  collection: "company",
  sections: 8,
  writeUps: 8,
  includesAtSeed: 24,
  includesOnceTyped: 25,
} as const;

const BUNDLE_ID = "01J9NGXAMP0000000000000000";

type Concept = {
  readonly key: string;
  readonly slug: string;
  readonly title: string;
  readonly kind: string;
  readonly tags: readonly string[];
  readonly body: string;
};

const TYPED = [
  {
    key: "registration",
    slug: "registered-company-number",
    title: "Registered company number",
    kind: "company fact",
    tags: ["registration"],
    body: "Northgate Example Ltd is registered in England and Wales under company number 00000000.",
  },
  {
    key: "headcount",
    slug: "staff-headcount",
    title: "Staff headcount",
    kind: "company fact",
    tags: ["headcount"],
    body: "Northgate employs forty-two people, thirty of them engineers.",
  },
  {
    key: "founded",
    slug: "founded-in-2009",
    title: "Founded in 2009",
    kind: "company fact",
    tags: ["founded"],
    body: "Northgate was founded in 2009 and has traded without a break since.",
  },
  {
    key: "office",
    slug: "registered-office-address",
    title: "Registered office address",
    kind: "company fact",
    tags: ["office"],
    body: "The registered office is 1 Example Street, Exampletown, EX1 1EX.",
  },
  {
    key: "managedSupport",
    slug: "managed-it-support",
    title: "Managed IT support",
    kind: "service",
    tags: [],
    body: "Northgate runs the desktops, servers and networks of organisations of up to 500 staff.",
  },
  {
    key: "cloudMigration",
    slug: "cloud-migration",
    title: "Cloud migration",
    kind: "service",
    tags: [],
    body: "Northgate moves on-premises services to hosted platforms in planned stages.",
  },
  {
    key: "publicSector",
    slug: "public-sector-bodies",
    title: "Public sector bodies",
    kind: "sector",
    tags: ["served"],
    body: "Northgate serves councils, schools and health bodies.",
  },
  {
    key: "accessControl",
    slug: "access-control",
    title: "Access control",
    kind: "practice",
    tags: ["security"],
    body: "Every account is named, holds the least access its role needs and is reviewed each quarter.",
  },
  {
    key: "patchManagement",
    slug: "patch-management",
    title: "Patch management",
    kind: "practice",
    tags: ["security"],
    body: "Critical patches are applied within fourteen days of release.",
  },
  {
    key: "penetrationTesting",
    slug: "penetration-testing",
    title: "Penetration testing",
    kind: "practice",
    tags: ["testing"],
    body: "An accredited tester attacks the external estate once a year.",
  },
  {
    key: "vulnerabilityScanning",
    slug: "vulnerability-scanning",
    title: "Vulnerability scanning",
    kind: "practice",
    tags: ["testing"],
    body: "Every host is scanned for known vulnerabilities each week.",
  },
  {
    key: "severityLevels",
    slug: "incident-severity-levels",
    title: "Incident severity levels",
    kind: "service level",
    tags: ["severity"],
    body: "A severity 1 incident is answered within thirty minutes, a severity 4 within a day.",
  },
  {
    key: "supportHours",
    slug: "support-hours",
    title: "Support hours",
    kind: "company fact",
    tags: ["support-hours"],
    body: "The service desk answers from 08:00 to 18:00 on working days.",
  },
  {
    key: "escalationPath",
    slug: "escalation-path",
    title: "Escalation path",
    kind: "practice",
    tags: ["escalation"],
    body: "An unresolved incident goes to the service manager after four hours.",
  },
] as const satisfies readonly Concept[];

const IMPORTED = [
  {
    key: "publicLiability",
    slug: "public-liability-policy",
    title: "Public liability policy",
    kind: "insurance policy",
    tags: ["public-liability"],
    body: "Northgate holds public liability cover of five million pounds.",
  },
  {
    key: "professionalIndemnity",
    slug: "professional-indemnity-policy",
    title: "Professional indemnity policy",
    kind: "insurance policy",
    tags: ["professional-indemnity"],
    body: "Northgate holds professional indemnity cover of two million pounds.",
  },
  {
    key: "accounts2024",
    slug: "filed-accounts-2024",
    title: "Filed accounts 2024",
    kind: "company fact",
    tags: ["accounts"],
    body: "The accounts for the year to March 2024 were filed on time.",
  },
  {
    key: "accounts2025",
    slug: "filed-accounts-2025",
    title: "Filed accounts 2025",
    kind: "company fact",
    tags: ["accounts"],
    body: "The accounts for the year to March 2025 were filed on time.",
  },
  {
    key: "iso27001",
    slug: "iso-27001-certificate",
    title: "ISO 27001 certificate",
    kind: "certification",
    tags: ["iso-27001"],
    body: "Northgate is certified to ISO 27001 for its whole service.",
  },
  {
    key: "cyberEssentialsPlus",
    slug: "cyber-essentials-plus-certificate",
    title: "Cyber Essentials Plus certificate",
    kind: "certification",
    tags: ["cyber-essentials-plus"],
    body: "Northgate holds Cyber Essentials Plus, renewed each year.",
  },
  {
    key: "icoRegistration",
    slug: "ico-registration",
    title: "ICO registration",
    kind: "registration",
    tags: ["data-protection"],
    body: "Northgate is registered with the Information Commissioner's Office.",
  },
  {
    key: "privacyNotice",
    slug: "privacy-notice",
    title: "Privacy notice",
    kind: "policy",
    tags: ["privacy"],
    body: "The privacy notice says what personal data Northgate holds and why.",
  },
  {
    key: "dataLocation",
    slug: "where-data-is-held",
    title: "Where data is held",
    kind: "company fact",
    tags: ["data-location"],
    body: "Customer data is held in two data centres in the United Kingdom.",
  },
] as const satisfies readonly Concept[];

const VERIFIED_AT_IMPORT: ReadonlySet<ImportedKey> = new Set([
  "publicLiability",
  "professionalIndemnity",
  "accounts2024",
  "accounts2025",
]);

export const EMPLOYERS_LIABILITY = {
  key: "employersLiability",
  slug: "employers-liability-policy",
  title: "Employers' liability policy",
  kind: "insurance policy",
  tags: ["employers-liability"],
  body: "Northgate holds employers' liability cover of ten million pounds.",
} as const satisfies Concept;

type ImportedKey = (typeof IMPORTED)[number]["key"];

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
      mergeKey: `${concept.kind}:${concept.slug}`,
      path: pathOf(concept),
      kind: concept.kind,
      title: concept.title,
      frontmatter: { title: concept.title, type: concept.kind, tags: [...concept.tags] },
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
type: ${concept.kind}
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
