import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import { BUNDLE_MANIFEST_PATH, ulid } from "@better-answers/schema";
import { matching } from "@better-answers/schema/testing/matching";

import { zipOf, type ZipEntry } from "../../src/concepts/export-zip.ts";
import {
  exportBundleSnapshot,
  exportGuideInput,
  exportGuideSnapshot,
  exportRecords,
} from "../../src/concepts/index.ts";
import { readGuide, saveBrief, seedGuide } from "../../src/guides/index.ts";
import type { Role, UserPrincipal } from "../../src/kernel/index.ts";
import { bundleHistory, commitFacts, fileAtCommit, treeCommitted } from "../fixtures/bundle.ts";
import { shelveOne } from "../fixtures/concept-shelf.ts";
import { bundleIndexed, type BundleIndexed } from "../fixtures/indexed-bundle.ts";
import { IMPORTED, NORTHGATE, TYPED } from "../fixtures/northgate-concepts.ts";
import { northgate, type Northgate } from "../fixtures/northgate.ts";
import { groupNamed } from "../fixtures/sourced-concept.ts";
import { usesOfAConcept } from "../fixtures/usage-rows.ts";
import {
  doorsOf,
  principalFor,
  suiteWithBundles,
  type Scenario,
} from "../fixtures/workspace-with-bundle.ts";
import { zipEntries } from "../fixtures/zip-entries.ts";
import { whileGitPausesAt } from "../store/git/git-starts.ts";
import { answered, readingAs, seedingWith } from "../support/suite-postgres.ts";

const run = promisify(execFile);

const { db, arrange } = suiteWithBundles();

const AT = new Date("2026-06-01T23:30:00Z");

const CONFIRMED_BEFORE_MS = 5 * 60 * 1000;

const STALE_BY_MS = 61 * 60 * 1000;

const once = <T>(make: () => Promise<T>): (() => Promise<T>) => {
  let held: Promise<T> | undefined;
  return () => (held ??= make());
};

const confirmed = (principal: UserPrincipal, before = CONFIRMED_BEFORE_MS): UserPrincipal => ({
  ...principal,
  secondFactorConfirmedAtMs: AT.getTime() - before,
});

const memberAs = async (scenario: Scenario, role: Role, group?: string) => {
  const { workspaceId } = scenario;
  const userId = await seedingWith(db().pool, async (seed) => {
    const person = await seed.user();
    await seed.member({ workspaceId, userId: person.id, role });
    if (group !== undefined)
      await seed.groupMember({ workspaceId, groupId: group, userId: person.id });
    return person.id;
  });
  return confirmed(await principalFor(db(), workspaceId, userId));
};

const nameOf = async (userId: string): Promise<string> =>
  (await db().pool.query<{ name: string }>('SELECT name FROM "user" WHERE id = $1', [userId]))
    .rows[0]?.name ?? "";

const snapshotOf = (as: UserPrincipal, scenario: Scenario) =>
  exportBundleSnapshot(as, scenario, { at: AT });

const recordsOf = (as: UserPrincipal, scenario: Scenario) =>
  exportRecords(as, scenario.postgres, { at: AT });

const csvLinesOf = (zip: Uint8Array, name: string): readonly string[] =>
  (zipEntries(zip).get(name)?.toString("utf8") ?? "")
    .replace(/^\u{FEFF}/u, "")
    .split("\r\n")
    .slice(0, -1);

const exportEventsBy = async (scenario: Scenario, as: UserPrincipal) =>
  (
    await db().pool.query<{ action: string; subject_id: string; detail: unknown }>(
      `SELECT action, subject_id, detail FROM audit_event
        WHERE workspace_id = $1 AND actor = $2 AND action LIKE 'knowledge.%.exported'
        ORDER BY action`,
      [scenario.workspaceId, `human:${as.userId}`],
    )
  ).rows;

const usageBy = async (scenario: Scenario, as: UserPrincipal) =>
  (
    await db().pool.query<{ write_up_id: string; write_up_version: number; act: string }>(
      `SELECT write_up_id, write_up_version, act FROM usage
        WHERE workspace_id = $1 AND actor = $2 ORDER BY write_up_id`,
      [scenario.workspaceId, `human:${as.userId}`],
    )
  ).rows;

const OVERVIEW = "Company overview";

const INSURANCE = "Insurance and financial standing";

const COVER = "We hold every cover a buyer asks for.";

type Briefed = { readonly writeUpId: string; readonly version: number };

type GuideSetup = {
  readonly ng: Northgate;
  readonly scenario: Scenario;
  readonly guideId: string;
  readonly overview: Briefed;
  readonly insurance: Briefed;
};

