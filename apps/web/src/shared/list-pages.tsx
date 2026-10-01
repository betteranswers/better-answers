import type { ReactNode } from "react";

import { Button } from "@/shared/ui/button.tsx";
import { EmptyAction } from "@/shared/ui/kibo-ui/empty-action.tsx";
import { PaginationCounter } from "@/shared/ui/kibo-ui/pagination-counter.tsx";

/** Each state takes only the screen's words. Clear filters and Retry unmount it, so their handlers move focus. */
type State =
  | { readonly kind: "loading"; readonly words: string }
  | { readonly kind: "empty"; readonly words: string; readonly act: ReactNode }
  | { readonly kind: "emptied"; readonly words: string; readonly onClear: () => void }
  | { readonly kind: "failed"; readonly words: ReactNode; readonly onRetry: () => void };

export function ListState(properties: { readonly state: State }) {
  const { state } = properties;
  switch (state.kind) {
    case "loading":
      return <EmptyAction title={state.words} />;
    case "empty":
      return <EmptyAction title={state.words} action={state.act} />;
    case "emptied":
      return (
        <EmptyAction
          title={state.words}
          action={
            <Button variant="outline" onClick={state.onClear}>
              Clear filters
            </Button>
          }
        />
      );
    case "failed":
      return (
        <EmptyAction
          title={<span role="alert">{state.words}</span>}
          action={
            <Button variant="outline" onClick={state.onRetry}>
              Retry
            </Button>
          }
        />
      );
  }
}

type Pages = {
  readonly kind: "pages";
  readonly label: string;
  readonly pageIndex: number;
  readonly pageSize: number;
  readonly total: number;
  readonly onTurn: (pageIndex: number) => void;
  readonly keystrokes?: { readonly previous: string; readonly next: string };
};

/** Load more takes a cursor's lists, where no total is known ahead. */
type More = {
  readonly kind: "more";
  readonly label: string;
  readonly more: boolean;
  readonly loading: boolean;
  readonly onMore: () => void;
};

const BAND = "border-t border-border bg-muted px-3 py-2";

function PageTurns(properties: { readonly pages: Pages }) {
  const { label, pageIndex, pageSize, total, onTurn, keystrokes } = properties.pages;
  const pageCount = Math.ceil(total / pageSize);
  if (pageCount <= 1) return null;
  const from = pageIndex * pageSize + 1;
  const to = Math.min(total, from + pageSize - 1);
  return (
    <PaginationCounter
      aria-label={label}
      className={BAND}
      summary={`Showing ${from}–${to} of ${total}.`}
      counter={`Page ${pageIndex + 1} of ${pageCount}`}
      previous={{
        label: "Previous page",
        disabled: pageIndex === 0,
        keystroke: keystrokes?.previous,
        onTurn: () => {
          onTurn(pageIndex - 1);
        },
      }}
      next={{
        label: "Next page",
        disabled: pageIndex >= pageCount - 1,
        keystroke: keystrokes?.next,
        onTurn: () => {
          onTurn(pageIndex + 1);
        },
      }}
    />
  );
}

function LoadMore(properties: { readonly more: More }) {
  const { label, more, loading, onMore } = properties.more;
  if (!more) return null;
  return (
    <nav aria-label={label} className={BAND}>
      <Button
        variant="outline"
        size="sm"
        aria-disabled={loading}
        className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        onClick={() => {
          if (!loading) onMore();
        }}
      >
        Load more
      </Button>
    </nav>
  );
}

/** Pages over a list held whole, or Load more over a cursor's; nothing when one page holds it. */
export function ListPages(properties: { readonly pages: Pages | More }) {
  const { pages } = properties;
  return pages.kind === "pages" ? <PageTurns pages={pages} /> : <LoadMore more={pages} />;
}
