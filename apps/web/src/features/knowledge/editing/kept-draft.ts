import { useEffect } from "react";
import { z } from "zod";

import { inThisTab, keepInThisTab } from "@/shared/browser-storage.ts";

import type { Draft, EditorState, EditTarget } from "./concept-editing.ts";

export const sameDraft = (one: Draft, other: Draft): boolean =>
  one.title === other.title &&
  one.kind === other.kind &&
  one.description === other.description &&
  one.tags === other.tags &&
  one.body === other.body &&
  JSON.stringify(one.sources) === JSON.stringify(other.sources);

const SOURCE_ENTRY = z.union([
  z.string(),
  z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])),
]);

const KEPT_DRAFT = z.object({
  base: z.string().nullable(),
  draft: z.object({
    title: z.string(),
    kind: z.string(),
    description: z.string(),
    tags: z.string(),
    body: z.string(),
    sources: z.array(SOURCE_ENTRY),
  }),
});

/** A new concept has no address, so its draft is kept under the title it was opened with. */
export const draftKeyOf = (
  person: string | undefined,
  target: EditTarget,
  openedTitle: string | undefined,
): string | undefined => {
  if (person === undefined) return undefined;
  if (target.kind === "concept") return `better-answers.concept-draft.${person}.${target.iri}`;
  return openedTitle === undefined
    ? undefined
    : `better-answers.new-concept-draft.${person}.${openedTitle}`;
};

export const keptDraftOf = (key: string | undefined, base: string | null): Draft | undefined => {
  const raw = key === undefined ? null : inThisTab()?.getItem(key);
  if (raw === null || raw === undefined) return undefined;
  try {
    const kept = KEPT_DRAFT.safeParse(JSON.parse(raw));
    return kept.success && kept.data.base === base ? kept.data.draft : undefined;
  } catch {
    return undefined;
  }
};

export const forgetDraft = (key: string | undefined): void => {
  if (key !== undefined) inThisTab()?.removeItem(key);
};

export const useKeptDraft = (
  key: string | undefined,
  state: EditorState,
  baseline: Draft | undefined,
) => {
  const held = "open" in state ? state.open : undefined;
  const draft = held?.draft;
  const base = held?.read.base;
  useEffect(() => {
    if (key === undefined || draft === undefined) return;
    if (baseline === undefined || base === undefined) return;
    if (sameDraft(draft, baseline)) forgetDraft(key);
    else keepInThisTab(key, JSON.stringify({ base, draft }));
  }, [key, draft, base, baseline]);
};
