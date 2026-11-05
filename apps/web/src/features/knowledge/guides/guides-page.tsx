import { Link } from "@tanstack/react-router";
import { useId, useRef } from "react";

import { BROWSE } from "@/shared/knowledge/concept-address.ts";
import { failedReadWords } from "@/shared/knowledge/refusal.tsx";
import { ListRead, ListState } from "@/shared/list/list-pages.tsx";
import { ListHead, PageHead } from "@/shared/page/page-head.tsx";
import { Card } from "@/shared/ui/card.tsx";
import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";

import { useGuides, type GuideSummary } from "../knowledge-api.ts";
import { GUIDES_PAGE, guidePageOf, guideTitleOf } from "./guide-state.ts";
import { GUIDES_WORDS as WORDS } from "./guide-words.ts";

const NONE: readonly GuideSummary[] = [];

function GuideRow(properties: { readonly guide: GuideSummary }) {
  const { guide } = properties;
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Pill>{guide.kind}</Pill>
        <Link
          to={guidePageOf(guide.guideId)}
          className="min-w-0 grow basis-48 font-medium break-words text-foreground underline-offset-4 hover:underline"
        >
          {guideTitleOf(guide)}
        </Link>
        <span className="text-muted-foreground">{WORDS.sections(guide.sections)}</span>
        {guide.needsReview === 0 ? null : (
          <Pill variant="outline">{WORDS.needReview(guide.needsReview)}</Pill>
        )}
      </div>
    </li>
  );
}

function GuideList(properties: { readonly listed: readonly GuideSummary[] }) {
  const { listed } = properties;
  if (listed.length === 0) {
    return <ListState state={{ kind: "empty", words: WORDS.none, action: null }} />;
  }
  return (
    <ul aria-label={GUIDES_PAGE.name} className="divide-y divide-border">
      {listed.map((guide) => (
        <GuideRow key={guide.guideId} guide={guide} />
      ))}
    </ul>
  );
}

function GuidesRegion() {
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const read = useGuides();
  const listed = read.data;

  return (
    <section aria-labelledby={headingId} className="mt-6">
      <ListHead
        heading={GUIDES_PAGE.name}
        headingId={headingId}
        headingRef={heading}
        description={WORDS.about}
        count={listed === undefined ? "" : WORDS.count(listed.length)}
      />
      <Card marks className="mt-4">
        <ListRead
          read={read}
          loading={WORDS.loading}
          failed={failedReadWords}
          focusAfterRetry={heading}
        >
          <GuideList listed={listed ?? NONE} />
        </ListRead>
      </Card>
    </section>
  );
}

export function GuidesPage() {
  return (
    <>
      <PageHead heading={BROWSE.name} summary={BROWSE.summary} />
      <GuidesRegion />
    </>
  );
}
