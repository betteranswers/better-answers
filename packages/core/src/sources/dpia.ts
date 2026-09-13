import { createHash } from "node:crypto";

import { boundarySchemas, RULES_IN_FORCE_KEYS, type REDACTION_TIERS } from "@better-answers/schema";

import {
  attempt,
  err,
  ok,
  requireAdmin,
  type Result,
  type RoleRefusal,
  type UserPrincipal,
} from "../kernel/index.ts";
import { listRoutes, type LlmPurpose } from "../llm/index.ts";
import type { Tx } from "../store/postgres/index.ts";

/**
 * The **DPIA input** (`CONTEXT.md`; ADR 0020; the S0 spec, *The DPIA input*): what one source
 * binding contributes to a data protection impact assessment, as a typed document and its
 * hash. S1's publish act calls this and carries the hash on the publish audit row, so the
 * assessment a company files and the publication it covers name the same document.
 *
 * **It invents nothing.** Where the platform holds no row — a route's retention tail, a
 * binding's scope, its retention class — the document says *not recorded*, because a DPIA that
 * guessed would be worse than one that admits the gap. Each such field's docblock names the
 * block that fills it.
 */

/** What the document says where the platform holds no row for a field it has to carry. */
export const NOT_RECORDED = "not recorded";

type RedactionTier = (typeof REDACTION_TIERS)[number];

/** One category the seam can raise: its word, the tier it is ordinarily raised at, and
 * whether it is the Article 9 one. */
export type RedactionCategory = {
  readonly category: string;
  readonly tier: RedactionTier;
  readonly specialCategory: boolean;
};

/**
 * The categories the app reads, declared here rather than in `packages/schema`: which
 * categories exist is the `redaction` agreement's (`contracts/redaction/cases.json`) and no
 * category list belongs in a migration, which `packages/schema/src/finding-tables.ts` says in
 * prose. Nothing imports `contracts/` (ADR 0031), so the conformance test in
 * `packages/core/test/redaction.contract.test.ts` is what holds this list and the agreement
 * to each other — a category added to one and not the other fails there.
 *
 * The worker's own category descriptors (T-121) are held to the same file from the other side.
 */
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

/**
 * What the platform holds about a person whatever the binding is configured to withhold, in
 * ADR 0020's own words (the 30/08/2026 amendment added the fourth). The seam runs over a
 * binding's documents; these four are the platform's own records, so a DPIA that listed only
 * the seam's categories would be missing them.
 */
export const PLATFORM_HELD_CATEGORIES = [
  "human:<email> in concept files",
  "the Person concept",
  "the per-binding LMDB",
  "authored concept bodies",
] as const;

/** When the platform expects to hold Article 9 data at all (ticket 63, 29/08/2026). */
export const SPECIAL_CATEGORY_CONDITION = "none until a health-sector client";

/**
 * The Article 9 category's own word, read off the declared list rather than written a second
 * time. A list with none is *not recorded* — the fail-closed reading, and the conformance test
 * is what keeps the agreement and the list from disagreeing about which category it is.
 */
const SPECIAL_CATEGORY =
  REDACTION_CATEGORIES.find((entry) => entry.specialCategory)?.category ?? NOT_RECORDED;

/**
 * The sub-processor a provider word names, and where it processes — only what the ADRs state.
 * `llm_route` carries neither column, so this is the declared table the document reads and not
 * a row; a provider word it does not name reads *not recorded* rather than a guess.
 *
 * Mistral is listed for completeness and is unreachable in v0.1: the embedding purpose is left
 * out of every document below, and no v0.1 block embeds anything (ADR 0020, amended
 * 2026-09-09). S2's model client is what makes the rest of this table matter.
 */
const SUB_PROCESSORS = new Map<string, { readonly processor: string; readonly country: string }>([
  ["anthropic", { processor: "Anthropic", country: "United States" }],
  ["mistral", { processor: "Mistral AI", country: "European Union" }],
  ["local", { processor: "no sub-processor", country: "the platform's own estate" }],
]);

/**
 * The purpose no DPIA input lists. A workspace's embedding route and its sub-processor appear
 * only from the day that route is first called (ADR 0020, amended 2026-09-09), and in v0.1 that
 * day never comes — so naming Mistral in a document no workspace's use justifies would be the
 * assessment overstating what the platform does.
 */
const EXCLUDED_PURPOSE: LlmPurpose = "embedding";

/** One route as the document prints it: the choice, its sub-processor, and what it keeps. */
export type DpiaRoute = {
  readonly purpose: string;
  readonly provider: string;
  readonly model: string;
  readonly processor: string;
  readonly country: string;
  /** The provider's own sentence, or *not recorded* until somebody has read its terms (S2). */
  readonly retentionTail: string;
};

