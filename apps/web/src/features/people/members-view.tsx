import { KeystrokesAct } from "@/shared/keystrokes.tsx";
import { screenById } from "@/shared/screens.ts";
import { useOpenTab, type ViewToolbar } from "@/shared/view-toolbar.tsx";

import { MembersTab } from "./members-tab.tsx";
import { PEOPLE_KEYSTROKES } from "./people-state.ts";

const people = screenById("people");

const UNBUILT_TABS = new Map([
  ["invitations", "Invitations are not built yet."],
  ["requests", "Access requests are not built yet."],
]);

export const MEMBERS_TOOLBAR: ViewToolbar = {
  tabs: [
    { id: "members", name: "Members" },
    { id: "invitations", name: "Invitations" },
    { id: "requests", name: "Requests" },
  ],
  acts: <KeystrokesAct screen={people.name} keystrokes={Object.values(PEOPLE_KEYSTROKES)} />,
};

export function MembersView() {
  const unbuilt = UNBUILT_TABS.get(useOpenTab() ?? "");

  return (
    <>
      <h1>{people.name}</h1>
      <p className="mt-2 text-muted-foreground">{people.summary}</p>

      {unbuilt === undefined ? (
        <MembersTab />
      ) : (
        <p className="mt-6 border border-border bg-card p-4">{unbuilt}</p>
      )}
    </>
  );
}
