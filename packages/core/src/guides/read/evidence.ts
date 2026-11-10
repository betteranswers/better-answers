import type { EvidencePane, Frontmatter } from "../../concepts/index.ts";
import { ok, type Result } from "../../kernel/index.ts";

export type DetailEvidence = EvidencePane["evidence"];

export type EvidenceOf = (frontmatter: Frontmatter) => Promise<Result<DetailEvidence>>;

type Cited = {
  readonly iri: string;
  readonly write_up_id: string;
  readonly frontmatter: Frontmatter;
};

export type Evidenced<Row extends Cited> = Row & { readonly evidence: DetailEvidence };

export const withEvidence = async <Row extends Cited>(
  cited: readonly Row[],
  evidenceOf: EvidenceOf,
  showing: ReadonlySet<string>,
): Promise<Result<readonly Evidenced<Row>[]>> => {
  const held = new Map<string, DetailEvidence>();
  const read: Evidenced<Row>[] = [];
  for (const row of cited) {
    if (!showing.has(row.write_up_id)) {
      read.push({ ...row, evidence: [] });
      continue;
    }
    let evidence = held.get(row.iri);
    if (evidence === undefined) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- every concept is read on the reader's one transaction
      const resolved = await evidenceOf(row.frontmatter);
      if (!resolved.ok) return resolved;
      evidence = resolved.value;
      held.set(row.iri, evidence);
    }
    read.push({ ...row, evidence });
  }
  return ok(read);
};
