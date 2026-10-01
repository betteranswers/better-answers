import { useState, type ReactNode } from "react";

import {
  OpenTabProvider,
  useOpenTab,
  ViewStateSlot,
  type ScreenTab,
  type ScreenToolbar,
} from "@/shared/screen-toolbar.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs.tsx";

/**
 * Derived, not reset: an id is the declaring screen's own, so a screen that does not declare
 * the pick opens on its first tab.
 */
export const openTabIn = (
  tabs: readonly ScreenTab[] | undefined,
  picked: string | undefined,
): ScreenTab | undefined => tabs?.find((tab) => tab.id === picked) ?? tabs?.[0];

export type PickedTab = readonly [string | undefined, (picked: string | undefined) => void];

/** Opens on the first tab until one is picked; with no tabs, it holds the view-state slot alone. */
export function ScreenTabsRoot(properties: {
  readonly tabs: readonly ScreenTab[] | undefined;
  /** The frame's, so the band names the open tab; a root drawn alone keeps its own. */
  readonly picked?: PickedTab;
  readonly children: ReactNode;
}) {
  const own = useState<string>();
  const [picked, setPicked] = properties.picked ?? own;

  const openTab = openTabIn(properties.tabs, picked)?.id;

  /**
   * Inside the tabs root, so the slot spans the toolbar and the panel and both halves of a
   * screen see one value.
   */
  const spanned = <ViewStateSlot>{properties.children}</ViewStateSlot>;

  if (openTab === undefined) return spanned;

  return (
    // Spanning the toolbar and the content leaves the whole pattern to the registry: its
    // arrow keys above, its own tabpanel below.
    <Tabs
      value={openTab}
      onValueChange={setPicked}
      // Out of the layout: the regions stay the content column's own children.
      className="contents"
    >
      <OpenTabProvider openTab={openTab}>{spanned}</OpenTabProvider>
    </Tabs>
  );
}

/** The open tab's panel; with no tab open, its children as they are. */
export function ScreenPanel(properties: { readonly children: ReactNode }) {
  const openTab = useOpenTab();
  if (openTab === undefined) return <>{properties.children}</>;

  // The shell's half of the pattern, not the screen's: an open tab must control a panel even
  // where the screen inside it failed to draw.
  return (
    // Keyed, so a picked tab draws on a subtree of its own and asks again for a screen that
    // threw on the last one.
    <TabsContent key={openTab} value={openTab}>
      {properties.children}
    </TabsContent>
  );
}

export function Toolbar(properties: { readonly name: string; readonly toolbar: ScreenToolbar }) {
  const { tabs, acts } = properties.toolbar;

  return (
    // No `role="toolbar"`: it promises one tab stop and arrow keys across the band, which is
    // the tab list's own contract.
    <div className="flex min-h-12 flex-wrap items-center gap-x-4 gap-y-1 border-b border-border bg-muted px-4 md:flex-nowrap md:px-5">
      {tabs === undefined || tabs.length === 0 ? null : (
        <TabsList variant="line" aria-label={properties.name}>
          {tabs.map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id}>
              {tab.name}
            </TabsTrigger>
          ))}
        </TabsList>
      )}

      {acts === undefined ? null : (
        <div className="ml-auto flex shrink-0 items-center gap-2">{acts}</div>
      )}
    </div>
  );
}
