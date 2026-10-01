import { useRef, useState, type RefObject } from "react";

import { Icon } from "@/shared/icon.tsx";
import type { Place, VisibleSurface } from "@/shared/navigation.ts";
import { Button } from "@/shared/ui/button.tsx";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/shared/ui/sheet.tsx";

import { IconRail } from "./icon-rail.tsx";
import { SecondaryNav } from "./secondary-nav.tsx";
import { NAVIGATION_SHEET, TOGGLE } from "./words.ts";

type Sheeting = {
  readonly asked: boolean;
  readonly ask: (asked: boolean) => void;
  /** The one button in the band that governs the navigation, and gets focus back from the sheet. */
  readonly controlRef: RefObject<HTMLButtonElement | null>;
};

/** The frame's, so the button in the band and the sheet below it read one state. */
export const useNavigationSheet = (): Sheeting => {
  const [asked, ask] = useState(false);
  const controlRef = useRef<HTMLButtonElement | null>(null);

  return { asked, ask, controlRef };
};

/**
 * The toggle for the secondary nav when wide, the sheet's button when narrow. `controls` is the
 * nav's id.
 */
export function NavigationButton(properties: {
  readonly sheet: Sheeting;
  readonly wide: boolean;
  readonly showing: boolean;
  readonly controls: string;
  readonly open: Place<VisibleSurface> | undefined;
  readonly onShow: (showing: boolean) => void;
}) {
  const { wide, showing, controls, open, onShow } = properties;
  const { controlRef, asked, ask } = properties.sheet;

  if (!wide) {
    return (
      <Button
        ref={controlRef}
        type="button"
        variant="ghost"
        size="icon"
        aria-haspopup="dialog"
        aria-expanded={asked}
        onClick={() => ask(true)}
      >
        <Icon name="navigation" className="text-muted-foreground" />
        <span className="sr-only">{NAVIGATION_SHEET}</span>
      </Button>
    );
  }

  // An address that is no screen has no surface to list, so there is nothing to govern.
  if (open === undefined) return null;

  return (
    <Button
      ref={controlRef}
      type="button"
      variant="ghost"
      size="icon"
      className="shrink-0"
      aria-expanded={showing}
      aria-controls={controls}
      onClick={() => onShow(!showing)}
    >
      <Icon name="secondary-nav" className="text-muted-foreground" />
      <span className="sr-only">{showing ? TOGGLE.hide : TOGGLE.show}</span>
    </Button>
  );
}

/** Mounted in both layouts, so a crossing is a close it answers, not an unmount taking focus. */
export function NavigationSheet(properties: {
  readonly sheet: Sheeting;
  readonly wide: boolean;
  readonly surfaces: readonly VisibleSurface[];
  readonly open: Place<VisibleSurface> | undefined;
}) {
  const { controlRef, asked, ask } = properties.sheet;
  const close = () => ask(false);

  const handBackFocus = (event: Event) => {
    // Radix hands focus to its own trigger, which this sheet lacks; the band's button takes it,
    // or the screen when no button is drawn.
    event.preventDefault();
    close();
    (controlRef.current ?? document.querySelector("main"))?.focus();
  };

  return (
    <Sheet open={asked && !properties.wide} onOpenChange={ask}>
      {/* The regions keep the widths they have in the shell, so nothing here is a second
          layout to maintain. */}
      <SheetContent
        side="left"
        className="w-sidebar max-w-full gap-0 overflow-y-auto p-0"
        onCloseAutoFocus={handBackFocus}
      >
        <SheetHeader className="border-b border-border">
          <SheetTitle>{NAVIGATION_SHEET}</SheetTitle>
        </SheetHeader>

        <IconRail
          surfaces={properties.surfaces}
          openSurfaceId={properties.open?.surface.id}
          tooltips={false}
          onChoose={close}
        />

        {properties.open === undefined ? null : (
          <SecondaryNav
            showing
            surface={properties.open.surface}
            openScreenPath={properties.open.screen.path}
            onChoose={close}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
