import type pg from "pg";
import { z } from "zod";

import { boundarySchemas } from "@better-answers/schema";

import { readableClause, readableParameters } from "../access/index.ts";
import { action, declareActions, record } from "../audit/index.ts";
import { isRecorded } from "../bundle/index.ts";
import {
  briefToCopy,
  readGuide,
  renderBrief,
  type BriefToCopy,
  type GuideRead,
  type SectionRead,
} from "../guides/index.ts";
import {
  admit,
  ADMIN_ALONE,
  attempt,
  csvOf,
  declareAction,
  err,
  normalizeError,
  NOT_FOUND,
  ok,
  PERSON_PREFIX,
  requireFreshConfirmation,
  ulid,
  type PrincipalRefusal,
  type RefusalOf,
  type Result,
  type UserPrincipal,
} from "../kernel/index.ts";
import { bundleSnapshot, type GitDoor } from "../store/git/index.ts";
import {
  withMember,
  withMemberUnheld,
  type PostgresDoor,
  type Tx,
} from "../store/postgres/index.ts";
import { recordUsage } from "../usage/index.ts";
import { zipOf, type ZipEntry } from "./export-zip.ts";
import { readSectionTrusts } from "./reading/browse.ts";
import { trustWords, ukLongDate } from "./trust.ts";

const EXPORT_ACTIONS = declareActions("knowledge", {
  bundle: action("knowledge.bundle.exported", { commitSha: "gitSha", files: "count" }),
  records: action("knowledge.records.exported", {
    owners: "count",
    verifications: "count",
    usage: "count",
  }),
  guide: action("knowledge.guide.exported", { guideId: "id", sections: "count" }),
});

export const exportBundleInput = z.strictObject({});

export const exportRecordsInput = z.strictObject({});

export const exportGuideInput = z.strictObject({
  guideId: boundarySchemas.guideDefinition.select.shape.id,
});

type At = { readonly at: Date };

type ExportGuideInput = z.output<typeof exportGuideInput> & At;

const exportBundleAction = declareAction({
  admits: ADMIN_ALONE,
  input: exportBundleInput,
  refuses: [
    "role-forbids",
    "confirmation-too-old",
    "not-found",
    "unrecorded-head",
    "export-too-large",
  ],
});

const exportRecordsAction = declareAction({
  admits: ADMIN_ALONE,
  input: exportRecordsInput,
  refuses: ["role-forbids", "confirmation-too-old", "export-too-large"],
});

const exportGuideAction = declareAction({
  admits: ADMIN_ALONE,
  input: exportGuideInput,
  refuses: ["role-forbids", "confirmation-too-old", "not-found"],
});

export type ExportRefusal =
  | RefusalOf<typeof exportBundleAction>
  | RefusalOf<typeof exportRecordsAction>
  | RefusalOf<typeof exportGuideAction>
  | PrincipalRefusal
  | Error;

const DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const dayOf = (at: Date): string => DAY.format(at);

type Steps<Read, Made> = {
  readonly read: (member: UserPrincipal, tx: Tx) => Promise<Result<Read, ExportRefusal>>;
  readonly made: (read: Read) => Result<Made, ExportRefusal>;
  readonly recorded: (member: UserPrincipal, tx: Tx, read: Read) => Promise<void>;
};

const exported = async <Read, Made>(
  admin: UserPrincipal,
  door: PostgresDoor,
  at: Date,
  steps: Steps<Read, Made>,
): Promise<Result<Made, ExportRefusal>> => {
  const fresh = requireFreshConfirmation(admin, at);
  if (!fresh.ok) return err(fresh.error);
  const read = await attempt(() => withMemberUnheld(fresh.value, door, steps.read));
  if (!read.ok) return err(read.error);
  if (!read.value.ok) return err(read.value.error);
  if (!read.value.value.ok) return err(read.value.value.error);
  const held = read.value.value.value;
  const made = steps.made(held);
  if (!made.ok) return made;
  const recorded = await attempt(() =>
    withMember(fresh.value, door, (member, tx) => steps.recorded(member, tx, held)),
  );
  if (!recorded.ok) return err(recorded.error);
  if (!recorded.value.ok) return err(recorded.value.error);
  return made;
};

type Snapshot = { readonly head: string; readonly files: readonly ZipEntry[] };

const READABLE_PATHS = `SELECT c.path FROM concept_index c
   WHERE c.workspace_id = $1 AND ${readableClause("c", 2)}`;

