import type { ComponentType } from "react";

import { usePageKeystrokes, type Keystroke } from "@/shared/keystrokes.tsx";
import { CONTROL_CENTRE, menuGroupIn } from "@/shared/navigation.ts";
import { useOpenTab, type PageTab, type PageToolbar } from "@/shared/page-toolbar.tsx";
import { counted } from "@/shared/words.ts";

import { InvitationsTab } from "./invitations-tab.tsx";
import { InviteAction } from "./invite-action.tsx";
import { MembersTab } from "./members-tab.tsx";
import { useMembers } from "./people-api.ts";
import { PEOPLE_KEYSTROKES as KEY } from "./people-state.ts";
import { RequestsTab } from "./requests-tab.tsx";

const people = menuGroupIn(CONTROL_CENTRE, "people");

/** A tab binds its keystrokes only while it is open, so a key two tabs share fires once. */
type Tab = PageTab & {
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
    KEY.endEverySignInAndToken,
    KEY.changeGroups,
    KEY.remove,
    KEY.flagName,
    KEY.tick,
    KEY.changeSelectedRoles,
    KEY.addSelectedToGroup,
    KEY.removeSelected,
    KEY.clearSelection,
    KEY.previousPage,
    KEY.nextPage,
    KEY.invite,
  ],
};

const TABS: readonly Tab[] = [
  MEMBERS,
  {
    id: "invitations",
    name: "Invitations",
    content: InvitationsTab,
    keystrokes: [
      KEY.searchInvitations,
      KEY.resend,
      KEY.cancel,
      KEY.tickInvitation,
      KEY.resendSelected,
      KEY.cancelSelected,
      KEY.clearSelection,
      KEY.previousInvitations,
      KEY.nextInvitations,
      KEY.invite,
    ],
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

/** The workspace's size, said beside the action that grows it, whichever tab is open. */
function MemberCount() {
  const members = useMembers();
  if (members.data === undefined) return null;
  return (
    <span className="text-sm text-muted-foreground tabular-nums">
      {counted(members.data.length, "member", "members")}
    </span>
  );
}

export const MEMBERS_TOOLBAR: PageToolbar = {
  tabs: TABS.map(({ id, name }) => ({ id, name })),
  actions: (
    <>
      <MemberCount />
      <InviteAction />
    </>
  ),
};

export function MembersPage() {
  const openTab = useTheOpenTab();
  usePageKeystrokes(openTab.keystrokes);
  const Content = openTab.content;

  return (
    <>
      <h1>{people.name}</h1>
      <p className="mt-2 text-muted-foreground">{people.summary}</p>
      <Content />
    </>
  );
}