/** The typed document, in the glossary's own field names (`CONTEXT.md`, *DPIA input*). */
export type DpiaInput = {
  readonly bindingId: string;
  /** The categories this binding's rules in force can raise, in the agreement's order. */
  readonly personalDataCategories: readonly string[];
  /** What the platform holds whatever the binding — `PLATFORM_HELD_CATEGORIES`. */
  readonly platformHeldCategories: readonly string[];
  readonly specialCategory: { readonly category: string; readonly condition: string };
  /** Which part of the source the binding covers. *Not recorded*: the column arrives with the
   * binding-management surface — S1 for upload, S4 for the connectors. */
  readonly scope: string;
  /** The binding's sensitivity class, as the row holds it. */
  readonly class: string;
  readonly rulesInForce: Readonly<Record<string, boolean>>;
  readonly routes: readonly DpiaRoute[];
  /** What the platform keeps of the binding's documents. *Not recorded*: the column arrives
   * with the same surface as `scope`. */
  readonly retentionClass: string;
  /** The audience word the binding carries; the groups a *groups* audience names are on its row. */
  readonly audience: string;
};

export type DpiaInputRefusal = RoleRefusal | "malformed" | "no-such-binding" | Error;

export type DpiaInputRead = {
  readonly document: DpiaInput;
  /** The document's sha-256 over its canonical form, hex — the ledger's content-hash shape. */
  readonly hash: string;
};

const BINDING_ID = boundarySchemas.sourceBinding.select.shape.id;
const RULES_IN_FORCE = boundarySchemas.sourceBinding.select.shape.rulesInForce;

type BindingRow = {
  readonly sensitivity: string;
  readonly audience: string;
  readonly rules_in_force: unknown;
};

/**
 * Whether a tier's categories are raised on a binding. The key a tier is switched by is the
 * tier word with its hyphen written as an underscore — the `redaction` agreement's
 * `binding_key`, derived from the tier rather than written down here a second time. A tier
 * with no key is not switchable, which is what makes the always set policy.
 */
const raisedUnder = (rulesInForce: Readonly<Record<string, boolean>>, tier: string): boolean => {
  const key = tier.replaceAll("-", "_");
  const switchable = RULES_IN_FORCE_KEYS.some((named) => named === key);
  return !switchable || rulesInForce[key] === true;
};

/** What a canonical form is written over: the values a typed document is made of. */
type Canonical =
  | string
  | number
  | boolean
  | null
  | readonly Canonical[]
  | { readonly [field: string]: Canonical };

/**
 * The document as one string, keys in sorted order at every depth, so the hash turns on what
 * the document says and not on the order the fields happen to be written in. Two reads of an
 * unchanged binding give the same string; a binding whose rules in force moved gives another.
 */
const canonical = (value: Canonical): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).toSorted(([left], [right]) => (left < right ? -1 : 1));
    const fields = entries.map(([key, held]) => `${JSON.stringify(key)}:${canonical(held)}`);
    return `{${fields.join(",")}}`;
  }
  return JSON.stringify(value);
};

/**
 * One binding's DPIA input and its hash, read as an Admin inside the caller's transaction.
 *
 * **An Admin's**, as the publish act that will call it is and as the slice's other act is: the
 * document names every category the binding can raise and every sub-processor its workspace
 * sends text to, which is the workspace's own compliance picture and not a reader's.
 *
 * The routes come through the `llm` slice's own door (`listRoutes`), so the route table stays
 * behind its owner and no SQL against it is written here. Two purposes are left out: the
 * embedding one, always (ADR 0020, amended 2026-09-09), and any purpose the workspace has not
 * configured — `listRoutes` answers one route per purpose whether or not a row exists, and a
 * choice nobody made is not a processor anybody sends anything to.
 *
 * A read, so it writes no row and records no act — a read is not an act on the ledger. The hash
 * is what the publish act records when it lands.
 */
export const dpiaInputFor = async (
  principal: UserPrincipal,
  tx: Tx,
  input: { readonly bindingId: string },
): Promise<Result<DpiaInputRead, DpiaInputRefusal>> => {
  const admin = requireAdmin(principal);
  if (!admin.ok) return err(admin.error);
  const bindingId = BINDING_ID.safeParse(input.bindingId);
  if (!bindingId.success) return err("malformed");
  const { workspaceId } = admin.value;

  const known = await attempt(() =>
    tx.query<BindingRow>(
      "SELECT sensitivity, audience, rules_in_force FROM source_binding WHERE workspace_id = $1 AND id = $2",
      [workspaceId, bindingId.data],
    ),
  );
  if (!known.ok) return err(known.error);
  const binding = known.value.rows[0];
  if (binding === undefined) return err("no-such-binding");

  const parsed = RULES_IN_FORCE.safeParse(binding.rules_in_force);
  // The column's CHECK refuses both a shape outside the two keys and the JSON null, so a row
  // that fails here is a broken database rather than a binding a caller could put right.
  if (!parsed.success || parsed.data === null) {
    return err(new Error("the binding's rules in force are not the shape the column holds"));
  }
  const rulesInForce: Readonly<Record<string, boolean>> = parsed.data;

  const listed = await listRoutes(admin.value, tx);
  if (!listed.ok) return err(listed.error);

  const document: DpiaInput = {
    bindingId: bindingId.data,
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