const snapshotRead =
  (git: GitDoor) =>
  async (member: UserPrincipal, tx: Tx): Promise<Result<Snapshot, ExportRefusal>> => {
    const { rows } = await tx.query<{ path: string }>(READABLE_PATHS, [
      member.workspaceId,
      ...readableParameters(member),
    ]);
    const snapshot = await bundleSnapshot(member, git, new Set(rows.map(({ path }) => path)));
    if (!snapshot.ok) return snapshot;
    if (snapshot.value === null) return err(NOT_FOUND);
    return (await isRecorded(member, tx, snapshot.value.head))
      ? ok(snapshot.value)
      : err("unrecorded-head");
  };

export const exportBundleSnapshot = async (
  principal: UserPrincipal,
  doors: { readonly git: GitDoor; readonly postgres: PostgresDoor },
  input: At,
): Promise<
  Result<
    {
      readonly name: string;
      readonly zip: Uint8Array;
      readonly files: number;
      readonly head: string;
    },
    ExportRefusal
  >
> => {
  const admitted = admit(exportBundleAction, principal, {});
  if (!admitted.ok) return err(admitted.error);
  return exported(admitted.value, doors.postgres, input.at, {
    read: snapshotRead(doors.git),
    made: ({ head, files }) => {
      const zip = zipOf(files, input.at);
      if (!zip.ok) return zip;
      const name = `knowledge-base-${dayOf(input.at)}.zip`;
      return ok({ name, zip: zip.value, files: files.length, head });
    },
    recorded: async (member, tx, { head, files }) => {
      await record(member, tx, {
        id: ulid(),
        action: EXPORT_ACTIONS.bundle,
        subjectId: member.workspaceId,
        detail: { commitSha: head, files: files.length },
      });
    },
  });
};

const RECORDS_CAP = 50_000;

const STOPPED = `The export stopped at ${RECORDS_CAP.toLocaleString("en-GB")} rows. The rest are not in this file.`;

/** Excel reads a CSV without a byte order mark as the local code page, mangling "£" and accents. */
const BYTE_ORDER_MARK = "\u{FEFF}";

const personNamed = (alias: string) => ({
  name: `coalesce(nullif(person.name, ''), ${alias}.actor)`,
  join: `LEFT JOIN "user" person ON starts_with(${alias}.actor, '${PERSON_PREFIX}')
                                AND person.id = substr(${alias}.actor, ${String(PERSON_PREFIX.length + 1)})`,
});

const OWNERS = `SELECT o.iri IS NOT NULL AS of_concept, coalesce(o.collection, c.collection) AS collection,
         o.iri, c.title, o.person_id, u.name AS person_name
    FROM concept_owner o
    JOIN "user" u ON u.id = o.person_id
    LEFT JOIN concept_index c ON c.workspace_id = o.workspace_id AND c.iri = o.iri
   WHERE o.workspace_id = $1
     AND CASE WHEN o.iri IS NULL
              THEN EXISTS (SELECT 1 FROM concept_index r
                            WHERE r.workspace_id = o.workspace_id AND r.collection = o.collection
                              AND ${readableClause("r", 2)})
              ELSE ${readableClause("c", 2)} END
   ORDER BY o.iri IS NOT NULL, o.collection COLLATE "C", c.title COLLATE "C", o.iri
   LIMIT $4`;

type OwnerRow = {
  readonly of_concept: boolean;
  readonly collection: string | null;
  readonly iri: string | null;
  readonly title: string | null;
  readonly person_id: string;
  readonly person_name: string;
};

const VERIFIER = personNamed("v");

const VERIFICATIONS = `SELECT v.iri, c.title, ${VERIFIER.name} AS verified_by, v.verified_at, v.content_hash
    FROM concept_verification v
    JOIN concept_index c ON c.workspace_id = v.workspace_id AND c.iri = v.iri
    ${VERIFIER.join}
   WHERE v.workspace_id = $1 AND ${readableClause("c", 2)}
   ORDER BY v.verified_at DESC, v.id DESC
   LIMIT $4`;

type VerificationRow = {
  readonly iri: string;
  readonly title: string;
  readonly verified_by: string;
  readonly verified_at: Date;
  readonly content_hash: string | null;
};

const TAKER = personNamed("x");

