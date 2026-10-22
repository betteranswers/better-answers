import { foldKind } from "../bundle/index.ts";
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
