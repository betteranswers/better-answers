import { Button } from "@/shared/ui/button.tsx";

import { PAGE_SIZE } from "./people-api.ts";

/** The offset each turn would ask for, and none past either end. */
export type PageTurns = {
  readonly previous: number | undefined;
  readonly next: number | undefined;
};

export const turnsOf = (offset: number, total: number): PageTurns => ({
  previous: offset === 0 ? undefined : Math.max(0, offset - PAGE_SIZE),
  next: offset + PAGE_SIZE < total ? offset + PAGE_SIZE : undefined,
});

/** A page's end stays focusable, so a reader who reaches it keeps their place. */
function PageTurn(properties: {
  readonly label: string;
  readonly keystroke: string;
  readonly offset: number | undefined;
  readonly turnTo: (offset: number) => void;
}) {
  const { offset } = properties;
  return (
    <Button
      variant="outline"
      size="sm"
      aria-disabled={offset === undefined}
      aria-keyshortcuts={properties.keystroke}
      className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
      onClick={() => {
        if (offset !== undefined) properties.turnTo(offset);
      }}
    >
      {properties.label}
    </Button>
  );
}

/**
 * The registry's pagination is links to addresses; these pages are the list's own state, so its
 * buttons turn them.
 */
export function Pages(properties: {
  readonly offset: number;
  readonly shown: number;
  readonly total: number;
  readonly turns: PageTurns;
  readonly keystrokes: { readonly previous: string; readonly next: string };
  readonly turnTo: (offset: number) => void;
}) {
  const { offset, shown, total, turns, keystrokes, turnTo } = properties;
  if (total <= PAGE_SIZE) return null;
  return (
    <nav
      aria-label="Pages of people"
      className="flex flex-wrap items-center gap-3 border-t border-border p-3"
    >
      <p className="tabular-nums">
        Showing {offset + 1}–{offset + shown} of {total}.
      </p>
      <PageTurn
        label="Previous page"
        keystroke={keystrokes.previous}
        offset={turns.previous}
        turnTo={turnTo}
      />
      <PageTurn label="Next page" keystroke={keystrokes.next} offset={turns.next} turnTo={turnTo} />
    </nav>
  );
}