const briefSaved = async (
  writer: UserPrincipal,
  scenario: Scenario,
  guideId: string,
  prompt: string,
  markdownOf: (labels: readonly string[]) => string,
): Promise<Briefed> => {
  const guide = answered(
    await readingAs(db().runtimePool, writer, (editor, tx) => readGuide(editor, tx, { guideId })),
  );
  const section = guide?.sections.find((each) => each.prompt === prompt);
  const labels = section?.brief?.editable?.footnotes.map(({ label }) => label) ?? [];
  if (section?.brief === undefined) throw new Error(`no Brief to write at ${prompt}`);
  const saved = answered(
    await saveBrief(writer, doorsOf(scenario), {
      writeUpId: section.writeUpId,
      markdown: markdownOf(labels),
      base: section.brief.version,
    }),
  );
  return { writeUpId: section.writeUpId, version: saved.version };
};

const briefWith = (
  ng: Northgate,
  guideId: string,
  prompt: string,
  sentence: string,
): Promise<Briefed> =>
  briefSaved(ng.editor, ng.scenario, guideId, prompt, (labels) =>
    labels.map((label) => `${sentence}[^${label}]`).join("\n\n"),
  );

const guideSetup = once(async (): Promise<GuideSetup> => {
  const scenario = await arrange();
  const ng = await northgate(db(), scenario);
  const { guideId } = answered(
    await seedGuide(ng.admin, doorsOf(scenario), {
      templateId: "bid-library",
      collection: NORTHGATE.collection,
      subjectIri: null,
    }),
  );
  const overview = await briefWith(ng, guideId, OVERVIEW, "Northgate has traded since 2009.");
  const insurance = await briefWith(ng, guideId, INSURANCE, COVER);
  const indemnity = ng.iri("professionalIndemnity");
  await seedingWith(db().pool, async (seed) => {
    const { workspaceId } = scenario;
    await seed.conceptOwner({ workspaceId, iri: indemnity, personId: ng.viewer.userId });
    await seed.usage({ workspaceId, iri: indemnity });
    await seed.usage({
      workspaceId,
      writeUpId: insurance.writeUpId,
      writeUpVersion: insurance.version,
    });
  });
  return { ng, scenario, guideId, overview, insurance };
});

const guideOf = (as: UserPrincipal, setup: GuideSetup, guideId = setup.guideId) =>
  exportGuideSnapshot(as, setup.scenario.postgres, { guideId, at: AT });

const everyExportOf = async (as: UserPrincipal, setup: GuideSetup) => [
  await snapshotOf(as, setup.scenario),
  await recordsOf(as, setup.scenario),
  await guideOf(as, setup),
];

describe("who may export", () => {
  it("refuses every export to an owning Editor", async () => {
    const setup = await guideSetup();
    const { scenario } = setup;
    const person = await memberAs(scenario, "Editor", setup.ng.finance);
    await seedingWith(db().pool, (seed) =>
      seed.conceptOwner({
        workspaceId: scenario.workspaceId,
        collection: "tenders",
        personId: person.userId,
      }),
    );

    const refused = await everyExportOf(person, setup);
    const left = {
      events: await exportEventsBy(scenario, person),
      usage: await usageBy(scenario, person),
    };
    await db().pool.query(
      "UPDATE member SET role = 'Admin' WHERE workspace_id = $1 AND user_id = $2",
      [scenario.workspaceId, person.userId],
    );
    const promoted = confirmed(await principalFor(db(), scenario.workspaceId, person.userId));
    const admitted = await everyExportOf(promoted, setup);

    expect(refused).toEqual(
      Array.from({ length: 3 }, () => ({ ok: false, error: "role-forbids" })),
    );
    expect(left).toEqual({ events: [], usage: [] });
    expect(admitted.map(({ ok }) => ok)).toEqual([true, true, true]);
  });

  it("refuses an export past its confirmation window", async () => {
    const setup = await guideSetup();
    const admin = await memberAs(setup.scenario, "Admin", setup.ng.finance);
    const stale = confirmed(admin, STALE_BY_MS);

    const refused = await everyExportOf(stale, setup);

    expect(refused).toEqual(
      Array.from({ length: 3 }, () => ({ ok: false, error: "confirmation-too-old" })),
    );
    expect(await exportEventsBy(setup.scenario, admin)).toEqual([]);
    expect(await usageBy(setup.scenario, admin)).toEqual([]);
  });

  it("refuses every export to an Admin removed from the workspace", async () => {
    const setup = await guideSetup();
    const admin = await memberAs(setup.scenario, "Admin", setup.ng.finance);
    await db().pool.query("DELETE FROM member WHERE workspace_id = $1 AND user_id = $2", [
      setup.scenario.workspaceId,
      admin.userId,
    ]);

    const refused = await everyExportOf(admin, setup);

    expect(refused).toEqual(
      Array.from({ length: 3 }, () => ({ ok: false, error: "not-a-member" })),
    );
    expect(await exportEventsBy(setup.scenario, admin)).toEqual([]);
    expect(await usageBy(setup.scenario, admin)).toEqual([]);
  });
});

