import { z } from "zod";

import type { Keystroke } from "@/shared/keystrokes.tsx";

export const ALL_KNOWLEDGE_KEYSTROKES = {} as const satisfies Readonly<Record<string, Keystroke>>;

export const KINDS_KEYSTROKES = {
  tail: { key: "t", action: "Switch Between Every Kind and Kinds With Two or Fewer Concepts" },
  open: { key: "o", action: "Open or Close the Collections of the Kind in Focus" },
} as const satisfies Readonly<Record<string, Keystroke>>;

export const KINDS_LIST = "kinds";

export const KINDS_TAIL_MAX = 2;

const KINDS_SORTS = ["kind", "-kind", "count", "-count"] as const;

export type KindsSort = (typeof KINDS_SORTS)[number];

const KINDS_TAILS = ["small"] as const;

export const KINDS_FIELDS = {
  sort: z.enum(KINDS_SORTS).catch("kind"),
  tail: z.enum(KINDS_TAILS).optional().catch(undefined),
};

type Sorted = { readonly id: string; readonly desc: boolean };

export const kindsSortedOf = (sort: KindsSort): Sorted => ({
  id: sort.replace(/^-/u, ""),
  desc: sort.startsWith("-"),
});

export const kindsSortOf = (sorted: Sorted): KindsSort | undefined =>
  KINDS_SORTS.find((sort) => sort === `${sorted.desc ? "-" : ""}${sorted.id}`);

export const EXPORTS_KEYSTROKES = {} as const satisfies Readonly<Record<string, Keystroke>>;
