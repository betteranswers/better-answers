import { getTableName } from "drizzle-orm";

import { err, ok, type Result } from "@better-answers/core/kernel";
import {
  CHOOSABLE_PROVIDERS,
  FIXED_PURPOSE,
  LLM_PURPOSES,
  DECISION_PROVIDERS,
} from "@better-answers/core/llm";
import { tablesPresent } from "@better-answers/core/store/postgres";
import {
  BOOTSTRAP,
  setDecisionThreshold,
  setModelChoice,
  setModelKey,
  setModelPrice,
  setSpendingLimit,
  type SetDecisionThresholdRefusal,
  type SetModelChoiceRefusal,
  type SetModelKeyRefusal,
  type SetSpendingLimitRefusal,
} from "@better-answers/core/workspaces";
import { decisionThreshold, MODEL_PROVIDERS, modelPrice } from "@better-answers/schema";

import type { Doors } from "../doors.ts";
import { DONE, REFUSED, NOT_BUILT, type OpsIo, type Flags, flagValue, exitOf } from "./cli.ts";
import { noSuchWorkspace } from "./workspaces.ts";

export const CHOSEN_PURPOSES = LLM_PURPOSES.filter((purpose) => purpose !== FIXED_PURPOSE);

const MODEL_KEY_USAGE = `--workspace <id> and --provider <${MODEL_PROVIDERS.join("|")}> are required, with the key on standard input`;

const modelKeyReason = (refusal: SetModelKeyRefusal | Error, workspaceId: string): string => {
  if (refusal instanceof Error) return refusal.message;
  switch (refusal) {
    case "malformed":
      return `malformed: give --workspace a workspace id, --provider one of ${MODEL_PROVIDERS.join(" · ")}, and on standard input one key with no space or line break in it, for cloudflare the account id, a colon, then the API token`;
    case "no-such-workspace":
      return noSuchWorkspace(workspaceId);
  }
};

type SetModelKeyAsked = { readonly provider: string };

export const setModelKeyAskedOf = (flags: Flags): Result<SetModelKeyAsked, string> => {
  const provider = flagValue(flags, "provider");
  return provider === undefined ? err(MODEL_KEY_USAGE) : ok({ provider });
};

export const setModelKeyCommand = async (
  doors: Doors,
  workspaceId: string,
  { provider }: SetModelKeyAsked,
  io: OpsIo,
): Promise<number> => {
  if (!io.modelKeySetting.ok) {
    io.say(`set-model-key: REFUSED — ${io.modelKeySetting.error}; nothing changed`);
    return REFUSED;
  }
  const typed = await io.stdin();
  const set = await setModelKey(BOOTSTRAP, doors.postgres, io.modelKeySetting.value, {
    workspaceId,
    provider,
    key: typed.replace(/\r?\n$/u, ""),
  });
  if (!set.ok) {
    io.say(`set-model-key: REFUSED — ${modelKeyReason(set.error, workspaceId)}`);
    return exitOf(set.error);
  }
  io.say(
    `set-model-key: done — workspace ${workspaceId} holds a new key for ${set.value.provider}`,
  );
  return DONE;
};

const spendingLimitReason = (
  refusal: SetSpendingLimitRefusal | Error,
  workspaceId: string,
): string => {
  if (refusal instanceof Error) return refusal.message;
  switch (refusal) {
    case "malformed":
      return "malformed: give --workspace a workspace id and --gbp a sum in pounds, such as 50 or 12.50";
    case "no-such-workspace":
      return noSuchWorkspace(workspaceId);
  }
};

type SetSpendingLimitAsked = { readonly gbp: string };

export const setSpendingLimitAskedOf = (flags: Flags): Result<SetSpendingLimitAsked, string> => {
  const gbp = flagValue(flags, "gbp");
  return gbp === undefined
    ? err("--workspace <id> and --gbp <pounds a month> are required")
    : ok({ gbp });
};

