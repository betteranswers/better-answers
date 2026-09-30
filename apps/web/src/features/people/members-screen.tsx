import type { ComponentType } from "react";

import { KeystrokesAct, type Keystroke } from "@/shared/keystrokes.tsx";
import { CONTROL_CENTRE, groupIn } from "@/shared/navigation.ts";
import { useOpenTab, type ScreenTab, type ScreenToolbar } from "@/shared/screen-toolbar.tsx";

import { InvitationsTab } from "./invitations-tab.tsx";
import { InviteAct } from "./invite-act.tsx";
import { MembersTab } from "./members-tab.tsx";
import { PEOPLE_KEYSTROKES as KEY } from "./people-state.ts";
import { RequestsTab } from "./requests-tab.tsx";

const people = groupIn(CONTROL_CENTRE, "people");

/** A tab binds its keystrokes only while it is open, so a key two tabs share acts once. */
type Tab = ScreenTab & {
  readonly content: ComponentType;
  readonly keystrokes: readonly Keystroke[];
};

const MEMBERS: Tab = {
  id: "members",
  name: "Members",
  content: MembersTab,
  keystrokes: [
    KEY.search,
    KEY.open,
    KEY.changeRole,
    KEY.revokeCredentials,
    KEY.changeGroups,
    KEY.remove,
    KEY.flagName,
    KEY.invite,
  ],
};

const TABS: readonly Tab[] = [
  MEMBERS,
  {
    id: "invitations",
    name: "Invitations",
    content: InvitationsTab,
    keystrokes: [KEY.invite, KEY.resend, KEY.cancel],
  },
  {
    id: "requests",
    name: "Requests",
    content: RequestsTab,
    keystrokes: [KEY.invite, KEY.approve, KEY.decline],
  },
];

const useTheOpenTab = (): Tab => {
  const openTab = useOpenTab();
  return TABS.find((candidate) => candidate.id === openTab) ?? MEMBERS;
};

function OpenTabKeystrokes() {
  return <KeystrokesAct screen={people.name} keystrokes={useTheOpenTab().keystrokes} />;
}

export const MEMBERS_TOOLBAR: ScreenToolbar = {
  tabs: TABS.map(({ id, name }) => ({ id, name })),
  acts: (
    <>
      <InviteAct />
      <OpenTabKeystrokes />
    </>
  ),
};

export function MembersScreen() {
  const Content = useTheOpenTab().content;

  return (
    <>
      <h1>{people.name}</h1>
      <p className="mt-2 text-muted-foreground">{people.summary}</p>
      <Content />
    </>
  );
}
