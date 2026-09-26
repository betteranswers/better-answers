import { useState } from "react";

import { refusalOf } from "@/shared/api/trpc.ts";
import type { Outcome } from "@/shared/outcome.tsx";

import { useCorrectDisplayName } from "./people-api.ts";
import { correctedWords, correctingRefused, refusedAsStale } from "./words.ts";

type CorrectName = ReturnType<typeof useCorrectDisplayName>;

/** A refused name, back in the field to be mended; `byTheRule` says why where the rule refused it. */
export type Refused = { readonly displayName: string; readonly byTheRule: Outcome | undefined };

const outcomeOf = (correctName: CorrectName, was: string): Outcome | undefined => {
  if (correctName.isPending) return { tone: "said", words: "Saving the name." };
  if (correctName.isSuccess) {
    return { tone: "said", words: correctedWords(was, correctName.data.displayName) };
  }
  return correctName.isError ? correctingRefused(correctName.error) : undefined;
};

const refusedOf = (correctName: CorrectName, personId: string): Refused | undefined => {
  if (!correctName.isError || correctName.variables.personId !== personId) return undefined;
  const byTheRule = refusalOf(correctName.error)?.class === "malformed";
  return {
    displayName: correctName.variables.displayName,
    byTheRule: byTheRule ? correctingRefused(correctName.error) : undefined,
  };
};

/** `was` is kept, since the cache no longer holds the name it replaced once the act lands. */
export const useCorrecting = () => {
  const correctName = useCorrectDisplayName();
  const [was, setWas] = useState("");
  const refusedFor = correctName.isError ? correctName.variables.personId : undefined;
  const stale = refusedAsStale(correctName.error);

  return {
    pending: correctName.isPending,
    outcome: outcomeOf(correctName, was),
    /** Refused over a sign-in too old, which signing in again mends. */
    staleFor: stale ? refusedFor : undefined,
    /** Refused for any other reason, so the person's act takes focus back. */
    otherwiseRefusedFor: stale ? undefined : refusedFor,
    refusedAt: (personId: string) => refusedOf(correctName, personId),
    save: (asked: {
      readonly personId: string;
      readonly was: string;
      readonly displayName: string;
    }) => {
      setWas(asked.was);
      correctName.mutate({ personId: asked.personId, displayName: asked.displayName });
    },
  };
};