export const setSpendingLimitCommand = async (
  doors: Doors,
  workspaceId: string,
  { gbp }: SetSpendingLimitAsked,
  io: OpsIo,
): Promise<number> => {
  const set = await setSpendingLimit(BOOTSTRAP, doors.postgres, { workspaceId, gbp });
  if (!set.ok) {
    io.say(`set-spending-limit: REFUSED — ${spendingLimitReason(set.error, workspaceId)}`);
    return exitOf(set.error);
  }
  io.say(
    `set-spending-limit: done — workspace ${workspaceId} may spend £${set.value.gbp} on model calls each calendar month`,
  );
  return DONE;
};

const MODEL_CHOICE_FLAGS = ["purpose", "provider", "model"] as const;

const MODEL_CHOICE_USAGE = `--workspace <id>, --purpose <${CHOSEN_PURPOSES.join("|")}>, --provider <provider> and --model <model> are required`;

const modelChoiceReason = (
  refusal: SetModelChoiceRefusal | Error,
  asked: { readonly workspaceId: string; readonly provider: string; readonly model: string },
): string => {
  if (refusal instanceof Error) return refusal.message;
  switch (refusal) {
    case "malformed":
      return `malformed: give --workspace a workspace id, --purpose one of ${CHOSEN_PURPOSES.join(" · ")}, and --provider and --model in lower case letters, digits, dots and hyphens`;
    case "no-such-workspace":
      return noSuchWorkspace(asked.workspaceId);
    case "fixed-model-choice":
      return "fixed-model-choice: the embedding model is fixed, since the index's vectors are its own; nothing changed";
    case "no-decision-threshold":
      return `no-decision-threshold: ${asked.provider} ${asked.model} is a decision model with no threshold; set one with set-decision-threshold first; nothing changed`;
    case "no-sub-processor":
      return `no-sub-processor: ${asked.provider} is no model provider the DPIA names as a sub-processor (${[...CHOOSABLE_PROVIDERS].join(" · ")}); nothing changed`;
    case "no-model-price":
      return `no-model-price: ${asked.provider} ${asked.model} has no price in effect today; set one with set-model-price first; nothing changed`;
  }
};

type SetModelChoiceAsked = {
  readonly purpose: string;
  readonly provider: string;
  readonly model: string;
};

export const setModelChoiceAskedOf = (flags: Flags): Result<SetModelChoiceAsked, string> => {
  const [purpose, provider, model] = MODEL_CHOICE_FLAGS.map((name) => flagValue(flags, name));
  return purpose === undefined || provider === undefined || model === undefined
    ? err(MODEL_CHOICE_USAGE)
    : ok({ purpose, provider, model });
};

export const setModelChoiceCommand = async (
  doors: Doors,
  workspaceId: string,
  { purpose, provider, model }: SetModelChoiceAsked,
  io: OpsIo,
): Promise<number> => {
  const asked = { workspaceId, purpose, provider, model };
  const set = await setModelChoice(BOOTSTRAP, doors.postgres, { ...asked, now: doors.clock.now() });
  if (!set.ok) {
    io.say(`set-model-choice: REFUSED — ${modelChoiceReason(set.error, asked)}`);
    return exitOf(set.error);
  }
  const chosen = set.value;
  io.say(
    `set-model-choice: done — workspace ${workspaceId} calls ${chosen.provider} ${chosen.model} for ${chosen.purpose}`,
  );
  return DONE;
};

const MODEL_PRICE_FLAGS = [
  "provider",
  "model",
  "from",
  "gbp-per-million-in",
  "gbp-per-million-out",
] as const;

const MODEL_PRICE_NAMED = `--provider <${MODEL_PROVIDERS.join("|")}>, --model <model>, --from <yyyy-mm-dd>, --gbp-per-million-in <pounds> and --gbp-per-million-out <pounds>`;

const MODEL_PRICE_USAGE = `${MODEL_PRICE_NAMED} are required`;

type SetModelPriceAsked = {
  readonly provider: string;
  readonly model: string;
  readonly effectiveFrom: string;
  readonly gbpPerMillionIn: string;
  readonly gbpPerMillionOut: string;
};

