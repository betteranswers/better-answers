import { execFile } from "node:child_process";
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
  exportGuideSnapshot,
  exportRecords,
} from "../../src/concepts/index.ts";
import { readGuide, saveBrief, seedGuide } from "../../src/guides/index.ts";
import type { Role, UserPrincipal } from "../../src/kernel/index.ts";
import { bundleHistory, commitFacts, fileAtCommit, treeCommitted } from "../fixtures/bundle.ts";
import { bundleIndexed, type BundleIndexed } from "../fixtures/indexed-bundle.ts";
import { IMPORTED, NORTHGATE, TYPED } from "../fixtures/northgate-concepts.ts";
import { northgate, type Northgate } from "../fixtures/northgate.ts";
import { groupNamed } from "../fixtures/sourced-concept.ts";
import {
  doorsOf,
  principalFor,
  suiteWithBundles,
  type Scenario,
} from "../fixtures/workspace-with-bundle.ts";
import { zipEntries } from "../fixtures/zip-entries.ts";
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

type GuideWorld = {
  readonly ng: Northgate;
  readonly scenario: Scenario;
  readonly guideId: string;
  readonly overview: Briefed;
  readonly insurance: Briefed;
};

const briefWith = async (
  ng: Northgate,
  guideId: string,
  prompt: string,
  sentence: string,
): Promise<Briefed> => {
  const guide = answered(
    await readingAs(db().runtimePool, ng.editor, (editor, tx) =>
      readGuide(editor, tx, { guideId }),
    ),
  );
  const section = guide?.sections.find((each) => each.prompt === prompt);
  const labels = section?.brief?.editable?.footnotes.map(({ label }) => label) ?? [];
  if (section?.brief === undefined) throw new Error(`no Brief to write at ${prompt}`);
  const saved = answered(
    await saveBrief(ng.editor, doorsOf(ng.scenario), {
      writeUpId: section.writeUpId,
      markdown: labels.map((label) => `${sentence}[^${label}]`).join("\n\n"),
      base: section.brief.version,
    }),
  );
  return { writeUpId: section.writeUpId, version: saved.version };
};

