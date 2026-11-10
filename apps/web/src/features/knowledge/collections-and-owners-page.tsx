import { useId, useRef } from "react";

import type { ApiError } from "@/shared/api/trpc.ts";
import { useKeystroke, usePageKeystrokes, type Keystroke } from "@/shared/keystrokes.tsx";
import { ListRead } from "@/shared/list/list-pages.tsx";
import { rowInFocus } from "@/shared/list/row-focus.ts";
import { useRole } from "@/shared/member/member.ts";
import { ownsNoLonger, useArrivalDecidedAgainOnceUnowned } from "@/shared/member/ownership.ts";
import { KNOWLEDGE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";
import { ListHead, PageHead } from "@/shared/page/page-head.tsx";
import { Card } from "@/shared/ui/card.tsx";
import { UndoToast, type UndoNotice } from "@/shared/ui/kibo-ui/undo-toast.tsx";

import { CollectionsTable } from "./curation/collections-table.tsx";
import { outcomeOfFailure, useOwnerNaming } from "./curation/owner-naming.ts";
import { pickerIdOf } from "./curation/owner-picker.tsx";
import { useCollections, useOwnerChoices, type CollectionOwned } from "./knowledge-api.ts";
import { COLLECTIONS_KEYSTROKES as KEY } from "./knowledge-state.ts";
import { COLLECTIONS_WORDS as WORDS } from "./knowledge-words.ts";

const CURATION = menuGroupIn(KNOWLEDGE, "curation");

const COLLECTIONS_AND_OWNERS = pageNamed(CURATION, "Collections and Owners");

const OWNER_KEYSTROKES: readonly Keystroke[] = [KEY.changeOwner, KEY.undo];

const NO_KEYSTROKES: readonly Keystroke[] = [];

const NONE: readonly CollectionOwned[] = [];

const readFailedWords = (failure: Error | ApiError) => outcomeOfFailure(failure, "read").words;

function OwnerKeys(properties: {
  readonly listed: readonly CollectionOwned[];
  readonly notice: UndoNotice | undefined;
}) {
  const { listed, notice } = properties;
  useKeystroke(KEY.changeOwner, () => {
    const owned = rowInFocus(listed, (each) => each.collection) ?? listed[0];
    if (owned !== undefined) document.getElementById(pickerIdOf(owned.collection))?.focus();
  });
  useKeystroke(KEY.undo, () => {
    notice?.undo?.onUndo();
  });
  return null;
}

function CollectionsRegion() {
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const read = useCollections();
  const admin = useRole() === "Admin";
  const { naming, notice, closeNotice } = useOwnerNaming(useOwnerChoices(admin));
  useArrivalDecidedAgainOnceUnowned(ownsNoLonger(read.error));
  usePageKeystrokes(admin ? OWNER_KEYSTROKES : NO_KEYSTROKES);
  const listed = read.data?.collections;

  return (
    <section aria-labelledby={headingId} className="mt-6">
      <ListHead
        heading={COLLECTIONS_AND_OWNERS.name}
        headingId={headingId}
        headingRef={heading}
        count={listed === undefined ? "" : WORDS.count(listed.length)}
      />
      <Card marks className="mt-4">
        <ListRead
          read={read}
          failed={readFailedWords}
          loading={WORDS.loading}
          focusAfterRetry={heading}
        >
          <CollectionsTable listed={listed ?? NONE} naming={admin ? naming : undefined} />
        </ListRead>
      </Card>
      {admin ? (
        <>
          <OwnerKeys listed={listed ?? NONE} notice={notice} />
          <UndoToast notice={notice} onClose={closeNotice} />
        </>
      ) : null}
    </section>
  );
}

export function CollectionsAndOwnersPage() {
  return (
    <>
      <PageHead title={COLLECTIONS_AND_OWNERS.name} />
      <CollectionsRegion />
    </>
  );
}
