import { useEffect, useEffectEvent, useId, useState } from "react";

import { onThisBrowser } from "@/shared/browser-storage.ts";
import { Button } from "@/shared/ui/button.tsx";
import { Checkbox } from "@/shared/ui/checkbox.tsx";
import { Label } from "@/shared/ui/label.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover.tsx";

export type Keystroke = {
  readonly key: string;
  readonly act: string;
};

const LIST_THE_KEYSTROKES: Keystroke = { key: "?", act: "List these keystrokes" };

const KEPT_UNDER = "better-answers.keystrokes";

const OFF = "off";

// WCAG 2.1.4: a reader whose speech input or tremor types letters by accident can turn every
// single-key keystroke off.
const keystrokesAreOn = (): boolean => onThisBrowser()?.getItem(KEPT_UNDER) !== OFF;

// A key typed into a field is the field's, one with a modifier the browser's, one inside a
// dialog or menu that surface's.
const OWNED_ELSEWHERE =
  'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

const isTheScreens = (event: KeyboardEvent): boolean => {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return false;
  const { target } = event;
  return !(target instanceof Element) || target.closest(OWNED_ELSEWHERE) === null;
};

export function useKeystroke(keystroke: Keystroke, act: () => void) {
  const pressed = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== keystroke.key || !isTheScreens(event) || !keystrokesAreOn()) return;
    event.preventDefault();
    act();
  });

  // The document is the one listener every region shares, so a keystroke works from wherever
  // focus sits on the screen.
  useEffect(() => {
    document.addEventListener("keydown", pressed);
    return () => {
      document.removeEventListener("keydown", pressed);
    };
  }, []);
}

function TurnedOn() {
  const [on, setOn] = useState(keystrokesAreOn);
  const switchId = useId();

  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id={switchId}
        checked={on}
        onCheckedChange={(checked) => {
          const next = checked === true;
          setOn(next);
          if (next) onThisBrowser()?.removeItem(KEPT_UNDER);
          else onThisBrowser()?.setItem(KEPT_UNDER, OFF);
        }}
      />
      <Label htmlFor={switchId}>Single-key keystrokes, kept on this browser</Label>
    </div>
  );
}

export function KeystrokesAct(properties: {
  readonly screen: string;
  readonly keystrokes: readonly Keystroke[];
}) {
  const [open, setOpen] = useState(false);
  const headingId = useId();
  useKeystroke(LIST_THE_KEYSTROKES, () => {
    setOpen(true);
  });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" aria-keyshortcuts={LIST_THE_KEYSTROKES.key}>
          Keystrokes
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" aria-labelledby={headingId} className="grid w-80 gap-3">
        <h2 id={headingId} className="font-medium">
          Keystrokes on {properties.screen}
        </h2>
        <p className="text-sm text-muted-foreground">
          Each works from anywhere on the screen outside a field or a dialog.
        </p>
        <TurnedOn />
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          {[...properties.keystrokes, LIST_THE_KEYSTROKES].map((keystroke) => (
            <div key={keystroke.key} className="contents">
              <dt>
                <kbd className="border border-border bg-muted px-1.5 font-mono">
                  {keystroke.key}
                </kbd>
              </dt>
              <dd>{keystroke.act}</dd>
            </div>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  );
}