describe("what an export records", () => {
  it("writes one audit event for each export", async () => {
    const setup = await guideSetup();
    const { scenario } = setup;
    const admin = await memberAs(scenario, "Admin", setup.ng.finance);

    const snapshot = answered(await snapshotOf(admin, scenario));
    const records = answered(await recordsOf(admin, scenario));
    const guide = answered(await guideOf(admin, setup));

    const rowsIn = (name: string) => csvLinesOf(records.zip, name).length - 1;
    expect(snapshot.head).toBe((await bundleHistory(scenario.git, scenario.workspaceId)).at(-1));
    expect(snapshot.files).toBe(zipEntries(snapshot.zip).size);
    expect(await exportEventsBy(scenario, admin)).toEqual([
      {
        action: "knowledge.bundle.exported",
        subject_id: scenario.workspaceId,
        detail: { commitSha: snapshot.head, files: snapshot.files },
      },
      {
        action: "knowledge.guide.exported",
        subject_id: setup.guideId,
        detail: { guideId: setup.guideId, sections: guide.sections },
      },
      {
        action: "knowledge.records.exported",
        subject_id: scenario.workspaceId,
        detail: {
          owners: rowsIn("owners.csv"),
          verifications: rowsIn("verifications.csv"),
          usage: rowsIn("usage.csv"),
        },
      },
    ]);
  });

  it("writes one usage row per write-up for a guide snapshot", async () => {
    const setup = await guideSetup();
    const admin = await memberAs(setup.scenario, "Admin", setup.ng.finance);

    answered(await snapshotOf(admin, setup.scenario));
    answered(await recordsOf(admin, setup.scenario));
    const guide = answered(await guideOf(admin, setup));

    expect(guide.sections).toBe(2);
    expect(await usageBy(setup.scenario, admin)).toEqual(
      [setup.overview, setup.insurance]
        .map(({ writeUpId, version }) => ({
          write_up_id: writeUpId,
          write_up_version: version,
          act: "exported",
        }))
        .toSorted((one, other) => one.write_up_id.localeCompare(other.write_up_id)),
    );
  });
});

describe("a guide snapshot", () => {
  it("dates each Brief, names its trust, marks itself unmaintained", async () => {
    const setup = await guideSetup();
    const admin = await memberAs(setup.scenario, "Admin", setup.ng.finance);

    const guide = answered(await guideOf(admin, setup));

    expect(guide.name).toBe("guide-company-2026-06-02.md");
    expect(guide.markdown).toMatch(
      /^# company\n\nGuide snapshot, 2 June 2026\. Not maintained\. It does not change/u,
    );
    expect(guide.markdown).toMatch(
      new RegExp(
        String.raw`\n## \d+ ${INSURANCE}\n\n\*[^*\n]+\*\n\n` +
          String.raw`(We hold every cover a buyer asks for\.\[\d\]\n\n)+\*\*Sources\*\*\n\n1\. `,
        "u",
      ),
    );
    expect(guide.markdown).toContain("Professional indemnity policy.");
  });

  it("says how many sections it leaves out", async () => {
    const setup = await guideSetup();
    const outsider = await memberAs(setup.scenario, "Admin");
    const insider = await memberAs(setup.scenario, "Admin", setup.ng.finance);
    const leftOut = (markdown: string): number =>
      Number(
        /\n\n(\d+) sections? (?:is|are) left out, because you cannot read/u.exec(markdown)?.[1],
      );

    const outside = answered(await guideOf(outsider, setup)).markdown;
    const inside = answered(await guideOf(insider, setup)).markdown;

    expect(leftOut(outside)).toBeGreaterThan(leftOut(inside));
    expect(outside).toMatch(/\n\n\d+ sections are left out, because you cannot read them/u);
  });

  it("reports an unknown guide as not found", async () => {
    const setup = await guideSetup();
    const admin = await memberAs(setup.scenario, "Admin");

    expect(await guideOf(admin, setup, ulid())).toEqual({ ok: false, error: "not-found" });
    expect(await exportEventsBy(setup.scenario, admin)).toEqual([]);
  });

  it("accepts a guide id and nothing else", () => {
    expect(exportGuideInput.safeParse({ guideId: ulid() }).success).toBe(true);
    expect(exportGuideInput.safeParse({}).success).toBe(false);
    expect(exportGuideInput.safeParse({ guideId: ulid(), colour: "red" }).success).toBe(false);
  });
});

