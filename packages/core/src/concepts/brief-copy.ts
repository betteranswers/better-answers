import { z } from "zod";

import { boundarySchemas } from "@better-answers/schema";

import {
  briefToCopy,
  renderBrief,
  type BriefToCopy,
  type ClipboardBrief,
} from "../guides/index.ts";
import {
  admit,
  ANY_ROLE,
  declareAction,
  err,
  NOT_FOUND,
  ok,
  type RefusalOf,
  type Result,
  type UserPrincipal,
} from "../kernel/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import { recordUsage } from "../usage/index.ts";
import { readSectionTrusts } from "./reading/browse.ts";
import { standsOn } from "./trust.ts";

export const briefCopyInput = z.strictObject({
  writeUpId: boundarySchemas.writeUp.select.shape.id,
});

export const recordCopyInput = z.strictObject({
  writeUpId: boundarySchemas.writeUp.select.shape.id,
  version: boundarySchemas.writeUpVersion.select.shape.version,
});

type BriefCopyInput = z.input<typeof briefCopyInput>;

type RecordCopyInput = z.input<typeof recordCopyInput>;

const briefCopyAction = declareAction({
  admits: ANY_ROLE,
  input: z.custom<BriefCopyInput>(),
  refuses: ["role-forbids", "not-found", "below-action-threshold"],
});

const recordCopyAction = declareAction({
  admits: ANY_ROLE,
  input: z.custom<RecordCopyInput>(),
  refuses: ["role-forbids", "not-found", "below-action-threshold"],
});

export type BriefCopyRefusal = RefusalOf<typeof briefCopyAction> | Error;

export type RecordCopyRefusal = RefusalOf<typeof recordCopyAction> | Error;

export type CopiedBrief = ClipboardBrief & { readonly version: number };

type Copiable = Result<BriefToCopy, BriefCopyRefusal>;

const copiable = async (
  reader: UserPrincipal,
  tx: Tx,
  input: BriefCopyInput & { readonly version?: number },
  now: Date,
): Promise<Copiable> => {
  const brief = await briefToCopy(reader, tx, input);
  if (!brief.ok) return brief;
  const held = brief.value;
  if (held === undefined || held.markdown.trim() === "") return err(NOT_FOUND);

  const trusts = await readSectionTrusts(reader, tx, [held.includes.map(({ iri }) => iri)], now);
  if (!trusts.ok) return trusts;
  const weakest = trusts.value[0];
  if (weakest === undefined) return err(new Error("the section's trust was not read"));
  return standsOn(weakest, held.threshold) ? ok(held) : err("below-action-threshold");
};

export const briefCopy = async (
  principal: UserPrincipal,
  tx: Tx,
  input: BriefCopyInput,
  now: Date,
): Promise<Result<CopiedBrief, BriefCopyRefusal>> => {
  const admitted = admit(briefCopyAction, principal, input);
  if (!admitted.ok) return err(admitted.error);
  const copy = await copiable(admitted.value, tx, input, now);
  if (!copy.ok) return copy;
  const { version, markdown, includes } = copy.value;
  return ok({ version, ...renderBrief(markdown, includes, "clipboard") });
};

export const recordCopy = async (
  principal: UserPrincipal,
  tx: Tx,
  input: RecordCopyInput,
  now: Date,
): Promise<Result<{ readonly id: string }, RecordCopyRefusal>> => {
  const admitted = admit(recordCopyAction, principal, input);
  if (!admitted.ok) return err(admitted.error);
  const copy = await copiable(admitted.value, tx, input, now);
  if (!copy.ok) return copy;
  return recordUsage(admitted.value, tx, {
    subject: { writeUpId: input.writeUpId, version: input.version },
    act: "copied",
  });
};
