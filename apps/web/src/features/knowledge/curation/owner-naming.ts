import { useRef, useState, type ReactNode } from "react";

import { collectionNameOf } from "@/shared/knowledge/collection-name.ts";
import { refusalsOf } from "@/shared/refusal-outcome.tsx";
import type { UndoNotice } from "@/shared/ui/kibo-ui/undo-toast.tsx";

import { useNameOwner, type CollectionOwned, type Owner } from "../knowledge-api.ts";
import { COLLECTIONS_WORDS as WORDS, SAID_OF_COLLECTIONS } from "../knowledge-words.ts";
import { nameOf } from "./owner-picker.tsx";

export const { outcomeOfFailure } = refusalsOf(SAID_OF_COLLECTIONS);

type Refused = { readonly collection: string; readonly words: ReactNode };

export type Naming = {
  readonly choices: readonly Owner[];
  readonly refused: Refused | undefined;
  readonly save: (owned: CollectionOwned, chosen: Owner | null) => void;
};

export const useOwnerNaming = (choices: readonly Owner[]) => {
  const naming = useNameOwner();
  const [notice, setNotice] = useState<UndoNotice>();
  const [refused, setRefused] = useState<Refused>();
  const told = useRef(0);

  const name = (collection: string, chosen: Owner | null, before: Owner | null | undefined) => {
    setRefused(undefined);
    naming.mutate(
      { collection, personId: chosen?.id ?? null },
      {
        onSuccess: () => {
          told.current += 1;
          const named = collectionNameOf(collection);
          setNotice({
            id: told.current,
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
        onError: (failure) => {
          setRefused({ collection, words: outcomeOfFailure(failure, "action").words });
        },
      },
    );
  };

  return {
    naming: {
      choices,
      refused,
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
