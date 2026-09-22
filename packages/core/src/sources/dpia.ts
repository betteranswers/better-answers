import { createHash } from "node:crypto";

import { boundarySchemas, RULES_IN_FORCE_KEYS, type REDACTION_TIERS } from "@better-answers/schema";
import { z } from "zod";

import { err, ok, type Result, type UserPrincipal } from "../kernel/index.ts";
import { listRoutes, type LlmPurpose } from "../llm/index.ts";
import type { Tx } from "../store/postgres/index.ts";
import { adminOnBinding, bindingNamed, BINDING_ID } from "./admin-binding.ts";
import type { SourceRefusal } from "./vocabulary.ts";

export const NOT_RECORDED = "not recorded";

type RedactionTier = (typeof REDACTION_TIERS)[number];

export type RedactionCategory = {
  readonly category: string;
  readonly tier: RedactionTier;
  readonly specialCategory: boolean;
};

export const REDACTION_CATEGORIES = [
  { category: "special-category", tier: "always", specialCategory: true },
  { category: "bank-details", tier: "always", specialCategory: false },
  { category: "government-identifier", tier: "always", specialCategory: false },
  { category: "date-of-birth", tier: "default-on", specialCategory: false },
  { category: "home-address", tier: "default-on", specialCategory: false },
  { category: "personal-contact", tier: "default-on", specialCategory: false },
  { category: "person-name", tier: "default-off", specialCategory: false },
  { category: "job-title", tier: "default-off", specialCategory: false },
] as const satisfies readonly RedactionCategory[];

export const PLATFORM_HELD_CATEGORIES = [
  "human:<email> in concept files",
  "the Person concept",
  "the per-binding LMDB",
  "authored concept bodies",
] as const;

export const SPECIAL_CATEGORY_CONDITION = "none until a health-sector client";

const SPECIAL_CATEGORY =
  REDACTION_CATEGORIES.find((entry) => entry.specialCategory)?.category ?? NOT_RECORDED;

const SUB_PROCESSORS = new Map<string, { readonly processor: string; readonly country: string }>([
  ["anthropic", { processor: "Anthropic", country: "United States" }],
  ["mistral", { processor: "Mistral AI", country: "European Union" }],
  ["local", { processor: "no sub-processor", country: "the platform's own estate" }],
]);

const EXCLUDED_PURPOSE: LlmPurpose = "embedding";

export type DpiaRoute = {
  readonly purpose: string;
  readonly provider: string;
  readonly model: string;
  readonly processor: string;
  readonly country: string;

  readonly retentionTail: string;
};

export type DpiaInput = {
  readonly bindingId: string;

  readonly personalDataCategories: readonly string[];

  readonly platformHeldCategories: readonly string[];
  readonly specialCategory: { readonly category: string; readonly condition: string };

  readonly scope: string;

  readonly class: string;
  readonly rulesInForce: Readonly<Record<string, boolean>>;
  readonly routes: readonly DpiaRoute[];

  readonly retentionClass: string;

  readonly audience: string;
};

export const dpiaReadInput = z.object({ bindingId: BINDING_ID });

export type DpiaReadInput = z.output<typeof dpiaReadInput>;

export type DpiaInputRefusal = SourceRefusal<"role-forbids" | "no-such-binding"> | Error;

export type DpiaInputRead = {
  readonly document: DpiaInput;

  readonly hash: string;
};

const RULES_IN_FORCE = boundarySchemas.sourceBinding.select.shape.rulesInForce;

type BindingRow = {
  readonly sensitivity: string;
  readonly audience: string;
  readonly rules_in_force: unknown;
};

const raisedUnder = (rulesInForce: Readonly<Record<string, boolean>>, tier: string): boolean => {
  const key = tier.replaceAll("-", "_");
  const switchable = RULES_IN_FORCE_KEYS.some((named) => named === key);
  return !switchable || rulesInForce[key] === true;
};

type Canonical =
  | string
  | number
  | boolean
  | null
  | readonly Canonical[]
  | { readonly [field: string]: Canonical };

const canonical = (value: Canonical): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).toSorted(([left], [right]) => (left < right ? -1 : 1));
    const fields = entries.map(([key, held]) => `${JSON.stringify(key)}:${canonical(held)}`);
    return `{${fields.join(",")}}`;
  }
  return JSON.stringify(value);
};

export const dpiaInputFor = async (
  principal: UserPrincipal,
  tx: Tx,
  input: DpiaReadInput,
): Promise<Result<DpiaInputRead, DpiaInputRefusal>> => {
  const acting = adminOnBinding(principal, input.bindingId);
  if (!acting.ok) return err(acting.error);
  const { admin, bindingId } = acting.value;

  const read = await bindingNamed<BindingRow>(acting.value, tx, {
    columns: "sensitivity, audience, rules_in_force",
    lock: "none",
  });
  if (!read.ok) return err(read.error);
  const binding = read.value;

  const parsed = RULES_IN_FORCE.safeParse(binding.rules_in_force);

  if (!parsed.success || parsed.data === null) {
    return err(new Error("the binding's rules in force are not the shape the column holds"));
  }
  const rulesInForce: Readonly<Record<string, boolean>> = parsed.data;

  const listed = await listRoutes(admin, tx);
  if (!listed.ok) return err(listed.error);

  const document: DpiaInput = {
    bindingId,
    personalDataCategories: REDACTION_CATEGORIES.filter((entry) =>
      raisedUnder(rulesInForce, entry.tier),
    ).map((entry) => entry.category),
    platformHeldCategories: [...PLATFORM_HELD_CATEGORIES],
    specialCategory: { category: SPECIAL_CATEGORY, condition: SPECIAL_CATEGORY_CONDITION },
    scope: NOT_RECORDED,
    class: binding.sensitivity,
    rulesInForce,
    routes: listed.value.flatMap((route) => {
      if (route.purpose === EXCLUDED_PURPOSE) return [];
      if (route.provider === null || route.model === null) return [];
      const named = SUB_PROCESSORS.get(route.provider);
      return [
        {
          purpose: route.purpose,
          provider: route.provider,
          model: route.model,
          processor: named?.processor ?? NOT_RECORDED,
          country: named?.country ?? NOT_RECORDED,
          retentionTail: route.retentionTail ?? NOT_RECORDED,
        },
      ];
    }),
    retentionClass: NOT_RECORDED,
    audience: binding.audience,
  };

  return ok({ document, hash: createHash("sha256").update(canonical(document)).digest("hex") });
};
