import { createContext, useContext, useState, type ReactNode } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs.tsx";

export type ViewTab = { readonly id: string; readonly name: string };

export type ViewToolbar = {
  readonly tabs?: readonly ViewTab[] | undefined;
  // A route's static data is built once, so an act carries its own behaviour rather than
  // reaching for the view's own state.
  readonly acts?: ReactNode | undefined;
};

// An empty bar above a view's content is the defect this guards.
export const isFilled = (toolbar: ViewToolbar | undefined): toolbar is ViewToolbar =>
  (toolbar?.tabs ?? []).length > 0 || toolbar?.acts !== undefined;

const OpenTab = createContext<string | undefined>(undefined);

// A view sits under the outlet, where the shell cannot hand it a prop.
export const useOpenTab = (): string | undefined => useContext(OpenTab);

export function ViewTabsRoot(properties: {
  readonly tabs: readonly ViewTab[] | undefined;
  readonly children: ReactNode;
}) {
  const [picked, setPicked] = useState<string>();

  const tabs = properties.tabs ?? [];
  // Derived, not reset: an id is the declaring view's own, so a view that does not declare the
  // pick opens on its first tab.
  const openTab = tabs.find((tab) => tab.id === picked)?.id ?? tabs[0]?.id;

  if (openTab === undefined) return <>{properties.children}</>;

  return (
    // Spanning the toolbar and the content leaves the whole pattern to the registry: its
    // arrow keys above, its own tabpanel below.
    <Tabs
      value={openTab}
      onValueChange={setPicked}
      // Out of the layout: the regions stay the content column's own children.
      className="contents"
    >
      <OpenTab.Provider value={openTab}>{properties.children}</OpenTab.Provider>
    </Tabs>
  );
}

export function ViewPanel(properties: { readonly children: ReactNode }) {
  const openTab = useOpenTab();
  if (openTab === undefined) return <>{properties.children}</>;

  // The shell's half of the pattern, not the view's: an open tab must control a panel even
  // where the view inside it failed to draw.
  return (
    // Keyed, so a picked tab draws on a subtree of its own and asks again for a view that
    // threw on the last one.
    <TabsContent key={openTab} value={openTab}>
      {properties.children}
    </TabsContent>
  );
}

export function Toolbar(properties: { readonly name: string; readonly toolbar: ViewToolbar }) {
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