const guideWorld = once(async (): Promise<GuideWorld> => {
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

const guideOf = (as: UserPrincipal, world: GuideWorld, guideId = world.guideId) =>
  exportGuideSnapshot(as, world.scenario.postgres, { guideId, at: AT });

const everyExportOf = async (as: UserPrincipal, world: GuideWorld) => [
  await snapshotOf(as, world.scenario),
  await recordsOf(as, world.scenario),
  await guideOf(as, world),
];

describe("who may export", () => {
  it("an owning Editor is refused every export", async () => {
    const world = await guideWorld();
    const { scenario } = world;
    const person = await memberAs(scenario, "Editor", world.ng.finance);
    await seedingWith(db().pool, (seed) =>
      seed.conceptOwner({
        workspaceId: scenario.workspaceId,
        collection: "tenders",
        personId: person.userId,
      }),
    );

    const refused = await everyExportOf(person, world);
    const left = {
      events: await exportEventsBy(scenario, person),
      usage: await usageBy(scenario, person),
    };
    await db().pool.query(
      "UPDATE member SET role = 'Admin' WHERE workspace_id = $1 AND user_id = $2",
      [scenario.workspaceId, person.userId],
    );
    const promoted = confirmed(await principalFor(db(), scenario.workspaceId, person.userId));
    const admitted = await everyExportOf(promoted, world);

    expect(refused).toEqual(
      Array.from({ length: 3 }, () => ({ ok: false, error: "role-forbids" })),
    );
    expect(left).toEqual({ events: [], usage: [] });
    expect(admitted.map(({ ok }) => ok)).toEqual([true, true, true]);
  });

  it("an export past its confirmation window is refused", async () => {
    const world = await guideWorld();
    const admin = await memberAs(world.scenario, "Admin", world.ng.finance);
    const stale = confirmed(admin, STALE_BY_MS);

    const refused = await everyExportOf(stale, world);

    expect(refused).toEqual(
      Array.from({ length: 3 }, () => ({ ok: false, error: "confirmation-too-old" })),
    );
    expect(await exportEventsBy(world.scenario, admin)).toEqual([]);
    expect(await usageBy(world.scenario, admin)).toEqual([]);
  });
});

describe("what an export records", () => {
  it("each export writes one audit event", async () => {
    const world = await guideWorld();
    const { scenario } = world;
    const admin = await memberAs(scenario, "Admin", world.ng.finance);

    const snapshot = answered(await snapshotOf(admin, scenario));
    const records = answered(await recordsOf(admin, scenario));
    const guide = answered(await guideOf(admin, world));

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
        subject_id: world.guideId,
        detail: { guideId: world.guideId, sections: guide.sections },
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

  it("a guide snapshot writes one usage row per write-up", async () => {
    const world = await guideWorld();
    const admin = await memberAs(world.scenario, "Admin", world.ng.finance);

    answered(await snapshotOf(admin, world.scenario));
    answered(await recordsOf(admin, world.scenario));
    const guide = answered(await guideOf(admin, world));

    expect(guide.sections).toBe(2);
    expect(await usageBy(world.scenario, admin)).toEqual(
      [world.overview, world.insurance]
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
  it("dates each Brief, names its trust, and is not maintained", async () => {
    const world = await guideWorld();
    const admin = await memberAs(world.scenario, "Admin", world.ng.finance);

    const guide = answered(await guideOf(admin, world));

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

  it("an unknown guide is not found", async () => {
    const world = await guideWorld();
    const admin = await memberAs(world.scenario, "Admin");

    expect(await guideOf(admin, world, ulid())).toEqual({ ok: false, error: "not-found" });
    expect(await exportEventsBy(world.scenario, admin)).toEqual([]);
  });
});

describe("an Admin outside a concept's audience", () => {
  it("exports nothing of a concept outside their audience", async () => {
    const world = await guideWorld();
    const outsider = await memberAs(world.scenario, "Admin");
    const insider = await memberAs(world.scenario, "Admin", world.ng.finance);
    const withheld = [
      `knowledge/${NORTHGATE.collection}/professional-indemnity-policy.md`,
      world.ng.iri("professionalIndemnity"),
      "Professional indemnity policy",
      world.insurance.writeUpId,
      COVER,
    ];
    const carriedBy = async (as: UserPrincipal): Promise<string> => {
      const zips = [
        answered(await snapshotOf(as, world.scenario)),
        answered(await recordsOf(as, world.scenario)),
      ];
      const files = zips.flatMap(({ zip }) => [...zipEntries(zip)]);
      const { markdown } = answered(await guideOf(as, world));
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
  it("the snapshot holds every concept file and no skeleton", async () => {
    const world = await guideWorld();
    const { git, workspaceId } = world.scenario;
    const admin = await memberAs(world.scenario, "Admin", world.ng.finance);

    const snapshot = answered(await snapshotOf(admin, world.scenario));

    const entries = zipEntries(snapshot.zip);
    const tree = (await commitFacts(git, workspaceId, snapshot.head)).files;
    const concepts = [...TYPED, ...IMPORTED].map(
      ({ slug }) => `knowledge/${NORTHGATE.collection}/${slug}.md`,
    );
    expect(tree).toContain(`guides/${world.guideId}.yaml`);
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

type ShelfWorld = {
  readonly scenario: Scenario;
  readonly bundle: BundleIndexed;
};

const shelfOf = async (): Promise<ShelfWorld> => {
  const scenario = await arrange();
  const finance = await groupNamed(db(), scenario, "finance", [scenario.editor]);
  const bundle = await bundleIndexed(
    db(),
    scenario,
    new Map([
      [BUNDLE_MANIFEST_PATH, "owner: Acme\n"],
      [EXPENSES, "Claim within thirty days.\n"],
      [VETTING, "Every hire is vetted.\n"],
      [SALARIES, "Pay bands.\n"],
      [FORMULA, "A title a spreadsheet would run.\n"],
      [ORPHAN, "No index row names this file.\n"],
      ["guides/01K4GUIDE0000000000000000.yaml", "sections: []\n"],
    ]),
    [
      { path: EXPENSES, title: "Expenses", sensitivity: "Internal", audienceGroups: null },
      { path: VETTING, title: "Vetting", sensitivity: "Restricted", audienceGroups: null },
      { path: SALARIES, title: "Salary bands", sensitivity: "Internal", audienceGroups: [finance] },
      { path: FORMULA, title: FORMULA_TITLE, sensitivity: "Internal", audienceGroups: null },
    ],
  );
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
  return { scenario, bundle };
};

const shelfWorld = once(shelfOf);

describe("a knowledge base an Admin partly reads", () => {
  it("a file with no index row is left out", async () => {
    const { scenario } = await shelfWorld();
    const admin = await memberAs(scenario, "Admin");

    const snapshot = answered(await snapshotOf(admin, scenario));

    expect([...zipEntries(snapshot.zip).keys()]).toEqual([
      BUNDLE_MANIFEST_PATH,
      EXPENSES,
      FORMULA,
      VETTING,
    ]);
  });

  it("a Restricted concept is exported for an Admin", async () => {
    const { scenario, bundle } = await shelfWorld();
    const admin = await memberAs(scenario, "Admin");

    const snapshot = answered(await snapshotOf(admin, scenario));
    const records = answered(await recordsOf(admin, scenario));

    expect(zipEntries(snapshot.zip).get(VETTING)?.toString("utf8")).toBe("Every hire is vetted.\n");
    expect(
      csvLinesOf(records.zip, "owners.csv").filter((line) => line.includes(bundle.iriOf(VETTING))),
    ).toHaveLength(1);
  });

  it("the records name each owner, verification and use", async () => {
    const { scenario, bundle } = await shelfWorld();
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

  it("a CSV cell starting = is made inert", async () => {
    const { scenario, bundle } = await shelfWorld();
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

  it("a knowledge base past its byte cap is refused", async () => {
    const { scenario } = await shelfWorld();
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
  it("a head the store never recorded is refused", async () => {
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

  it("a knowledge base with no commit is not found", async () => {
    const scenario = await arrange();
    const admin = await memberAs(scenario, "Admin");

    expect(await snapshotOf(admin, scenario)).toEqual({ ok: false, error: "not-found" });
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

const unzipped = async (zip: Uint8Array) => {
  const scratch = await mkdtemp(path.join(tmpdir(), "better-answers-zip-"));
  const file = path.join(scratch, "export.zip");
  try {
    await writeFile(file, zip);
    const tested = await run("unzip", ["-tq", file]);
    const names = (await run("unzip", ["-Z1", file])).stdout.split("\n").filter(Boolean);
    const contents = await Promise.all(
      names.map(
        async (name) => (await run("unzip", ["-p", file, name], { encoding: "buffer" })).stdout,
      ),
    );
    return { tested: tested.stdout.trim(), files: names.map((name, at) => [name, contents[at]]) };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
};

describe("the export's zip", () => {
  it("the zip round trips through unzip", async () => {
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

  it("one set of files always writes the same bytes", () => {
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

  it("refuses rather than pass its byte cap", () => {
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
});
