import { describe, expect, it } from "vitest";

import { head } from "@better-answers/core/store/git";
import { ulid } from "@better-answers/schema";

import { withBundleWrite } from "../src/bundle/index.ts";
import { overrideConceptSensitivity } from "../src/concepts/index.ts";
import {
  coverageOf,
  includeAvailable,
  seedGuide,
  writeSkeleton,
  type Coverage,
} from "../src/guides/index.ts";
import type { UserPrincipal } from "../src/kernel/index.ts";
import { bundleHistory, commitFacts, fileAtCommit } from "./bundle.ts";
import { EMPLOYERS_LIABILITY, northgate, typedBy, type Northgate } from "./fixtures/northgate.ts";
import { answered, readingAs } from "./suite-postgres.ts";
import { doorsOf, suiteWithBundles } from "./workspace-with-bundle.ts";

const { db, arrange } = suiteWithBundles();

const BID_LIBRARY = { templateId: "bid-library", collection: "company", subjectIri: null } as const;

type Seeded = {
  readonly ng: Northgate;
  readonly guideId: string;
  readonly sha: string;
  readonly auditEventId: string;
};

const seeded = async (): Promise<Seeded> => {
  const scenario = await arrange();
  const ng = await northgate(db(), scenario);
  const seed = answered(await seedGuide(ng.admin, doorsOf(scenario), BID_LIBRARY));
  return { ng, ...seed };
};

let shared: Promise<Seeded> | undefined;

/** One seeded Northgate for the cases that change nothing. */
const seededOnce = (): Promise<Seeded> => (shared ??= seeded());

const coverageAs = async (reader: UserPrincipal, guideId: string): Promise<Coverage> => {
  const read = answered(
    await readingAs(db().runtimePool, reader, (principal, tx) =>
      coverageOf(principal, tx, guideId),
    ),
  );
  if (read === undefined) throw new Error("the guide was not found");
  return read;
};

const statesOf = (coverage: Coverage) =>
  coverage.sections.map((section) => [
    section.prompt,
    section.facts.map((fact) => `${fact.name}: ${fact.state}`),
  ]);

const includedBySection = async (workspaceId: string, guideId: string) => {
  const found = await db().pool.query<{ prompt: string; name: string | null; title: string }>(
    `SELECT s.prompt, f.name, c.title
       FROM write_up_include i
       JOIN write_up w ON w.workspace_id = i.workspace_id AND w.id = i.write_up_id
       JOIN guide_section s ON s.workspace_id = w.workspace_id AND s.guide_id = w.guide_id
                           AND s.id = w.section_id
       LEFT JOIN guide_expected_fact f ON f.workspace_id = i.workspace_id AND f.id = i.expected_fact_id
       JOIN concept_index c ON c.workspace_id = i.workspace_id AND c.iri = i.iri
      WHERE w.workspace_id = $1 AND w.guide_id = $2
      ORDER BY s.prompt, i.ordinal`,
    [workspaceId, guideId],
  );
  const bySection: Record<string, string[]> = {};
  for (const row of found.rows) {
    (bySection[row.prompt] ??= []).push(`${row.name ?? "(no fact)"}: ${row.title}`);
  }
  return bySection;
};

const writeUpOf = async (workspaceId: string, guideId: string, prompt: string) => {
  const found = await db().pool.query<{ id: string; needs_review: string | null }>(
    `SELECT w.id, w.needs_review FROM write_up w
       JOIN guide_section s ON s.workspace_id = w.workspace_id AND s.guide_id = w.guide_id
                           AND s.id = w.section_id
      WHERE w.workspace_id = $1 AND w.guide_id = $2 AND s.prompt = $3`,
    [workspaceId, guideId, prompt],
  );
  const row = found.rows[0];
  if (row === undefined) throw new Error(`no write-up for ${prompt}`);
  return row;
};