const USAGE = `SELECT x.write_up_id, x.write_up_version, x.iri, x.act, ${TAKER.name} AS taken_by, x.at
    FROM usage x
    LEFT JOIN write_up w ON w.workspace_id = x.workspace_id AND w.id = x.write_up_id
    LEFT JOIN concept_index c ON c.workspace_id = x.workspace_id AND c.iri = x.iri
    ${TAKER.join}
   WHERE x.workspace_id = $1
     AND CASE WHEN x.write_up_id IS NULL THEN ${readableClause("c", 2)}
              ELSE ${readableClause("w", 2)} END
   ORDER BY x.at DESC, x.id DESC
   LIMIT $4`;

type UsageRow = {
  readonly write_up_id: string | null;
  readonly write_up_version: number | null;
  readonly iri: string | null;
  readonly act: string;
  readonly taken_by: string;
  readonly at: Date;
};

type Lines = { readonly lines: readonly (readonly string[])[]; readonly capped: boolean };

type Family = {
  readonly header: readonly string[];
  readonly read: (tx: Tx, parameters: readonly unknown[]) => Promise<Lines>;
};

const familyOf = <Row extends pg.QueryResultRow>(
  query: string,
  header: readonly string[],
  cellsOf: (row: Row) => readonly string[],
): Family => ({
  header,
  read: async (tx, parameters) => {
    const { rows } = await tx.query<Row>(query, [...parameters]);
    return { lines: rows.slice(0, RECORDS_CAP).map(cellsOf), capped: rows.length > RECORDS_CAP };
  },
});

const FAMILIES = {
  owners: familyOf<OwnerRow>(
    OWNERS,
    ["Owner of", "Collection", "Concept", "Title", "Person id", "Person"],
    (row) => [
      row.of_concept ? "concept" : "collection",
      row.collection ?? "",
      row.iri ?? "",
      row.title ?? "",
      row.person_id,
      row.person_name,
    ],
  ),
  verifications: familyOf<VerificationRow>(
    VERIFICATIONS,
    ["Concept", "Title", "Verified by", "Verified at", "Content hash"],
    (row) => [
      row.iri,
      row.title,
      row.verified_by,
      row.verified_at.toISOString(),
      row.content_hash ?? "",
    ],
  ),
  usage: familyOf<UsageRow>(USAGE, ["Write-up", "Version", "Concept", "Act", "By", "At"], (row) => [
    row.write_up_id ?? "",
    row.write_up_version === null ? "" : String(row.write_up_version),
    row.iri ?? "",
    row.act,
    row.taken_by,
    row.at.toISOString(),
  ]),
} as const;

type FamilyName = keyof typeof FAMILIES;

const FAMILY_NAMES = ["owners", "verifications", "usage"] as const satisfies readonly FamilyName[];

type Records = Readonly<Record<FamilyName, Lines>>;

const recordsRead = async (
  member: UserPrincipal,
  tx: Tx,
): Promise<Result<Records, ExportRefusal>> => {
  const parameters = [member.workspaceId, ...readableParameters(member), RECORDS_CAP + 1];
  return ok({
    owners: await FAMILIES.owners.read(tx, parameters),
    verifications: await FAMILIES.verifications.read(tx, parameters),
    usage: await FAMILIES.usage.read(tx, parameters),
  });
};

const csvFileOf = (name: FamilyName, { lines, capped }: Lines): ZipEntry => ({
  path: `${name}.csv`,
  bytes: Buffer.from(
    BYTE_ORDER_MARK + csvOf([FAMILIES[name].header, ...lines, ...(capped ? [[STOPPED]] : [])]),
    "utf8",
  ),
});

export const exportRecords = async (
  principal: UserPrincipal,
  door: PostgresDoor,
  input: At,
): Promise<
  Result<
    { readonly name: string; readonly zip: Uint8Array; readonly families: readonly FamilyName[] },
    ExportRefusal
  >
> => {
  const admitted = admit(exportRecordsAction, principal, {});
  if (!admitted.ok) return err(admitted.error);
  return exported(admitted.value, door, input.at, {
    read: recordsRead,
    made: (records) => {
      const zip = zipOf(
        FAMILY_NAMES.map((name) => csvFileOf(name, records[name])),
        input.at,
      );
      if (!zip.ok) return zip;
      return ok({ name: `records-${dayOf(input.at)}.zip`, zip: zip.value, families: FAMILY_NAMES });
    },
    recorded: async (member, tx, records) => {
      await record(member, tx, {
        id: ulid(),
        action: EXPORT_ACTIONS.records,
        subjectId: member.workspaceId,
        detail: {
          owners: records.owners.lines.length,
          verifications: records.verifications.lines.length,
          usage: records.usage.lines.length,
        },
      });
    },
  });
};

