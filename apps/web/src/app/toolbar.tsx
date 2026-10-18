import { useState, type ReactNode } from "react";

import {
  OpenTabProvider,
  useOpenTab,
  ViewStateSlot,
  type PageTab,
  type PageToolbar,
} from "@/shared/page-toolbar.tsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs.tsx";

export const openTabIn = (
  tabs: readonly PageTab[] | undefined,
  picked: string | undefined,
): PageTab | undefined => tabs?.find((tab) => tab.id === picked) ?? tabs?.[0];

export type PickedTab = readonly [string | undefined, (picked: string | undefined) => void];

export function PageTabsRoot(properties: {
  readonly tabs: readonly PageTab[] | undefined;
  readonly picked?: PickedTab;
  readonly children: ReactNode;
}) {
  const own = useState<string>();
  const [picked, setPicked] = properties.picked ?? own;

  const openTab = openTabIn(properties.tabs, picked)?.id;

  const spanned = <ViewStateSlot>{properties.children}</ViewStateSlot>;

  if (openTab === undefined) return spanned;

  return (
    <Tabs value={openTab} onValueChange={setPicked} className="contents">
      <OpenTabProvider openTab={openTab}>{spanned}</OpenTabProvider>
    </Tabs>
  );
}

export function PagePanel(properties: { readonly children: ReactNode }) {
  const openTab = useOpenTab();
  if (openTab === undefined) return <>{properties.children}</>;

  return (
    <TabsContent key={openTab} value={openTab}>
      {properties.children}
    </TabsContent>
  );
}

export function Toolbar(properties: { readonly name: string; readonly toolbar: PageToolbar }) {
  const { tabs } = properties.toolbar;
  if (tabs === undefined || tabs.length === 0) return null;

  return (
    // No `role="toolbar"`: it promises one tab stop and arrow keys across the row, which is
    // the tab list's own contract.
    <div className="mt-4 flex border-b border-border">
      <TabsList variant="line" aria-label={properties.name}>
        {tabs.map((tab) => (
          <TabsTrigger key={tab.id} value={tab.id}>
            {tab.name}
          </TabsTrigger>
        ))}
      </TabsList>
    </div>
  );
}