const counted = async (table: string, workspaceId: string): Promise<number> => {
  const found = await db().pool.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM ${table} WHERE workspace_id = $1`,
    [workspaceId],
  );
  return found.rows[0]?.n ?? -1;
};

const skeletonCommits = async (ng: Northgate): Promise<readonly string[]> => {
  const history = await bundleHistory(ng.scenario.git, ng.scenario.workspaceId);
  const touching: string[] = [];
  for (const sha of history) {
    const facts = await commitFacts(ng.scenario.git, ng.scenario.workspaceId, sha);
    if (facts.trailers["Projection"] === "guides") touching.push(sha);
  }
  return touching;
};

const THE_FULL_COVERAGE = [
  [
    "Company overview",
    ["Company registration: met", "Headcount: met", "Year founded: met", "Registered office: met"],
  ],
  ["What we offer", ["Services: met", "Sectors served: met"]],
  [
    "Insurance and financial standing",
    [
      "Public liability insurance: met",
      "Professional indemnity insurance: met",
      "Employers' liability insurance: missing",
      "Filed accounts: met",
    ],
  ],
  ["Certifications", ["ISO 27001 certificate: met", "Cyber Essentials Plus certificate: met"]],
  [
    "Data protection",
    ["Data protection registration: met", "Privacy policy: met", "Data location: met"],
  ],
  ["Information security", ["Security practices: met", "Cyber Essentials Plus certificate: met"]],
  ["Security testing", ["Security testing practices: met"]],
  [
    "Support and service levels",
    ["Incident severity levels: met", "Support hours: met", "Escalation path: met"],
  ],
];

describe("seeding a guide from a template", () => {
  it("fills sections from typed and imported concepts alike", async () => {
    const { ng, guideId } = await seededOnce();

    expect(await includedBySection(ng.scenario.workspaceId, guideId)).toEqual({
      "Company overview": [
        "Company registration: Registered company number",
        "Headcount: Staff headcount",
        "Year founded: Founded in 2009",
        "Registered office: Registered office address",
      ],
      "What we offer": [
        "Services: Cloud migration",
        "Services: Managed IT support",
        "Sectors served: Public sector bodies",
      ],
      "Insurance and financial standing": [
        "Public liability insurance: Public liability policy",
        "Professional indemnity insurance: Professional indemnity policy",
        "Filed accounts: Filed accounts 2024",
        "Filed accounts: Filed accounts 2025",
      ],
      Certifications: [
        "ISO 27001 certificate: ISO 27001 certificate",
        "Cyber Essentials Plus certificate: Cyber Essentials Plus certificate",
      ],
      "Data protection": [
        "Data protection registration: ICO registration",
        "Privacy policy: Privacy notice",
        "Data location: Where data is held",
      ],
      "Information security": [
        "Security practices: Access control",
        "Security practices: Patch management",
        "Cyber Essentials Plus certificate: Cyber Essentials Plus certificate",
      ],
      "Security testing": [
        "Security testing practices: Penetration testing",
        "Security testing practices: Vulnerability scanning",
      ],
      "Support and service levels": [
        "Incident severity levels: Incident severity levels",
        "Support hours: Support hours",
        "Escalation path: Escalation path",
      ],
    });
    const stale = await db().pool.query(
      `SELECT i.iri FROM write_up_include i
         JOIN concept_index c ON c.workspace_id = i.workspace_id AND c.iri = i.iri
        WHERE i.workspace_id = $1 AND i.content_hash <> c.content_hash`,
      [ng.scenario.workspaceId],
    );
    expect(stale.rows).toEqual([]);
    expect(await counted("write_up_include", ng.scenario.workspaceId)).toBe(24);
  });

  it("lists each missing fact by name", async () => {
    const { ng, guideId } = await seededOnce();

    const coverage = await coverageAs(ng.admin, guideId);

    expect(coverage.collection).toBe("company");
    expect(statesOf(coverage)).toEqual(THE_FULL_COVERAGE);
  });

  it("includes one concept in two sections' write-ups", async () => {
    const { ng, guideId } = await seededOnce();

    const found = await db().pool.query<{ prompt: string }>(
      `SELECT s.prompt FROM write_up_include i
         JOIN write_up w ON w.workspace_id = i.workspace_id AND w.id = i.write_up_id
         JOIN guide_section s ON s.workspace_id = w.workspace_id AND s.guide_id = w.guide_id
                             AND s.id = w.section_id
        WHERE i.workspace_id = $1 AND w.guide_id = $2 AND i.iri = $3
        ORDER BY s.prompt`,
      [ng.scenario.workspaceId, guideId, ng.iri("cyberEssentialsPlus")],
    );

    expect(found.rows.map((row) => row.prompt)).toEqual(["Certifications", "Information security"]);
  });

  it("refuses a seed by an Editor", async () => {
    const { ng } = await seededOnce();
    const { scenario } = ng;
    const before = await bundleHistory(scenario.git, scenario.workspaceId);

    const refused = await seedGuide(ng.editor, doorsOf(scenario), BID_LIBRARY);

    expect(refused).toEqual({ ok: false, error: "role-forbids" });
    expect(await counted("guide_definition", scenario.workspaceId)).toBe(1);
    expect(await counted("write_up", scenario.workspaceId)).toBe(8);
    expect(await bundleHistory(scenario.git, scenario.workspaceId)).toEqual(before);
  });

  it("writes version one of every section's write-up", async () => {
    const { ng, guideId } = await seededOnce();
    const { workspaceId } = ng.scenario;

    const versions = await db().pool.query<Record<string, unknown>>(
      `SELECT s.prompt, v.version, v.actor, v.markdown, v.note,
              jsonb_array_length(v.includes) AS includes, w.needs_review
         FROM write_up_version v
         JOIN write_up w ON w.workspace_id = v.workspace_id AND w.id = v.write_up_id
         JOIN guide_section s ON s.workspace_id = w.workspace_id AND s.guide_id = w.guide_id
                             AND s.id = w.section_id
        WHERE v.workspace_id = $1 AND w.guide_id = $2
        ORDER BY s.prompt`,
      [workspaceId, guideId],
    );
    const actor = `human:${ng.admin.userId}`;
    const version = (prompt: string, includes: number, needsReview: string | null = null) => ({
      prompt,
      version: 1,
      actor,
      markdown: "",
      note: null,
      includes,
      needs_review: needsReview,
    });
    expect(versions.rows).toEqual([
      version("Certifications", 2),
      version("Company overview", 4),
      version("Data protection", 3),
      version("Information security", 3),
      version("Insurance and financial standing", 4, "expectation-unmet"),
      version("Security testing", 2),
      version("Support and service levels", 3),
      version("What we offer", 3),
    ]);

    const certifications = await writeUpOf(workspaceId, guideId, "Certifications");
    const snapshot = await db().pool.query<{ includes: unknown }>(
      "SELECT includes FROM write_up_version WHERE workspace_id = $1 AND write_up_id = $2",
      [workspaceId, certifications.id],
    );
    const rows = await db().pool.query<Record<string, unknown>>(
      `SELECT id, iri, content_hash AS "contentHash", expected_fact_id AS "expectedFactId",
              ordinal, wording_heading AS "wordingHeading", wording_hash AS "wordingHash"
         FROM write_up_include WHERE workspace_id = $1 AND write_up_id = $2 ORDER BY ordinal`,
      [workspaceId, certifications.id],
    );
    expect(snapshot.rows[0]?.includes).toEqual(rows.rows);
    expect(rows.rows.map((row) => [row["iri"], row["ordinal"], row["wordingHeading"]])).toEqual([
      [ng.iri("iso27001"), 0, null],
      [ng.iri("cyberEssentialsPlus"), 1, null],
    ]);
  });

  it("reads a withheld fact as missing to an outside Viewer", async () => {
    const { ng, guideId } = await seededOnce();

    const coverage = await coverageAs(ng.viewer, guideId);

    expect(statesOf(coverage)[2]).toEqual([
      "Insurance and financial standing",
      [
        "Public liability insurance: met",
        "Professional indemnity insurance: missing",
        "Employers' liability insurance: missing",
        "Filed accounts: met",
      ],
    ]);
    const said = JSON.stringify(coverage);
    expect(said).not.toContain(ng.iri("professionalIndemnity"));
    expect(said).not.toContain("Professional indemnity policy");
  });

  it("commits the skeleton outside knowledge with its trailer", async () => {
    const { ng, guideId, sha, auditEventId } = await seededOnce();
    const { git, workspaceId } = ng.scenario;
    const admin = await db().pool.query<{ name: string; email: string }>(
      'SELECT name, email FROM "user" WHERE id = $1',
      [ng.admin.userId],
    );

    const facts = await commitFacts(git, workspaceId, sha);
    const parent = await commitFacts(git, workspaceId, facts.parents[0] ?? "");

    expect(facts.author).toBe(`${admin.rows[0]?.name} <${admin.rows[0]?.email}>`);
    expect(facts.trailers).toEqual({
      Actor: `human:${ng.admin.userId}`,
      Audit: auditEventId,
      Projection: "guides",
    });
    expect(facts.files.filter((file) => file.startsWith("guides/"))).toEqual([
      `guides/${guideId}.yaml`,
    ]);
    const knowledge = (files: readonly string[]) =>
      files.filter((file) => file.startsWith("knowledge/"));
    expect(knowledge(facts.files)).toEqual(knowledge(parent.files));

    const file = await fileAtCommit(git, workspaceId, sha, `guides/${guideId}.yaml`);
    expect(file.split("\n").slice(0, 24).join("\n")).toBe(
      [
        "{",
        `  "guide": "${guideId}",`,
        '  "template": "bid-library",',
        '  "kind": "Bid library",',
        '  "subject": null,',
        '  "roles": [',
        "    {",
        '      "role": "Admin",',
        '      "defaultLayer": "assembled",',
        '      "actionThreshold": "unverified"',
        "    },",
        "    {",
        '      "role": "Editor",',
        '      "defaultLayer": "assembled",',
        '      "actionThreshold": "unverified"',
        "    },",
        "    {",
        '      "role": "Viewer",',
        '      "defaultLayer": "quoted",',
        '      "actionThreshold": "machine-confirmed"',
        "    }",
        "  ],",
        '  "sections": [',
        "    {",
      ].join("\n"),
    );
    const insurance = await writeUpOf(workspaceId, guideId, "Insurance and financial standing");
    const parsed: unknown = JSON.parse(file);
    expect(parsed).toMatchObject({
      sections: [
        { prompt: "Company overview" },
        { prompt: "What we offer" },
        {
          prompt: "Insurance and financial standing",
          roleLabel: "show",
          expects: [
            "Public liability insurance",
            "Professional indemnity insurance",
            "Employers' liability insurance",
            "Filed accounts",
          ],
          includes: [
            ng.iri("publicLiability"),
            ng.iri("professionalIndemnity"),
            ng.iri("accounts2024"),
            ng.iri("accounts2025"),
          ],
          sections: [],
        },
        { prompt: "Certifications" },
        { prompt: "Data protection" },
        {
          prompt: "Information security",
          sections: [{ prompt: "Security testing", sections: [] }],
        },
        { prompt: "Support and service levels" },
      ],
    });
    expect(file.endsWith("}\n")).toBe(true);
    expect(file).not.toContain("Open with the facts");
    expect(file).not.toContain(admin.rows[0]?.email ?? "");
    expect(insurance.needs_review).toBe("expectation-unmet");

    const version = await db().pool.query<{ content: unknown }>(
      "SELECT content FROM guide_definition_version WHERE workspace_id = $1 AND guide_id = $2",
      [workspaceId, guideId],
    );
    expect(version.rows).toEqual([{ content: parsed }]);
  });

  it("writes no skeleton commit when nothing changed", async () => {
    const { ng, guideId, sha } = await seededOnce();
    const { git, workspaceId } = ng.scenario;
    const content = await fileAtCommit(git, workspaceId, sha, `guides/${guideId}.yaml`);
    const commitsBefore = await counted("bundle_commit", workspaceId);
    const headBefore = await head(ng.admin, git);
    let landed = false;

    const written = await withBundleWrite(ng.admin, doorsOf(ng.scenario), () =>
      writeSkeleton(ng.admin, doorsOf(ng.scenario), {
        guideId,
        content,
        auditEventId: ulid(),
        land: async () => {
          landed = true;
        },
      }),
    );

    expect(written).toEqual({ ok: true, value: { written: false } });
    expect(landed).toBe(false);
    expect(await head(ng.admin, git)).toBe(headBefore);
    expect(await counted("bundle_commit", workspaceId)).toBe(commitsBefore);
  });
});

const typedTheMissingPolicy = async () => {
  const seed = await seeded();
  const typed = await typedBy(seed.ng.editor, seed.ng.scenario, EMPLOYERS_LIABILITY);
  return { ...seed, employersLiability: typed.iri };
};

describe("including an available concept", () => {
  it("includes an available concept and re-commits the skeleton", async () => {
    const { ng, guideId, employersLiability } = await typedTheMissingPolicy();
    const { git, workspaceId } = ng.scenario;
    const insurance = await writeUpOf(workspaceId, guideId, "Insurance and financial standing");

    const before = await coverageAs(ng.editor, guideId);
    expect(before.sections[2]?.facts[2]).toMatchObject({
      name: "Employers' liability insurance",
      state: "available",
      available: [{ iri: employersLiability, title: "Employers' liability policy" }],
    });
    expect(await counted("write_up_include", workspaceId)).toBe(24);
    expect(await skeletonCommits(ng)).toHaveLength(1);

    const included = answered(
      await includeAvailable(ng.editor, doorsOf(ng.scenario), { writeUpId: insurance.id }),
    );

    expect(included).toEqual({ included: 1, sha: await head(ng.admin, git) });
    if (!("sha" in included)) throw new Error("nothing was included");
    const after = await coverageAs(ng.editor, guideId);
    expect(statesOf(after)[2]).toEqual([
      "Insurance and financial standing",
      [
        "Public liability insurance: met",
        "Professional indemnity insurance: met",
        "Employers' liability insurance: met",
        "Filed accounts: met",
      ],
    ]);
    expect(
      (await includedBySection(workspaceId, guideId))["Insurance and financial standing"],
    ).toEqual([
      "Public liability insurance: Public liability policy",
      "Professional indemnity insurance: Professional indemnity policy",
      "Filed accounts: Filed accounts 2024",
      "Filed accounts: Filed accounts 2025",
      "Employers' liability insurance: Employers' liability policy",
    ]);
    expect(await skeletonCommits(ng)).toHaveLength(2);
    const file: unknown = JSON.parse(
      await fileAtCommit(git, workspaceId, included.sha, `guides/${guideId}.yaml`),
    );
    expect(file).toMatchObject({
      sections: [
        {},
        {},
        {
          includes: [
            ng.iri("publicLiability"),
            ng.iri("professionalIndemnity"),
            ng.iri("accounts2024"),
            ng.iri("accounts2025"),
            employersLiability,
          ],
        },
        {},
        {},
        {},
        {},
      ],
    });
    expect(
      (await writeUpOf(workspaceId, guideId, "Insurance and financial standing")).needs_review,
    ).toBe(null);
    const versions = await db().pool.query<Record<string, unknown>>(
      `SELECT version, actor, markdown, jsonb_array_length(includes) AS includes
         FROM write_up_version WHERE workspace_id = $1 AND write_up_id = $2 ORDER BY version`,
      [workspaceId, insurance.id],
    );
    expect(versions.rows).toEqual([
      { version: 1, actor: `human:${ng.admin.userId}`, markdown: "", includes: 4 },
      { version: 2, actor: `human:${ng.editor.userId}`, markdown: "", includes: 5 },
    ]);
    const events = await db().pool.query<Record<string, unknown>>(
      "SELECT actor, subject_id, detail FROM audit_event WHERE workspace_id = $1 AND action = $2",
      [workspaceId, "knowledge.guide.included"],
    );
    expect(events.rows).toEqual([
      {
        actor: `human:${ng.editor.userId}`,
        subject_id: guideId,
        detail: { guideId, writeUpId: insurance.id, included: 1, commitSha: included.sha },
      },
    ]);
  });

  it("names no withheld concept as available to an outside Viewer", async () => {
    const { ng, guideId, employersLiability } = await typedTheMissingPolicy();
    answered(
      await readingAs(db().runtimePool, ng.admin, (principal, tx) =>
        overrideConceptSensitivity(principal, tx, {
          iri: employersLiability,
          sensitivity: "Internal",
          audience: "groups",
          audienceGroups: [ng.finance],
        }),
      ),
    );

    const toTheViewer = await coverageAs(ng.viewer, guideId);
    const toTheEditor = await coverageAs(ng.editor, guideId);

    expect(toTheViewer.sections[2]?.facts[2]).toMatchObject({ state: "missing", available: [] });
    expect(JSON.stringify(toTheViewer)).not.toContain(employersLiability);
    expect(toTheEditor.sections[2]?.facts[2]).toMatchObject({
      state: "available",
      available: [{ iri: employersLiability, title: "Employers' liability policy" }],
    });
  });

  it("refuses an include by a Viewer", async () => {
    const { ng, guideId } = await typedTheMissingPolicy();
    const { git, workspaceId } = ng.scenario;
    const insurance = await writeUpOf(workspaceId, guideId, "Insurance and financial standing");
    const headBefore = await head(ng.admin, git);

    const refused = await includeAvailable(ng.viewer, doorsOf(ng.scenario), {
      writeUpId: insurance.id,
    });

    expect(refused).toEqual({ ok: false, error: "role-forbids" });
    expect(await counted("write_up_include", workspaceId)).toBe(24);
    expect(await counted("write_up_version", workspaceId)).toBe(8);
    expect(await head(ng.admin, git)).toBe(headBefore);
  });
});