const conceptGuideSnapshot = once(async () => {
  const scenario = await arrange();
  const subjectIri = await shelveOne(db().pool, scenario.workspaceId, {
    path: "knowledge/company/smith-and-jones.md",
    title: "“Smith & Jones” bids (2026)!",
  });
  const { guideId } = answered(
    await seedGuide(scenario.admin, doorsOf(scenario), {
      templateId: "bid-library",
      collection: "company",
      subjectIri,
    }),
  );
  const writer = await principalFor(db(), scenario.workspaceId, scenario.editor.userId);
  await briefSaved(writer, scenario, guideId, "Security testing", () => "We test every quarter.");
  await briefSaved(writer, scenario, guideId, "What we offer", () => " \n");
  const admin = await memberAs(scenario, "Admin");
  return answered(await exportGuideSnapshot(admin, scenario.postgres, { guideId, at: AT }));
});

describe("a guide snapshot about a concept", () => {
  it("names the file after the concept, in plain words", async () => {
    const guide = await conceptGuideSnapshot();

    expect(guide.name).toBe("guide-smith-jones-bids-2026-2026-06-02.md");
    expect(guide.markdown).toMatch(/^# “Smith & Jones” bids \(2026\)!\n/u);
  });

  it("puts a sub-section's heading one level below its section", async () => {
    const guide = await conceptGuideSnapshot();

    expect(guide.markdown).toContain("\n### 6.1 Security testing\n\n");
  });

  it("leaves out a section whose Brief is blank", async () => {
    const guide = await conceptGuideSnapshot();

    expect(guide.sections).toBe(1);
    expect(guide.markdown).not.toContain("What we offer");
  });
});

describe("an Admin outside a concept's audience", () => {
  it("exports nothing of a concept outside the Admin's audience", async () => {
    const setup = await guideSetup();
    const outsider = await memberAs(setup.scenario, "Admin");
    const insider = await memberAs(setup.scenario, "Admin", setup.ng.finance);
    const withheld = [
      `knowledge/${NORTHGATE.collection}/professional-indemnity-policy.md`,
      setup.ng.iri("professionalIndemnity"),
      "Professional indemnity policy",
      setup.insurance.writeUpId,
      COVER,
    ];
    const carriedBy = async (as: UserPrincipal): Promise<string> => {
      const zips = [
        answered(await snapshotOf(as, setup.scenario)),
        answered(await recordsOf(as, setup.scenario)),
      ];
      const files = zips.flatMap(({ zip }) => [...zipEntries(zip)]);
      const { markdown } = answered(await guideOf(as, setup));
      return [...files.flatMap(([name, bytes]) => [name, bytes.toString("utf8")]), markdown].join(
        "\n",
      );
    };

    const outside = await carriedBy(outsider);
    const inside = await carriedBy(insider);

    expect(withheld.filter((word) => outside.includes(word))).toEqual([]);
    expect(withheld.filter((word) => inside.includes(word))).toEqual(withheld);
  });
});

describe("the knowledge base snapshot", () => {
  it("holds every concept file and no skeleton", async () => {
    const setup = await guideSetup();
    const { git, workspaceId } = setup.scenario;
    const admin = await memberAs(setup.scenario, "Admin", setup.ng.finance);

    const snapshot = answered(await snapshotOf(admin, setup.scenario));

    const entries = zipEntries(snapshot.zip);
    const tree = (await commitFacts(git, workspaceId, snapshot.head)).files;
    const concepts = [...TYPED, ...IMPORTED].map(
      ({ slug }) => `knowledge/${NORTHGATE.collection}/${slug}.md`,
    );
    expect(tree).toContain(`guides/${setup.guideId}.yaml`);
    expect(snapshot.name).toBe("knowledge-base-2026-06-02.zip");
    expect([...entries.keys()]).toEqual([BUNDLE_MANIFEST_PATH, ...concepts].toSorted());
    expect(entries.get(BUNDLE_MANIFEST_PATH)?.toString("utf8")).toBe(
      await fileAtCommit(git, workspaceId, snapshot.head, BUNDLE_MANIFEST_PATH),
    );
  });
});

const EXPENSES = "knowledge/policies/expenses.md";

const VETTING = "knowledge/policies/vetting.md";

const SALARIES = "knowledge/policies/salaries.md";

const FORMULA = "knowledge/policies/formula.md";

const ORPHAN = "knowledge/policies/orphan.md";

const FORMULA_TITLE = '=HYPERLINK("https://example.invalid")';

type KnowledgeBaseSetup = {
  readonly scenario: Scenario;
  readonly bundle: BundleIndexed;
  readonly finance: string;
};

const KNOWLEDGE_BASE_FILES: ReadonlyMap<string, string> = new Map([
  [BUNDLE_MANIFEST_PATH, "owner: Acme\n"],
  [EXPENSES, "Claim within thirty days.\n"],
  [VETTING, "Every hire is vetted.\n"],
  [SALARIES, "Pay bands.\n"],
  [FORMULA, "A title a spreadsheet would run.\n"],
  [ORPHAN, "No index row names this file.\n"],
  ["guides/01K4GUIDE0000000000000000.yaml", "sections: []\n"],
]);

const knowledgeBaseSetup = async (): Promise<KnowledgeBaseSetup> => {
  const scenario = await arrange();
  const finance = await groupNamed(db(), scenario, "finance", [scenario.editor]);
  const bundle = await bundleIndexed(db(), scenario, KNOWLEDGE_BASE_FILES, [
    { path: EXPENSES, title: "Expenses", sensitivity: "Internal", audienceGroups: null },
    { path: VETTING, title: "Vetting", sensitivity: "Restricted", audienceGroups: null },
    { path: SALARIES, title: "Salary bands", sensitivity: "Internal", audienceGroups: [finance] },
    { path: FORMULA, title: FORMULA_TITLE, sensitivity: "Internal", audienceGroups: null },
  ]);
  const { workspaceId, viewer, editor } = scenario;
  await seedingWith(db().pool, async (seed) => {
    for (const held of [EXPENSES, VETTING, SALARIES, FORMULA]) {
      await seed.conceptOwner({ workspaceId, iri: bundle.iriOf(held), personId: viewer.userId });
    }
    for (const held of [EXPENSES, SALARIES, FORMULA]) {
      const iri = bundle.iriOf(held);
      await seed.conceptVerification({ workspaceId, iri, actor: `human:${editor.userId}` });
    }
    await seed.usage({ workspaceId, iri: bundle.iriOf(EXPENSES), actor: `human:${editor.userId}` });
    await seed.usage({ workspaceId, iri: bundle.iriOf(SALARIES), actor: `human:${editor.userId}` });
  });
  return { scenario, bundle, finance };
};

const sharedKnowledgeBaseSetup = once(knowledgeBaseSetup);

describe("a knowledge base an Admin partly reads", () => {
  it("leaves out a file that has no index row", async () => {
    const { scenario } = await sharedKnowledgeBaseSetup();
    const admin = await memberAs(scenario, "Admin");

    const snapshot = answered(await snapshotOf(admin, scenario));

    expect([...zipEntries(snapshot.zip).keys()]).toEqual([
      BUNDLE_MANIFEST_PATH,
      EXPENSES,
      FORMULA,
      VETTING,
    ]);
  });

  it("exports a Restricted concept for an Admin", async () => {
    const { scenario, bundle } = await sharedKnowledgeBaseSetup();
    const admin = await memberAs(scenario, "Admin");

    const snapshot = answered(await snapshotOf(admin, scenario));
    const records = answered(await recordsOf(admin, scenario));

    expect(zipEntries(snapshot.zip).get(VETTING)?.toString("utf8")).toBe("Every hire is vetted.\n");
    expect(
      csvLinesOf(records.zip, "owners.csv").filter((line) => line.includes(bundle.iriOf(VETTING))),
    ).toHaveLength(1);
  });

  it("names each owner, verification and use in the records", async () => {
    const { scenario, bundle } = await sharedKnowledgeBaseSetup();
    const admin = await memberAs(scenario, "Admin");
    const [editor, viewer] = [scenario.editor.userId, scenario.viewer.userId];
    const [editorName, viewerName] = [await nameOf(editor), await nameOf(viewer)];

    const records = answered(await recordsOf(admin, scenario));

    expect(records.name).toBe("records-2026-06-02.zip");
    expect(records.families).toEqual(["owners", "verifications", "usage"]);
    expect(zipEntries(records.zip).get("owners.csv")?.subarray(0, 3)).toEqual(
      Buffer.from([0xef, 0xbb, 0xbf]),
    );
    expect(csvLinesOf(records.zip, "owners.csv")).toEqual([
      `"Owner of","Collection","Concept","Title","Person id","Person"`,
      `"collection","policies","","","${editor}","${editorName}"`,
      `"concept","policies","${bundle.iriOf(FORMULA)}","'=HYPERLINK(""https://example.invalid"")","${viewer}","${viewerName}"`,
      `"concept","policies","${bundle.iriOf(EXPENSES)}","Expenses","${viewer}","${viewerName}"`,
      `"concept","policies","${bundle.iriOf(VETTING)}","Vetting","${viewer}","${viewerName}"`,
    ]);
    expect(
      csvLinesOf(records.zip, "verifications.csv")
        .slice(1)
        .map((line) => [/^"([^"]*)"/u.exec(line)?.[1], line.includes(`"${editorName}"`)])
        .toSorted(),
    ).toEqual(
      [
        [bundle.iriOf(EXPENSES), true],
        [bundle.iriOf(FORMULA), true],
      ].toSorted(),
    );
    expect(csvLinesOf(records.zip, "usage.csv").slice(1)).toEqual([
      matching.stringMatching(
        new RegExp(
          String.raw`^"","","${bundle.iriOf(EXPENSES)}","copied","${editorName}","[^"]+"$`,
          "u",
        ),
      ),
    ]);
  });

  it("neutralises a CSV cell that starts with =", async () => {
    const { scenario, bundle } = await sharedKnowledgeBaseSetup();
    const admin = await memberAs(scenario, "Admin");

    const records = answered(await recordsOf(admin, scenario));

    const formulaLines = ["owners.csv", "verifications.csv"].flatMap((name) =>
      csvLinesOf(records.zip, name).filter((line) => line.includes(bundle.iriOf(FORMULA))),
    );
    expect(formulaLines).toHaveLength(2);
    expect(
      formulaLines.every((line) => line.includes(`"'=HYPERLINK(""https://example.invalid"")"`)),
    ).toBe(true);
  });

  it("refuses a knowledge base over its byte cap", async () => {
    const { scenario } = await sharedKnowledgeBaseSetup();
    const admin = await memberAs(scenario, "Admin");

    const refused = await exportBundleSnapshot(
      admin,
      { git: { ...scenario.git, snapshotBytesMax: 10 }, postgres: scenario.postgres },
      { at: AT },
    );

    expect(refused).toEqual({ ok: false, error: "export-too-large" });
    expect(await exportEventsBy(scenario, admin)).toEqual([]);
  });
});

describe("a knowledge base whose head cannot be exported", () => {
  it("refuses a head the store never recorded", async () => {
    const scenario = await arrange();
    await bundleIndexed(db(), scenario, new Map([[EXPENSES, "Claim.\n"]]), [
      { path: EXPENSES, title: "Expenses", sensitivity: "Internal", audienceGroups: null },
    ]);
    await treeCommitted(
      scenario.git,
      scenario.workspaceId,
      new Map([[EXPENSES, "Late.\n"]]),
      "Late",
    );
    const admin = await memberAs(scenario, "Admin");

    expect(await snapshotOf(admin, scenario)).toEqual({ ok: false, error: "unrecorded-head" });
    expect(await exportEventsBy(scenario, admin)).toEqual([]);
  });

  it("reports a knowledge base with no commit as not found", async () => {
    const scenario = await arrange();
    const admin = await memberAs(scenario, "Admin");

    expect(await snapshotOf(admin, scenario)).toEqual({ ok: false, error: "not-found" });
  });
});

const FINANCE_ONLY = "FINANCE ONLY: the board approved a 40% cut.\n";

const landedAfter = async (
  { scenario, bundle }: KnowledgeBaseSetup,
  changed: ReadonlyMap<string, string>,
) => {
  const { git, workspaceId } = scenario;
  const sha = await treeCommitted(
    git,
    workspaceId,
    new Map([...KNOWLEDGE_BASE_FILES, ...changed]),
    "Land",
  );
  await seedingWith(db().pool, (seed) =>
    seed.bundleCommit({ workspaceId, sha, parentSha: bundle.head }),
  );
};

const zipText = (zip: Uint8Array): string =>
  [...zipEntries(zip)].map(([name, bytes]) => `${name}\n${bytes.toString("utf8")}`).join("\n");

describe("an export while a change is landing", () => {
  it("leaves out a narrowing that lands as the export starts", async () => {
    const setup = await knowledgeBaseSetup();
    const { scenario, bundle, finance } = setup;
    const admin = await memberAs(scenario, "Admin");

    const snapshot = await whileGitPausesAt(
      { subcommand: "rev-parse", after: false },
      () => snapshotOf(admin, scenario),
      async () => {
        await db().pool.query(
          `UPDATE concept_index SET audience = 'groups', audience_groups = ARRAY[$3]
            WHERE workspace_id = $1 AND iri = $2`,
          [scenario.workspaceId, bundle.iriOf(EXPENSES), finance],
        );
        await landedAfter(setup, new Map([[EXPENSES, FINANCE_ONLY]]));
      },
    );

    const { zip } = answered(snapshot);
    expect([...zipEntries(zip).keys()]).toEqual([BUNDLE_MANIFEST_PATH, FORMULA, VETTING]);
    expect(zipText(zip)).not.toContain(FINANCE_ONLY);
  });

  it("refuses when a commit lands after the head is read", async () => {
    const setup = await knowledgeBaseSetup();
    const { scenario, bundle } = setup;
    const admin = await memberAs(scenario, "Admin");
    const movedTo = (from: string, to: string) =>
      db().pool.query("UPDATE concept_index SET path = $3 WHERE workspace_id = $1 AND iri = $2", [
        scenario.workspaceId,
        bundle.iriOf(from),
        to,
      ]);

    const snapshot = await whileGitPausesAt(
      { subcommand: "rev-parse", after: true },
      () => snapshotOf(admin, scenario),
      async () => {
        await movedTo(SALARIES, "knowledge/policies/moving.md");
        await movedTo(EXPENSES, SALARIES);
        await movedTo(SALARIES, EXPENSES);
        await landedAfter(
          setup,
          new Map([
            [EXPENSES, "Pay bands.\n"],
            [SALARIES, "Claim within thirty days.\n"],
          ]),
        );
      },
    );

    expect(snapshot).toEqual({ ok: false, error: "unrecorded-head" });
    expect(await exportEventsBy(scenario, admin)).toEqual([]);
    expect(zipText(answered(await snapshotOf(admin, scenario)).zip)).not.toContain("Pay bands.");
  });
});

describe("records over their row cap", () => {
  it("keeps a record family's newest 50,000 rows and says so", async () => {
    const scenario = await arrange();
    const iri = await shelveOne(db().pool, scenario.workspaceId, {
      path: "knowledge/policies/expenses.md",
    });
    const admin = await memberAs(scenario, "Admin");
    const usedOlder = (from: number, to: number) =>
      usesOfAConcept(db().pool, {
        workspaceId: scenario.workspaceId,
        actor: `human:${admin.userId}`,
        before: AT,
        iri,
        from,
        to,
      });
    const usageLines = async () =>
      csvLinesOf(answered(await recordsOf(admin, scenario)).zip, "usage.csv");

    await usedOlder(1, 50_000);
    const atTheCap = await usageLines();
    await usedOlder(50_001, 50_001);
    const pastTheCap = await usageLines();

    expect(atTheCap).toHaveLength(50_001);
    expect(atTheCap.at(-1)).toMatch(/^"","","[^"]+","copied",/u);
    expect(pastTheCap).toHaveLength(50_002);
    expect(pastTheCap.at(-2)).toBe(atTheCap.at(-1));
    expect(pastTheCap.at(-1)).toBe(
      `"The export stopped at 50,000 rows. The rest are not in this file."`,
    );
  });
});

const NOT_UTF8 = Uint8Array.of(0xff, 0xfe, 0x00, 0x80, 0x0a, 0xc3);

const ENTRIES: readonly ZipEntry[] = [
  {
    path: "knowledge/policies/repeated.md",
    bytes: Buffer.from("Claim within thirty days. ".repeat(400)),
  },
  { path: "knowledge/policies/binary.bin", bytes: NOT_UTF8 },
  { path: "knowledge/policies/empty.md", bytes: new Uint8Array() },
  { path: "knowledge/manifest.yaml", bytes: Buffer.from("owner: Acme\n") },
];

const onDisk = async <T>(zip: Uint8Array, read: (file: string) => Promise<T>): Promise<T> => {
  const scratch = await mkdtemp(path.join(tmpdir(), "better-answers-zip-"));
  const file = path.join(scratch, "export.zip");
  try {
    await writeFile(file, zip);
    return await read(file);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
};

const unzipped = (zip: Uint8Array) =>
  onDisk(zip, async (file) => {
    const tested = await run("unzip", ["-tq", file]);
    const names = (await run("unzip", ["-Z1", file])).stdout.split("\n").filter(Boolean);
    const contents = await Promise.all(
      names.map(
        async (name) => (await run("unzip", ["-p", file, name], { encoding: "buffer" })).stdout,
      ),
    );
    return { tested: tested.stdout.trim(), files: names.map((name, at) => [name, contents[at]]) };
  });

const DESCRIBED = new Map([
  ["compression method", "method"],
  ["version of encoding software", "madeBy"],
  ["minimum software version required to extract", "needs"],
  ["file last modified on (DOS date/time)", "modified"],
]);

/** What `zipinfo -v` reports of each entry's central directory record. */
const describedBy = (zip: Uint8Array): Promise<readonly Record<string, string>[]> =>
  onDisk(zip, async (file) =>
    (await run("unzip", ["-Zv", file])).stdout
      .split(/Central directory entry #\d+:\n-+\n/u)
      .slice(1)
      .map((entry) => {
        const [name = "", ...lines] = entry.trim().split("\n");
        const fields = lines.flatMap((line): (readonly [string, string])[] => {
          const [, label = "", value = ""] = /^\s*([^:]+):\s{2,}(.+)$/u.exec(line) ?? [];
          const key = DESCRIBED.get(label);
          return key === undefined ? [] : [[key, value]];
        });
        return { name, ...Object.fromEntries(fields) };
      }),
  );

describe("the export's zip file", () => {
  it("round-trips through unzip", async () => {
    const zip = answered(zipOf(ENTRIES, AT));

    expect(await unzipped(zip)).toEqual({
      tested: matching.stringMatching(/^No errors detected/u),
      files: ENTRIES.map(({ path: name, bytes }) => [name, Buffer.from(bytes)]).toSorted(),
    });
  });

  it("names a file in UTF-8 and reads it back", () => {
    const zip = answered(zipOf([{ path: "knowledge/café/naïve.md", bytes: NOT_UTF8 }], AT));

    expect([...zipEntries(zip)]).toEqual([["knowledge/café/naïve.md", Buffer.from(NOT_UTF8)]]);
  });

  it("writes the same bytes for the same files every time", () => {
    expect(zipOf(ENTRIES.toReversed(), AT)).toEqual(zipOf(ENTRIES, AT));
  });

  it("holds 65,535 entries and refuses one more", () => {
    const entries = Array.from({ length: 65_536 }, (_unused, at) => ({
      path: `f${String(at)}`,
      bytes: new Uint8Array(),
    }));

    expect(zipOf(entries, AT)).toEqual({ ok: false, error: "export-too-large" });
    expect(zipEntries(answered(zipOf(entries.slice(1), AT))).size).toBe(65_535);
  });

  it("refuses to exceed its byte cap", () => {
    const zip = answered(zipOf([{ path: "binary.bin", bytes: NOT_UTF8 }], AT));

    expect(zipOf([{ path: "binary.bin", bytes: NOT_UTF8 }], AT, zip.length - 1)).toEqual({
      ok: false,
      error: "export-too-large",
    });
    expect(zipOf([{ path: "binary.bin", bytes: NOT_UTF8 }], AT, zip.length)).toEqual({
      ok: true,
      value: zip,
    });
  });

  it("dates each entry and compresses only what gets smaller", async () => {
    const zip = answered(zipOf(ENTRIES, AT));

    const dated = { madeBy: "2.0", needs: "2.0", modified: "2026 Jun 1 23:30:00" };
    expect(await describedBy(zip)).toEqual([
      { name: "knowledge/manifest.yaml", method: "none (stored)", ...dated },
      { name: "knowledge/policies/binary.bin", method: "none (stored)", ...dated },
      { name: "knowledge/policies/empty.md", method: "none (stored)", ...dated },
      { name: "knowledge/policies/repeated.md", method: "deflated", ...dated },
    ]);
  });

  it("sets the UTF-8 flag and entry counts strict readers check", () => {
    const zip = Buffer.from(answered(zipOf(ENTRIES.slice(0, 2), AT)));
    const central = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));

    expect({
      localNeeds: zip.readUInt16LE(4),
      localFlags: zip.readUInt16LE(6),
      centralFlags: zip.readUInt16LE(central + 8),
      entriesOnThisDisk: zip.readUInt16LE(end + 8),
      entries: zip.readUInt16LE(end + 10),
    }).toEqual({
      localNeeds: 20,
      localFlags: 0x08_00,
      centralFlags: 0x08_00,
      entriesOnThisDisk: 2,
      entries: 2,
    });
  });

  it("refuses a file over its cap before compressing it", () => {
    const text = (length: number) => [{ path: "long.md", bytes: Buffer.from("a".repeat(length)) }];

    expect(zipOf(text(1_001), AT, 1_000)).toEqual({ ok: false, error: "export-too-large" });
    expect(zipOf(text(1_000), AT, 1_000)).toMatchObject({ ok: true });
  });

  it("refuses once its files together exceed the cap", () => {
    const noise = (name: string) => ({ path: name, bytes: randomBytes(400) });

    expect(zipOf([noise("one.bin")], AT, 600)).toMatchObject({ ok: true });
    expect(zipOf([noise("one.bin"), noise("two.bin")], AT, 600)).toEqual({
      ok: false,
      error: "export-too-large",
    });
  });
});
