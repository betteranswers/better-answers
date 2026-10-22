import { foldKind } from "../bundle/index.ts";
import type { UserPrincipal } from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import type {
  GuideLayer,
  RoleLabel,
  SectionTemplate,
  Template,
  TemplateRole,
} from "./templates/index.ts";

export type GuidePlacement = {
  readonly guideId: string;
  readonly collection: string;
  readonly subjectIri: string | null;
};

type SectionRow = {
  readonly id: string;
  readonly parentId: string | null;
  readonly ordinal: number;
  readonly prompt: string;
  readonly roleLabel: RoleLabel;
  readonly usageNote: string | null;
  readonly layers: readonly GuideLayer[];
  readonly hidden: boolean;
};

type ExpectedFactRow = {
  readonly id: string;
  readonly sectionId: string;
  readonly ordinal: number;
  readonly name: string;
  readonly kind: string;
  readonly tags: readonly string[];
  readonly collection: string | null;
  readonly atLeast: number;
};

export type GuideRows = {
  readonly definition: {
    readonly id: string;
    readonly template: string;
    readonly kind: string;
    readonly collection: string;
    readonly subjectIri: string | null;
  };
  readonly roles: readonly TemplateRole[];

  /** In tree order, each section before the sections inside it. */
  readonly sections: readonly SectionRow[];
  readonly facts: readonly ExpectedFactRow[];
};

const sectionRowsOf = (
  templates: readonly SectionTemplate[],
  parentId: string | null,
  mint: () => string,
  into: { readonly sections: SectionRow[]; readonly facts: ExpectedFactRow[] },
): void => {
  for (const [ordinal, template] of templates.entries()) {
    const id = mint();
    const { prompt, roleLabel, usageNote, layers, hidden } = template;
    into.sections.push({ id, parentId, ordinal, prompt, roleLabel, usageNote, layers, hidden });
    for (const [factOrdinal, fact] of template.expects.entries()) {
      into.facts.push({
        id: mint(),
        sectionId: id,
        ordinal: factOrdinal,
        name: fact.name,
        kind: foldKind(fact.kind),
        tags: fact.tags,
        collection: fact.collection ?? null,
        atLeast: fact.atLeast ?? 1,
      });
    }
    sectionRowsOf(template.sections, id, mint, into);
  }
};

export const guideRowsOf = (
  template: Template,
  placement: GuidePlacement,
  mint: () => string,
): GuideRows => {
  const sections: SectionRow[] = [];
  const facts: ExpectedFactRow[] = [];
  sectionRowsOf(template.sections, null, mint, { sections, facts });
  return {
    definition: {
      id: placement.guideId,
      template: template.id,
      kind: template.kind,
      collection: placement.collection,
      subjectIri: placement.subjectIri,
    },
    roles: template.roles,
    sections,
    facts,
  };
};

export type GuideDefinition = {
  readonly id: string;
  readonly template: string;
  readonly kind: string;
  readonly collection: string;
  readonly subjectIri: string | null;
  readonly roles: readonly TemplateRole[];
  readonly sections: readonly {
    readonly id: string;
    readonly parentId: string | null;
    readonly ordinal: number;
    readonly prompt: string;
    readonly roleLabel: RoleLabel;

    /** The expected facts' names, in ordinal order. */
    readonly facts: readonly string[];
  }[];
};

export const definitionOf = (rows: GuideRows): GuideDefinition => ({
  ...rows.definition,
  roles: rows.roles,
  sections: rows.sections.map(({ id, parentId, ordinal, prompt, roleLabel }) => ({
    id,
    parentId,
    ordinal,
    prompt,
    roleLabel,
    facts: rows.facts.filter((fact) => fact.sectionId === id).map((fact) => fact.name),
  })),
});

type DefinitionRow = Omit<GuideDefinition, "roles" | "sections">;

const DEFINITION = `SELECT id, template, kind, collection, subject_iri AS "subjectIri"
  FROM guide_definition WHERE workspace_id = $1 AND id = $2`;

const ROLES_OF = `SELECT role, default_layer AS "defaultLayer", action_threshold AS "actionThreshold"
  FROM guide_role WHERE workspace_id = $1 AND guide_id = $2`;

const SECTIONS_OF = `SELECT s.id, s.parent_id AS "parentId", s.ordinal, s.prompt,
       s.role_label AS "roleLabel",
       COALESCE((SELECT array_agg(f.name ORDER BY f.ordinal) FROM guide_expected_fact f
                  WHERE f.workspace_id = s.workspace_id AND f.guide_id = s.guide_id
                    AND f.section_id = s.id), '{}') AS facts
  FROM guide_section s WHERE s.workspace_id = $1 AND s.guide_id = $2`;

export const definitionAt = async (
  principal: UserPrincipal,
  tx: Tx,
  guideId: string,
): Promise<GuideDefinition | undefined> => {
  const parameters = [principal.workspaceId, guideId];
  const definition = (await tx.query<DefinitionRow>(DEFINITION, parameters)).rows[0];
  if (definition === undefined) return undefined;
  const roles = await tx.query<TemplateRole>(ROLES_OF, parameters);
  const sections = await tx.query<GuideDefinition["sections"][number]>(SECTIONS_OF, parameters);
  return { ...definition, roles: roles.rows, sections: sections.rows };
};

export const insertGuideRows = async (
  principal: UserPrincipal,
  tx: Tx,
  rows: GuideRows,
): Promise<void> => {
  const { id, template, kind, collection, subjectIri } = rows.definition;
  const scoped = [principal.workspaceId, id];
  await tx.query(
    `INSERT INTO guide_definition (workspace_id, id, template, kind, collection, subject_iri)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [...scoped, template, kind, collection, subjectIri],
  );
  await tx.query(
    `INSERT INTO guide_role (workspace_id, guide_id, role, default_layer, action_threshold)
     SELECT $1, $2, r.role, r."defaultLayer", r."actionThreshold"
       FROM jsonb_to_recordset($3::jsonb)
         AS r(role text, "defaultLayer" text, "actionThreshold" text)`,
    [...scoped, JSON.stringify(rows.roles)],
  );
  await tx.query(
    `INSERT INTO guide_section (workspace_id, guide_id, id, parent_id, ordinal, prompt, role_label,
                                usage_note, layers, hidden)
     SELECT $1, $2, s.id, s."parentId", s.ordinal, s.prompt, s."roleLabel", s."usageNote",
            s.layers, s.hidden
       FROM jsonb_to_recordset($3::jsonb)
         AS s(id text, "parentId" text, ordinal int, prompt text, "roleLabel" text,
              "usageNote" text, layers text[], hidden boolean)`,
    [...scoped, JSON.stringify(rows.sections)],
  );
  await tx.query(
    `INSERT INTO guide_expected_fact (workspace_id, guide_id, id, section_id, ordinal, name, kind,
                                      tags, collection, at_least)
     SELECT $1, $2, f.id, f."sectionId", f.ordinal, f.name, f.kind, f.tags, f.collection,
            f."atLeast"
       FROM jsonb_to_recordset($3::jsonb)
         AS f(id text, "sectionId" text, ordinal int, name text, kind text, tags text[],
              collection text, "atLeast" int)`,
    [...scoped, JSON.stringify(rows.facts)],
  );
};
