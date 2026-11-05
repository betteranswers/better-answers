import { useEffect } from "react";
import { z } from "zod";

import { inThisTab, keepInThisTab } from "@/shared/browser-storage.ts";

import type { BriefState } from "./brief-editing.ts";

const KEPT_BRIEF = z.object({ markdown: z.string() });

export const draftKeyOf = (
  person: string | undefined,
  writeUpId: string,
  base: number,
): string | undefined =>
  person === undefined
    ? undefined
    : `better-answers.brief-draft.${person}.${writeUpId}.${String(base)}`;

export const keptBriefOf = (key: string | undefined): string | undefined => {
  const raw = key === undefined ? null : inThisTab()?.getItem(key);
  if (raw === null || raw === undefined) return undefined;
  try {
    const kept = KEPT_BRIEF.safeParse(JSON.parse(raw));
    return kept.success ? kept.data.markdown : undefined;
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
  useEffect(() => {
    if (key === undefined || draft === undefined || original === undefined) return;
    if (draft === original) forgetBrief(key);
    else keepInThisTab(key, JSON.stringify({ markdown: draft }));
  }, [key, draft, original]);
};
