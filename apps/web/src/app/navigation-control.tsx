import type { RefObject } from "react";

import { Icon } from "@/shared/icon.tsx";
import type { Place, VisibleSurface } from "@/shared/navigation.ts";
import { Button } from "@/shared/ui/button.tsx";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/shared/ui/sheet.tsx";

import { IconRail } from "./icon-rail.tsx";
import { SecondaryNav } from "./secondary-nav.tsx";
import { NAVIGATION_SHEET, TOGGLE } from "./words.ts";

/** The one button in the band that governs the navigation, and gets focus back from the sheet. */
type Control = RefObject<HTMLButtonElement | null>;

/**
 * The toggle for the secondary nav when wide, the sheet's button when narrow. `controls` is the
 * nav's id.
 */
export function NavigationButton(properties: {
  readonly controlRef: Control;
  readonly wide: boolean;
  readonly asked: boolean;
  readonly onAsk: (asked: boolean) => void;
  readonly showing: boolean;
  readonly controls: string;
  readonly open: Place | undefined;
  readonly onShow: (showing: boolean) => void;
}) {
  const { controlRef, wide, asked, onAsk, showing, controls, open, onShow } = properties;

  if (!wide) {
    return (
      <Button
        ref={controlRef}
        type="button"
        variant="ghost"
        size="icon"
        aria-haspopup="dialog"
        aria-expanded={asked}
        onClick={() => onAsk(true)}
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
  readonly controlRef: Control;
  readonly wide: boolean;
  readonly asked: boolean;
  readonly onAsk: (asked: boolean) => void;
  readonly surfaces: readonly VisibleSurface[];
  readonly open: Place | undefined;
}) {
  const { controlRef, onAsk } = properties;
  const close = () => onAsk(false);

  const handBackFocus = (event: Event) => {
    // Radix hands focus to its own trigger, which this sheet has none of; the button in the
    // band is the one in both layouts.
    event.preventDefault();
    close();
    controlRef.current?.focus();
  };

  return (
    <Sheet open={properties.asked && !properties.wide} onOpenChange={onAsk}>
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
