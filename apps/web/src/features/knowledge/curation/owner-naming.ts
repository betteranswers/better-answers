import { useRef, useState, type ReactNode } from "react";

import type { ApiError } from "@/shared/api/trpc.ts";
import { collectionNameOf } from "@/shared/knowledge/collection-name.ts";
import { EMPTY_WORDS } from "@/shared/knowledge/concept-words.ts";
import { refusalsOf } from "@/shared/refusal-outcome.tsx";
import type { UndoNotice } from "@/shared/ui/kibo-ui/undo-toast.tsx";

import {
  useNameOwner,
  useOwnersSaving,
  type CollectionOwned,
  type Owner,
} from "../knowledge-api.ts";
import { COLLECTIONS_WORDS as WORDS, SAID_OF_COLLECTIONS } from "../knowledge-words.ts";

const { outcomeOfFailure } = refusalsOf(SAID_OF_COLLECTIONS);

export const nameOf = (owner: Owner): string =>
  owner.name === "" ? EMPTY_WORDS.member : owner.name;

type Refused = { readonly state: "refused"; readonly words: ReactNode };

type OwnerChange = { readonly state: "saving" } | Refused;

const SAVING: OwnerChange = { state: "saving" };

export type Naming = {
  readonly choices: readonly Owner[];
  readonly changeOf: (collection: string) => OwnerChange | undefined;
  readonly save: (owned: CollectionOwned, chosen: Owner | null) => void;
};

const NO_REFUSALS: ReadonlyMap<string, Refused> = new Map();

export const useOwnerNaming = (choices: readonly Owner[]) => {
  const naming = useNameOwner();
  const { saving, isSaving } = useOwnersSaving();
  const [notice, setNotice] = useState<UndoNotice>();
  const [refusals, setRefusals] = useState(NO_REFUSALS);
  const started = useRef(0);

  const refused = (collection: string, refusal: Refused | undefined) => {
    setRefusals((held) => {
      const next = new Map(held);
      if (refusal === undefined) next.delete(collection);
      else next.set(collection, refusal);
      return next;
    });
  };

  const name = (collection: string, chosen: Owner | null, before: Owner | null | undefined) => {
    if (isSaving(collection)) return;
    started.current += 1;
    const sequence = started.current;
    refused(collection, undefined);
    void naming.mutateAsync({ collection, personId: chosen?.id ?? null }).then(
      () => {
        const named = collectionNameOf(collection);
        const settled: UndoNotice = {
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
        };
        setNotice((shown) => (shown !== undefined && shown.id > sequence ? shown : settled));
      },
      (failure: Error | ApiError) => {
        refused(collection, { state: "refused", words: outcomeOfFailure(failure, "action").words });
      },
    );
  };

  return {
    naming: {
      choices,
      changeOf: (collection) => (saving.has(collection) ? SAVING : refusals.get(collection)),
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
