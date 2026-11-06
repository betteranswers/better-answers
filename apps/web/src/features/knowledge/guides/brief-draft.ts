import { useEffect } from "react";
import { z } from "zod";

import { inThisTab, keepInThisTab } from "@/shared/browser-storage.ts";

import type { BriefState, Kept } from "./brief-editing.ts";

const KEPT_BRIEF = z.object({ markdown: z.string(), earlier: z.string().optional() });

export const draftKeyOf = (
  person: string | undefined,
  writeUpId: string,
  base: number,
): string | undefined =>
  person === undefined
    ? undefined
    : `better-answers.brief-draft.${person}.${writeUpId}.${String(base)}`;

export const keptBriefOf = (key: string | undefined): Kept | undefined => {
  const raw = key === undefined ? null : inThisTab()?.getItem(key);
  if (raw === null || raw === undefined) return undefined;
  try {
    const kept = KEPT_BRIEF.safeParse(JSON.parse(raw));
    return kept.success ? { markdown: kept.data.markdown, earlier: kept.data.earlier } : undefined;
  } catch {
    return undefined;
  }
};

export const forgetBrief = (key: string | undefined): void => {
  if (key !== undefined) inThisTab()?.removeItem(key);
};

export const useKeptBrief = (key: string | undefined, state: BriefState): void => {
  const open = "open" in state ? state.open : undefined;
  const draft = open?.markdown;
  const original = open?.original;
  const earlier = open?.earlier;
  useEffect(() => {
    if (key === undefined || draft === undefined || original === undefined) return;
    if (draft === original && earlier === undefined) forgetBrief(key);
    else keepInThisTab(key, JSON.stringify({ markdown: draft, earlier }));
  }, [key, draft, original, earlier]);
};
