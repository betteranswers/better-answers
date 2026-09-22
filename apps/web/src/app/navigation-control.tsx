import { useState } from "react";

import { Icon } from "@/shared/icon.tsx";
import type { Screen } from "@/shared/screens.ts";
import { Button } from "@/shared/ui/button.tsx";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/shared/ui/sheet.tsx";
import { IconRail } from "./icon-rail.tsx";
import { SecondaryNav } from "./secondary-nav.tsx";

const SCREENS_AND_VIEWS = "Screens and views";

export function NavigationControl(properties: {
  readonly wide: boolean;
  readonly showing: boolean;
  readonly controls: string;
  readonly openScreen: Screen | undefined;
  readonly openViewPath: string | undefined;
  readonly onShow: (showing: boolean) => void;
}) {
  if (!properties.wide) {
    return (
      <NavigationSheet openScreen={properties.openScreen} openViewPath={properties.openViewPath} />
    );
  }

  // An address that is no screen has no views to list, so there is nothing to govern.
  if (properties.openScreen === undefined) return null;

  return (
    <Button
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
  );
}

function NavigationSheet(properties: {
  readonly openScreen: Screen | undefined;
  readonly openViewPath: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button type="button" variant="ghost" size="icon">
          <Icon name="navigation" className="text-muted-foreground" />
          <span className="sr-only">{SCREENS_AND_VIEWS}</span>
        </Button>
      </SheetTrigger>

      {/* The regions keep the widths they have in the shell, so nothing here is a second
          layout to maintain. */}
      <SheetContent side="left" className="w-sidebar max-w-full gap-0 overflow-y-auto p-0">
        <SheetHeader className="border-b border-border">
          <SheetTitle>{SCREENS_AND_VIEWS}</SheetTitle>
        </SheetHeader>

        <IconRail openScreenId={properties.openScreen?.id} tooltips={false} onChoose={close} />

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