export const setModelPriceAskedOf = (flags: Flags): Result<SetModelPriceAsked, string> => {
  const named = MODEL_PRICE_FLAGS.map((name) => flagValue(flags, name));
  const [provider, model, effectiveFrom, gbpPerMillionIn, gbpPerMillionOut] = named;
  return provider === undefined ||
    model === undefined ||
    effectiveFrom === undefined ||
    gbpPerMillionIn === undefined ||
    gbpPerMillionOut === undefined
    ? err(MODEL_PRICE_USAGE)
    : ok({ provider, model, effectiveFrom, gbpPerMillionIn, gbpPerMillionOut });
};

export const setModelPriceCommand = async (
  doors: Doors,
  { provider, model, effectiveFrom, gbpPerMillionIn, gbpPerMillionOut }: SetModelPriceAsked,
  io: OpsIo,
): Promise<number> => {
  const price = { provider, model, effectiveFrom, gbpPerMillionIn, gbpPerMillionOut };
  const table = getTableName(modelPrice);
  if ((await tablesPresent(doors.postgres, [table])).length === 0) {
    io.say(`set-model-price: not built — ${table} absent from this schema`);
    return NOT_BUILT;
  }
  const set = await setModelPrice(BOOTSTRAP, doors.postgres, price);
  if (!set.ok) {
    const reason =
      set.error === "malformed"
        ? `malformed: ${MODEL_PRICE_NAMED}, the model lower case letters, digits, dots and hyphens, the day one the calendar has and each sum in pounds a decimal such as 3 or 0.25`
        : set.error.message;
    io.say(`set-model-price: REFUSED — ${reason}`);
    return exitOf(set.error);
  }
  io.say(
    `set-model-price: done — ${set.value.provider} ${set.value.model} is priced from ${set.value.effectiveFrom}`,
  );
  return DONE;
};

const THRESHOLD_FLAGS = ["provider", "model", "threshold"] as const;

const THRESHOLD_NAMED = `--provider <${DECISION_PROVIDERS.join("|")}>, --model <model> and --threshold <probability>`;

const THRESHOLD_USAGE = `${THRESHOLD_NAMED} are required`;

type SetDecisionThresholdAsked = {
  readonly provider: string;
  readonly model: string;
  readonly threshold: string;
};

export const setDecisionThresholdAskedOf = (
  flags: Flags,
): Result<SetDecisionThresholdAsked, string> => {
  const [provider, model, threshold] = THRESHOLD_FLAGS.map((name) => flagValue(flags, name));
  return provider === undefined || model === undefined || threshold === undefined
    ? err(THRESHOLD_USAGE)
    : ok({ provider, model, threshold });
};

export const setDecisionThresholdCommand = async (
  doors: Doors,
  { provider, model, threshold }: SetDecisionThresholdAsked,
  io: OpsIo,
): Promise<number> => {
  const table = getTableName(decisionThreshold);
  if ((await tablesPresent(doors.postgres, [table])).length === 0) {
    io.say(`set-decision-threshold: not built — ${table} absent from this schema`);
    return NOT_BUILT;
  }
  const set = await setDecisionThreshold(BOOTSTRAP, doors.postgres, { provider, model, threshold });
  if (!set.ok) {
    io.say(`set-decision-threshold: REFUSED — ${thresholdReason(set.error, provider)}`);
    return exitOf(set.error);
  }
  io.say(
    `set-decision-threshold: done — ${set.value.provider} ${set.value.model} judges at ${String(set.value.threshold)}`,
  );
  return DONE;
};

const thresholdReason = (
  refusal: SetDecisionThresholdRefusal | Error,
  provider: string,
): string => {
  if (refusal instanceof Error) return refusal.message;
  switch (refusal) {
    case "malformed":
      return `malformed: ${THRESHOLD_NAMED}, the model lower case letters, digits, dots and hyphens and the threshold a decimal between 0 and 1, such as 0.7`;
    case "not-a-decision-model":
      return `not-a-decision-model: ${provider} speaks no decision shape; only ${DECISION_PROVIDERS.join(" · ")} take a threshold; nothing changed`;
  }
};