type Carried = {
  readonly section: SectionRead;
  readonly brief: BriefToCopy;
  readonly trustWords: string;
};

type GuideCarried = { readonly guide: GuideRead; readonly sections: readonly Carried[] };

const briefsOf = async (
  member: UserPrincipal,
  tx: Tx,
  guide: GuideRead,
): Promise<Result<readonly Omit<Carried, "trustWords">[], ExportRefusal>> => {
  const briefs: Omit<Carried, "trustWords">[] = [];
  for (const section of guide.sections) {
    if (section.brief === undefined) continue;
    // oxlint-disable-next-line eslint/no-await-in-loop -- every Brief is read on the caller's transaction
    const brief = await briefToCopy(member, tx, {
      writeUpId: section.writeUpId,
      version: section.brief.version,
    });
    if (!brief.ok) return brief;
    if (brief.value !== undefined && brief.value.markdown.trim() !== "") {
      briefs.push({ section, brief: brief.value });
    }
  }
  return ok(briefs);
};

const guideRead =
  (guideId: string, at: Date) =>
  async (member: UserPrincipal, tx: Tx): Promise<Result<GuideCarried, ExportRefusal>> => {
    const read = await readGuide(member, tx, { guideId });
    if (!read.ok) return read;
    const guide = read.value;
    if (guide === undefined) return err(NOT_FOUND);
    const briefs = await briefsOf(member, tx, guide);
    if (!briefs.ok) return briefs;
    const trusts = await readSectionTrusts(
      member,
      tx,
      briefs.value.map(({ section }) => section.citedIris),
      at,
    );
    if (!trusts.ok) return trusts;
    const sections = briefs.value.map((carried, index) => {
      const trust = trusts.value[index];
      if (trust === undefined) throw new Error(`section ${carried.section.sectionId} has no trust`);
      return { ...carried, trustWords: trustWords(trust) };
    });
    return ok({ guide, sections });
  };

const titleOf = (guide: GuideRead): string => guide.subject?.title ?? guide.collection;

const slugOf = (title: string): string =>
  title
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, "-")
    .replaceAll(/^-|-$/gu, "");

const sectionMarkdown = ({ section, brief, trustWords: words }: Carried): string =>
  [
    `${"#".repeat(Math.min(6, 1 + section.number.split(".").length))} ${section.number} ${section.prompt}`,
    `*${words}*`,
    renderBrief(brief.markdown, brief.includes, "snapshot"),
  ].join("\n\n");

const markdownOf = ({ guide, sections }: GuideCarried, at: Date): string =>
  `${[
    `# ${titleOf(guide)}`,
    `Guide snapshot, ${ukLongDate(at.toISOString())}. Not maintained. It does not change when the guide does.`,
    ...sections.map(sectionMarkdown),
  ].join("\n\n")}\n`;

export const exportGuideSnapshot = async (
  principal: UserPrincipal,
  door: PostgresDoor,
  input: ExportGuideInput,
): Promise<
  Result<
    { readonly name: string; readonly markdown: string; readonly sections: number },
    ExportRefusal
  >
> => {
  const admitted = admit(exportGuideAction, principal, input);
  if (!admitted.ok) return err(admitted.error);
  return exported(admitted.value, door, input.at, {
    read: guideRead(input.guideId, input.at),
    made: (carried) =>
      ok({
        name: `guide-${slugOf(titleOf(carried.guide))}-${dayOf(input.at)}.md`,
        markdown: markdownOf(carried, input.at),
        sections: carried.sections.length,
      }),
    recorded: async (member, tx, { guide, sections }) => {
      for (const { section, brief } of sections) {
        // oxlint-disable-next-line eslint/no-await-in-loop -- every usage row is written on the caller's transaction
        const used = await recordUsage(member, tx, {
          subject: { writeUpId: section.writeUpId, version: brief.version },
          act: "exported",
        });
        if (!used.ok) throw normalizeError(used.error);
      }
      await record(member, tx, {
        id: ulid(),
        action: EXPORT_ACTIONS.guide,
        subjectId: guide.guideId,
        detail: { guideId: guide.guideId, sections: sections.length },
      });
    },
  });
};
