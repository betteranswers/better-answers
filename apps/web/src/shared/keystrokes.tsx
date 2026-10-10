import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { keepOnThisBrowser, onThisBrowser } from "@/shared/browser-storage.ts";
import { Icon } from "@/shared/icon.tsx";
import { KEYSTROKE_WORDS, keystrokesOn } from "@/shared/keystroke-words.ts";
import { Button } from "@/shared/ui/button.tsx";
import { Checkbox } from "@/shared/ui/checkbox.tsx";
import { Label } from "@/shared/ui/label.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover.tsx";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip.tsx";

export type Keystroke = {
  readonly key: string;
  readonly action: string;
};

const LIST_THE_KEYSTROKES: Keystroke = { key: "?", action: KEYSTROKE_WORDS.showTheList };

const KEPT_UNDER = "better-answers.keystrokes";

const OFF = "off";

/**
 * WCAG 2.1.4: a reader whose speech input or tremor types letters by accident can turn every
 * single-key keystroke off.
 */
const keystrokesAreOn = (): boolean => onThisBrowser()?.getItem(KEPT_UNDER) !== OFF;

/**
 * A key typed into a field is the field's, one with a modifier the browser's, one inside a
 * dialog or menu that control's.
 */
const OWNED_ELSEWHERE =
  'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

const isThePages = (event: KeyboardEvent): boolean => {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return false;
  const { target } = event;
  return !(target instanceof Element) || target.closest(OWNED_ELSEWHERE) === null;
};

/**
 * Runs `action` on the bare key from anywhere but a field, dialog or menu, unless the reader turned
 * single-key keystrokes off.
 */
export function useKeystroke(keystroke: Keystroke, action: () => void) {
  const pressed = useEffectEvent((event: KeyboardEvent) => {
    if (event.key !== keystroke.key || !isThePages(event) || !keystrokesAreOn()) return;
    event.preventDefault();
    if (!event.repeat) action();
  });

  // The document is the one listener every region shares, so a keystroke works from wherever
  // focus sits on the page.
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
          else keepOnThisBrowser(KEPT_UNDER, OFF);
        }}
      />
      <Label htmlFor={switchId}>{KEYSTROKE_WORDS.turnedOn}</Label>
    </div>
  );
}

/** Focus returns a task after the list goes; a key pressed in that gap has already placed it. */
const keepFocusAKeyMoved = (event: Event) => {
  const focused = document.activeElement;
  if (focused !== null && focused !== document.body) event.preventDefault();
};

/** `children` holds the trigger, so a caller may wrap it in a tooltip of its own. */
function KeystrokesList(properties: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly side: "right" | "bottom";
  readonly heading: string;
  readonly keystrokes: readonly Keystroke[];
  readonly said?: string | undefined;
  readonly children: ReactNode;
}) {
  const headingId = useId();

  return (
    <Popover open={properties.open} onOpenChange={properties.onOpenChange}>
      {properties.children}
      <PopoverContent
        side={properties.side}
        // Beside the rail, clear of its edge rather than over it.
        sideOffset={properties.side === "right" ? 12 : 4}
        align="end"
        aria-labelledby={headingId}
        className="grid max-h-(--radix-popover-content-available-height) w-80 max-w-[calc(100vw-1rem)] gap-3 overflow-y-auto"
        onCloseAutoFocus={keepFocusAKeyMoved}
      >
        <h2 id={headingId} className="font-medium">
          {properties.heading}
        </h2>
        <p className="text-sm text-muted-foreground">{KEYSTROKE_WORDS.where}</p>
        <TurnedOn />
        {properties.said === undefined ? null : <p className="text-sm">{properties.said}</p>}
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          {properties.keystrokes.map((keystroke) => (
            <div key={keystroke.key} className="contents">
              <dt>
                <kbd className="border border-border bg-muted px-1.5 font-mono">
                  {keystroke.key}
                </kbd>
              </dt>
              <dd>{keystroke.action}</dd>
            </div>
          ))}
        </dl>
      </PopoverContent>
    </Popover>
  );
}

/**
 * For a page outside the shell. It binds `?` itself and lists it, so the caller leaves `?`
 * out.
 */
