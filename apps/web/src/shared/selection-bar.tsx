import { Toolbar as ToolbarPrimitive } from "radix-ui";
import { useRef, type ComponentProps, type ReactNode, type RefObject } from "react";

import { useKeystroke, type Keystroke } from "@/shared/keystrokes.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { counted } from "@/shared/words.ts";

type Noun = readonly [one: string, many: string];

const saidOf = (ticked: number, notShown: number, noun: Noun): string => {
  const selected = `${counted(ticked, noun[0], noun[1])} selected`;
  return notShown === 0 ? `${selected}.` : `${selected}, ${notShown} not shown.`;
};

function ClearOn(properties: { readonly keystroke: Keystroke; readonly onClear: () => void }) {
  useKeystroke(properties.keystroke, properties.onClear);
  return null;
}

/** A bulk action the arrow keys reach with the bar's others; a plain button would be a tab stop alone. */
export function SelectionAction(properties: ComponentProps<typeof Button>) {
  return (
    <ToolbarPrimitive.Button asChild>
      <Button variant="outline" size="sm" {...properties} />
    </ToolbarPrimitive.Button>
  );
}

/**
 * Hidden, never unmounted, so its count is a live region before the first tick. Clearing hides
 * the bar, so focus inside it moves to `focusAfterClear`.
 */
export function SelectionBar(properties: {
  readonly label: string;
  readonly ticked: ReadonlySet<string>;
  readonly shown: readonly string[];
  readonly noun: Noun;
  readonly onClear: () => void;
  readonly focusAfterClear: RefObject<HTMLElement | null>;
  readonly clearKeystroke?: Keystroke;
  readonly children?: ReactNode;
}) {
  const { ticked, clearKeystroke, onClear, focusAfterClear } = properties;
  const bar = useRef<HTMLDivElement>(null);
  const shown = new Set(properties.shown);
  const notShown = [...ticked].filter((id) => !shown.has(id)).length;
  const none = ticked.size === 0;

  const clear = () => {
    const focusWasInside = bar.current?.contains(document.activeElement) === true;
    onClear();
    if (focusWasInside) focusAfterClear.current?.focus();
  };

  return (
    <ToolbarPrimitive.Root
      ref={bar}
      aria-label={properties.label}
      hidden={none}
      className="flex min-h-10 flex-wrap items-center gap-2 border-b border-border bg-muted px-3 py-1.5"
    >
      <output className="mr-2 font-medium">
        {none ? "" : saidOf(ticked.size, notShown, properties.noun)}
      </output>
      {none ? null : (
        <>
          {properties.children}
          <ToolbarPrimitive.Button asChild>
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              aria-keyshortcuts={clearKeystroke?.key}
              onClick={clear}
            >
              Clear selection
            </Button>
          </ToolbarPrimitive.Button>
          {clearKeystroke === undefined ? null : (
            <ClearOn keystroke={clearKeystroke} onClear={clear} />
          )}
        </>
      )}
    </ToolbarPrimitive.Root>
  );
}
