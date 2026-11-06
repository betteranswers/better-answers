import { useId, useRef, useState } from "react";

import { ceilingLiftsIn, type ApiError } from "@/shared/api/trpc.ts";
import { usePageKeystrokes, type Keystroke } from "@/shared/keystrokes.tsx";
import { ALL_KNOWLEDGE_PAGE } from "@/shared/knowledge/concept-address.ts";
import { ListRead } from "@/shared/list/list-pages.tsx";
import { useMember } from "@/shared/member/member.ts";
import { ownsNoLonger, useArrivalDecidedAgainOnceUnowned } from "@/shared/member/ownership.ts";
import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { ListHead, PageHead } from "@/shared/page/page-head.tsx";
import { useHiddenColumns } from "@/shared/page/wide-layout.ts";
import { refusalsOf } from "@/shared/refusal-outcome.tsx";
import { stockWait } from "@/shared/refusal-words.ts";
import { Card } from "@/shared/ui/card.tsx";

import { useAllKnowledge, type AllKnowledge } from "../knowledge-api.ts";
import { useAllKnowledgeAddress, type Standing } from "./all-knowledge-address.ts";
import { NARROW_HIDES } from "./all-knowledge-columns.tsx";
import { AllKnowledgeFilters } from "./all-knowledge-filters.tsx";
import { Concepts, NOTHING_TICKED } from "./all-knowledge-table.tsx";
import { ALL_KNOWLEDGE_KEYSTROKES as KEY } from "./curation-state.ts";
import { ALL_KNOWLEDGE_WORDS as WORDS } from "./curation-words.ts";
import { SetOwnerDialog, useSetOwner } from "./set-owner.tsx";

const { outcomeOfFailure } = refusalsOf(WORDS.refusedOnRead);

const ADMIN_KEYSTROKES: readonly Keystroke[] = Object.values(KEY);

const OWNER_KEYSTROKES: readonly Keystroke[] = [KEY.open, KEY.previousPage, KEY.nextPage];

const failedReadWords = (failure: Error | ApiError) => {
  const liftsInSeconds = ceilingLiftsIn(failure);
  return liftsInSeconds === undefined
    ? outcomeOfFailure(failure, "read").words
    : stockWait(liftsInSeconds);
};

const countOf = (read: AllKnowledge | undefined, narrowed: boolean): string => {
  if (read === undefined) return "";
  return narrowed ? WORDS.matching(read.total) : WORDS.count(read.total);
};

function Review(properties: { readonly standing: Standing }) {
  const { standing } = properties;
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const address = useAllKnowledgeAddress(standing);
  const read = useAllKnowledge(address.asked);
  const [ticked, setTicked] = useState(NOTHING_TICKED);
  const [hidden, setHidden] = useHiddenColumns(NARROW_HIDES);
  const [outcome, say] = useState<Outcome>();
  const setOwner = useSetOwner({
    admin: standing.admin,
    ticked,
    clearTicks: () => {
      setTicked(NOTHING_TICKED);
    },
    heading,
    say,
  });
  useArrivalDecidedAgainOnceUnowned(ownsNoLonger(read.error));
  usePageKeystrokes(standing.admin ? ADMIN_KEYSTROKES : OWNER_KEYSTROKES);

  return (
    <section aria-labelledby={headingId} className="mt-6">
      <ListHead
        heading={ALL_KNOWLEDGE_PAGE.name}
        headingId={headingId}
        headingRef={heading}
        count={countOf(read.data, address.narrowed)}
      />
      <OutcomeLine outcome={outcome} className="mt-2" />
      <Card className="mt-4">
        <AllKnowledgeFilters
          standing={standing}
          address={address}
          hidden={hidden}
          onHiddenChange={setHidden}
        />
        <ListRead
          read={read}
          loading={WORDS.loading}
          failed={failedReadWords}
          focusAfterRetry={heading}
        >
          <Concepts
            standing={standing}
            address={address}
            read={read}
            ticks={{ ticked, setTicked }}
            setOwner={setOwner}
            hidden={hidden}
            heading={heading}
            say={say}
          />
        </ListRead>
      </Card>
      {standing.admin ? <SetOwnerDialog setOwner={setOwner} /> : null}
    </section>
  );
}

const standingOf = (member: ReturnType<typeof useMember>["data"]): Standing | undefined => {
  if (member === undefined) return undefined;
  return member.role === "Admin"
    ? { admin: true, owned: [] }
    : { admin: false, owned: member.owns.collections };
};

export function AllKnowledgePage() {
  const standing = standingOf(useMember().data);

  return (
    <>
      <PageHead title={ALL_KNOWLEDGE_PAGE.name} />
      {standing === undefined ? null : <Review standing={standing} />}
    </>
  );
}