export function KeystrokesAction(properties: {
  readonly page: string;
  readonly keystrokes: readonly Keystroke[];
}) {
  const [open, setOpen] = useState(false);
  useKeystroke(LIST_THE_KEYSTROKES, () => {
    setOpen(true);
  });

  return (
    <KeystrokesList
      open={open}
      onOpenChange={setOpen}
      side="bottom"
      heading={keystrokesOn(properties.page)}
      keystrokes={[...properties.keystrokes, LIST_THE_KEYSTROKES]}
    >
      <PopoverTrigger asChild>
        {/* Outside the shell it sits in a row of secondary actions, which share one treatment. */}
        <Button variant="outline" aria-keyshortcuts={LIST_THE_KEYSTROKES.key}>
          {KEYSTROKE_WORDS.button}
        </Button>
      </PopoverTrigger>
    </KeystrokesList>
  );
}

type Listing = {
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
  readonly heading: string;
  readonly keystrokes: readonly Keystroke[];
  readonly said: string | undefined;
};

const ListingContext = createContext<Listing | undefined>(undefined);

/** Answers the way to take the keystrokes back off the list. */
type Register = (keystrokes: readonly Keystroke[]) => () => void;

const RegisterContext = createContext<Register | undefined>(undefined);

const NONE: readonly Keystroke[] = [];

/**
 * Owns `?` and the one list at every width; the open page adds its own keystrokes through
 * `usePageKeystrokes`.
 */
export function ShellKeystrokes(properties: {
  /** The open page's name; undefined at an address that names no page. */
  readonly page: string | undefined;
  /** Bound with a modifier, so turning single-key keystrokes off leaves them on. */
  readonly shell: readonly Keystroke[];
  readonly children: ReactNode;
}) {
  const { page, shell } = properties;
  const [open, setOpen] = useState(false);
  const [own, setOwn] = useState(NONE);
  useKeystroke(LIST_THE_KEYSTROKES, () => {
    setOpen(true);
  });

  const register = useCallback<Register>((keystrokes) => {
    setOwn(keystrokes);
    // Only its own: the next page's arrive in the same commit.
    return () => {
      setOwn((current) => (current === keystrokes ? NONE : current));
    };
  }, []);

  const listing = useMemo<Listing>(
    () => ({
      open,
      setOpen,
      heading: keystrokesOn(page ?? KEYSTROKE_WORDS.thisPage),
      keystrokes: [...own, LIST_THE_KEYSTROKES, ...shell],
      said: own.length === 0 ? KEYSTROKE_WORDS.noneOfItsOwn : undefined,
    }),
    [open, own, page, shell],
  );

  return (
    <RegisterContext value={register}>
      <ListingContext value={listing}>{properties.children}</ListingContext>
    </RegisterContext>
  );
}

/**
 * A page sits under the outlet, where the shell cannot hand it a prop. Pass one identity, or
 * every draw registers again.
 */
export function usePageKeystrokes(keystrokes: readonly Keystroke[]) {
  const register = useContext(RegisterContext);
  // The shell's list is outside the page, so it follows the page arriving and leaving.
  useEffect(() => register?.(keystrokes), [register, keystrokes]);
}

/** The way to the list besides `?`: in the rail's foot when wide, in the band when narrow. */
export function ShellKeystrokesAction(properties: { readonly at: "rail" | "band" }) {
  const listing = useContext(ListingContext);
  if (listing === undefined) return null;

  const inTheRail = properties.at === "rail";
  const trigger = (
    <PopoverTrigger asChild>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-keyshortcuts={LIST_THE_KEYSTROKES.key}
        className={inTheRail ? "size-10 text-muted-foreground" : "shrink-0"}
      >
        <Icon name="keystrokes" className="text-muted-foreground" />
        <span className="sr-only">{KEYSTROKE_WORDS.button}</span>
      </Button>
    </PopoverTrigger>
  );

  return (
    <KeystrokesList
      open={listing.open}
      onOpenChange={listing.setOpen}
      side={inTheRail ? "right" : "bottom"}
      heading={listing.heading}
      keystrokes={listing.keystrokes}
      said={listing.said}
    >
      {inTheRail ? (
        <Tooltip>
          <TooltipTrigger asChild>{trigger}</TooltipTrigger>
          <TooltipContent side="right">{KEYSTROKE_WORDS.button}</TooltipContent>
        </Tooltip>
      ) : (
        trigger
      )}
    </KeystrokesList>
  );
}
