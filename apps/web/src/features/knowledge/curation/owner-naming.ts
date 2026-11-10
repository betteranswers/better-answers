import { useRef, useState, type ReactNode } from "react";

import type { ApiError } from "@/shared/api/trpc.ts";
import { collectionNameOf } from "@/shared/knowledge/collection-name.ts";
import { refusalsOf } from "@/shared/refusal-outcome.tsx";
import type { UndoNotice } from "@/shared/ui/kibo-ui/undo-toast.tsx";

import { useNameOwner, type CollectionOwned, type Owner } from "../knowledge-api.ts";
import { COLLECTIONS_WORDS as WORDS, SAID_OF_COLLECTIONS } from "../knowledge-words.ts";

const { outcomeOfFailure } = refusalsOf(SAID_OF_COLLECTIONS);

export const nameOf = (owner: Owner): string => (owner.name === "" ? WORDS.unnamed : owner.name);

export type Naming = {
  readonly choices: readonly Owner[];
  readonly refusalOf: (collection: string) => ReactNode;
  readonly save: (owned: CollectionOwned, chosen: Owner | null) => void;
};

const NO_REFUSALS: ReadonlyMap<string, ReactNode> = new Map();

export const useOwnerNaming = (choices: readonly Owner[]) => {
  const naming = useNameOwner();
  const [notice, setNotice] = useState<UndoNotice>();
  const [refusals, setRefusals] = useState(NO_REFUSALS);
  const started = useRef(0);
  const shown = useRef(0);

  const refused = (collection: string, words: ReactNode) => {
    setRefusals((held) => {
      const next = new Map(held);
      if (words === undefined) next.delete(collection);
      else next.set(collection, words);
      return next;
    });
  };

  const name = (collection: string, chosen: Owner | null, before: Owner | null | undefined) => {
    started.current += 1;
    const sequence = started.current;
    refused(collection, undefined);
    void naming.mutateAsync({ collection, personId: chosen?.id ?? null }).then(
      () => {
        if (sequence < shown.current) return;
        shown.current = sequence;
        const named = collectionNameOf(collection);
        setNotice({
          id: sequence,
          words: chosen === null ? WORDS.cleared(named) : WORDS.named(nameOf(chosen), named),
          undo:
            before === undefined
              ? undefined
              : {
                  label: WORDS.undo,
                  altText: WORDS.undoOf(named),
                  onUndo: () => {
                    name(collection, before, undefined);
                  },
                },
        });
      },
      (failure: Error | ApiError) => {
        refused(collection, outcomeOfFailure(failure, "action").words);
      },
    );
  };

  return {
    naming: {
      choices,
      refusalOf: (collection) => refusals.get(collection),
      save: (owned, chosen) => {
        name(owned.collection, chosen, owned.owner);
      },
    } satisfies Naming,
    notice,
    closeNotice: () => {
      setNotice(undefined);
    },
  };
};
