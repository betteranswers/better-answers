import type { ComponentType } from "react";

import { KeystrokesAct } from "@/shared/keystrokes.tsx";
import { screenById } from "@/shared/screens.ts";
import { useOpenTab, type ViewTab, type ViewToolbar } from "@/shared/view-toolbar.tsx";

import { InvitationsTab } from "./invitations-tab.tsx";
import { InviteAct } from "./invite-act.tsx";
import { MembersTab } from "./members-tab.tsx";
import { PEOPLE_KEYSTROKES } from "./people-state.ts";

const people = screenById("people");

type Tab = ViewTab &
  (
    | { readonly content: ComponentType; readonly unbuilt?: undefined }
    | { readonly content?: undefined; readonly unbuilt: string }
  );

const TABS: readonly Tab[] = [
  { id: "members", name: "Members", content: MembersTab },
  { id: "invitations", name: "Invitations", content: InvitationsTab },
  { id: "requests", name: "Requests", unbuilt: "Access requests are not built yet." },
];

export const MEMBERS_TOOLBAR: ViewToolbar = {
  tabs: TABS.map(({ id, name }) => ({ id, name })),
  acts: (
    <>
      <InviteAct />
      <KeystrokesAct screen={people.name} keystrokes={Object.values(PEOPLE_KEYSTROKES)} />
    </>
  ),
};

export function MembersView() {
  const openTab = useOpenTab();
  const tab = TABS.find((candidate) => candidate.id === openTab) ?? TABS[0];
  const Content = tab?.content;

  return (
    <>
      <h1>{people.name}</h1>
      <p className="mt-2 text-muted-foreground">{people.summary}</p>

      {Content === undefined ? (
        <p className="mt-6 border border-border bg-card p-4">{tab?.unbuilt}</p>
      ) : (
        <Content />
      )}
    </>
  );
}
