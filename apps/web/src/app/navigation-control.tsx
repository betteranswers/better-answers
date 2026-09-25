import { useRef, useState } from "react";

import { Icon } from "@/shared/icon.tsx";
import type { Screen, Surface } from "@/shared/screens.ts";
import { Button } from "@/shared/ui/button.tsx";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/shared/ui/sheet.tsx";
import { IconRail } from "./icon-rail.tsx";
import { SecondaryNav } from "./secondary-nav.tsx";

const SCREENS_AND_VIEWS = "Screens and views";

/**
 * The corner the navigation is governed from: a sheet's trigger when narrow, the secondary nav's
 * toggle when wide. `controls` is that nav's id.
 */
export function NavigationControl(properties: {
  readonly surface: Surface;
  readonly wide: boolean;
  readonly showing: boolean;
  readonly controls: string;
  readonly openScreen: Screen | undefined;
  readonly openViewPath: string | undefined;
  readonly onShow: (showing: boolean) => void;
}) {
  const [asked, setAsked] = useState(false);
  const control = useRef<HTMLButtonElement | null>(null);
  const close = () => setAsked(false);

  const handBackFocus = (event: Event) => {
    // Radix hands focus to the trigger, which a crossing has taken away; this corner's control
    // is in both layouts.
    event.preventDefault();
    close();
    control.current?.focus();
  };

  return (
    /*
     * The root stays mounted in both layouts, so a crossing is a close the sheet answers, not an
     * unmount that takes the reader's focus.
     */
    <Sheet open={asked && !properties.wide} onOpenChange={setAsked}>
      {properties.wide ? null : (
        <SheetTrigger asChild>
          <Button ref={control} type="button" variant="ghost" size="icon">
            <Icon name="navigation" className="text-muted-foreground" />
            <span className="sr-only">{SCREENS_AND_VIEWS}</span>
          </Button>
        </SheetTrigger>
      )}

      {/* An address that is no screen has no views to list, so there is nothing to govern. */}
      {properties.wide && properties.openScreen !== undefined ? (
        <Button
          ref={control}
          type="button"
          variant="ghost"
          size="icon"
          aria-expanded={properties.showing}
          aria-controls={properties.controls}
          onClick={() => properties.onShow(!properties.showing)}
        >
          <Icon name="secondary-nav" className="text-muted-foreground" />
          <span className="sr-only">
            {properties.showing ? "Hide the secondary nav" : "Show the secondary nav"}
          </span>
        </Button>
      ) : null}

      {/* The regions keep the widths they have in the shell, so nothing here is a second
          layout to maintain. */}
      <SheetContent
        side="left"
        className="w-sidebar max-w-full gap-0 overflow-y-auto p-0"
        onCloseAutoFocus={handBackFocus}
      >
        <SheetHeader className="border-b border-border">
          <SheetTitle>{SCREENS_AND_VIEWS}</SheetTitle>
        </SheetHeader>

        <IconRail
          surface={properties.surface}
          openScreen={properties.openScreen}
          tooltips={false}
          onChoose={close}
        />

        {properties.openScreen === undefined ? null : (
          <SecondaryNav
            showing
            screen={properties.openScreen}
            openViewPath={properties.openViewPath}
            onChoose={close}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
