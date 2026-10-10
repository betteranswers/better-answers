import { describe, expect, it } from "vitest";

import { DECLARED_ACTIONS } from "@/features/people/audit-actions.ts";
import { detailLinesOf } from "@/features/people/audit-details.ts";
import {
  ACTIONS_HEADED,
  ACTIONS_SAID,
  headlineOf,
  sentenceOf,
  type SaidEvent,
} from "@/features/people/audit-sentences.ts";

const HANNAH = {
  kind: "person",
  displayName: "Hannah Wright",
  address: "hannah@example.invalid",
} as const;

const PRIYA = {
  kind: "person",
  displayName: "Priya Shah",
  address: "priya@example.invalid",
} as const;

const byHannah = (
  event: Pick<SaidEvent, "action" | "subject"> & Partial<SaidEvent>,
): SaidEvent => ({
  by: HANNAH,
  detail: {},
  named: {},
  ...event,
});

describe("an audit event's sentence", () => {
  it("says a role change with both people named", () => {
    const changed = byHannah({
      action: "people.member.role_changed",
      subject: PRIYA,
      detail: { previousRole: "Viewer", role: "Editor" },
    });

    expect(sentenceOf(changed)).toBe("Hannah Wright changed Priya Shah’s role to Editor");
  });

  it("says a deleted group for a group since deleted", () => {
    const added = byHannah({
      action: "people.group.member_added",
      subject: { kind: "deleted-group" },
      detail: { userId: "01J6AAAAAAAAAAAAAAAAAAAAAA" },
      named: { userId: PRIYA },
    });

    expect(sentenceOf(added)).toBe("Hannah Wright added Priya Shah to a deleted group");
  });

  it("names a group as it stands now", () => {
    const renamed = byHannah({
      action: "people.group.renamed",
      subject: { kind: "group", name: "Bid team" },
    });

    expect(sentenceOf(renamed)).toBe("Hannah Wright renamed the group now called Bid team");
  });

  it("names an erased person a former member", () => {
    const removed = byHannah({
      action: "people.member.removed",
      subject: { kind: "former-member" },
      detail: { role: "Editor", grants: [] },
    });

    expect(sentenceOf(removed)).toBe("Hannah Wright removed a former member from the workspace");
  });

  it("names an invitation by its address", () => {
    const invited = byHannah({
      action: "people.invitation.created",
      subject: { kind: "invitation", address: "jo.bloggs@example.invalid" },
      detail: { role: "Viewer" },
    });

    expect(sentenceOf(invited)).toBe(
      "Hannah Wright sent an invitation to jo.bloggs@example.invalid as Viewer",
    );
  });

  it("says an invitation erasure deleted without an address", () => {
    const invited = byHannah({
      action: "people.invitation.created",
      subject: { kind: "erased-invitation" },
      detail: { role: "Viewer" },
    });

    expect(sentenceOf(invited)).toBe("Hannah Wright sent an invitation as Viewer");
  });

  it("says a replaced invitation was replaced, not cancelled", () => {
    const replaced = byHannah({
      action: "people.invitation.cancelled",
      subject: { kind: "invitation", address: "jo.bloggs@example.invalid" },
      detail: { replacedByInvitationId: "01J6BBBBBBBBBBBBBBBBBBBBBB" },
    });

    expect(sentenceOf(replaced)).toBe(
      "Hannah Wright replaced an invitation to jo.bloggs@example.invalid with a new one",
    );
  });

  it("capitalises the platform or a former member as the actor", () => {
    const provisioned: SaidEvent = {
      action: "platform.workspace.provisioned",
      by: { kind: "platform" },
      subject: null,
      detail: { role: "Admin" },
      named: {},
    };
    const created: SaidEvent = {
      action: "people.group.created",
      by: { kind: "former-member" },
      subject: { kind: "group", name: "Bid writers" },
      detail: {},
      named: {},
    };

    expect(sentenceOf(provisioned)).toBe("The platform provisioned the workspace");
    expect(sentenceOf(created)).toBe("A former member created the group Bid writers");
  });

  it("never changes the case of a person's display name", () => {
    const signedIn: SaidEvent = {
      action: "people.person.signed_in",
      by: { kind: "person", displayName: "dj okoro", address: "dj@example.invalid" },
      subject: { kind: "person", displayName: "dj okoro", address: "dj@example.invalid" },
      detail: {},
      named: {},
    };

    expect(sentenceOf(signedIn)).toBe("dj okoro signed in");
  });

  it("reads an unknown action by its stored name in words", () => {
    const unknown = byHannah({ action: "people.probe.unheard_of", subject: null });

    expect(sentenceOf(unknown)).toBe("Probe unheard of");
  });
});

describe("a second factor's audit sentence", () => {
  const ofHerself = (action: SaidEvent["action"], detail: SaidEvent["detail"] = {}): SaidEvent =>
    byHannah({ action, subject: HANNAH, detail });

  it("names the factor a confirmation used", () => {
    expect(
      sentenceOf(ofHerself("people.person.second_factor_confirmed", { method: "passkey" })),
    ).toBe("Hannah Wright confirmed their second factor with a passkey");
    expect(
      sentenceOf(ofHerself("people.person.second_factor_confirmed", { method: "authenticator" })),
    ).toBe("Hannah Wright confirmed their second factor with an authenticator");
  });

  it("names the factor that replaced the old ones", () => {
    expect(sentenceOf(ofHerself("people.person.factors_replaced", { by: "authenticator" }))).toBe(
      "Hannah Wright replaced their second factors with an authenticator",
    );
  });

  it("says an unknown factor as a second factor", () => {
    expect(sentenceOf(ofHerself("people.person.factors_replaced", { by: "microsoft" }))).toBe(
      "Hannah Wright replaced their second factors with a second factor",
    );
  });

  it("says a restore code from better-answers support was used", () => {
    expect(sentenceOf(ofHerself("people.person.restore_code_accepted"))).toBe(
      "Hannah Wright used a restore code from better-answers support",
    );
  });

  it("says the platform restored a person's sign-in", () => {
    const restored: SaidEvent = {
      action: "people.person.sign_in_restored",
      by: { kind: "platform" },
      subject: PRIYA,
      detail: {},
      named: {},
    };

    expect(sentenceOf(restored)).toBe("The platform restored Priya Shah’s sign-in");
  });
});

describe("an audit event in today's words", () => {
  const HANDBOOK = { kind: "connected-source", name: "Staff handbook" } as const;

  it("says a connected source published, whatever its stored action name", () => {
    const published = byHannah({
      action: "sources.binding.published",
      subject: HANDBOOK,
      detail: { bindingId: "01J6CCCCCCCCCCCCCCCCCCCCCC" },
      named: { bindingId: HANDBOOK },
    });

    expect(sentenceOf(published)).toBe(
      "Hannah Wright published the connected source Staff handbook",
    );
    expect(headlineOf(published.action)).toBe("Connected source published");
  });

  it("says a connected source since removed by its kind", () => {
    const widened = byHannah({
      action: "sources.binding.widened",
      subject: { kind: "removed", of: "connected-source" },
    });

    expect(sentenceOf(widened)).toBe("Hannah Wright widened a connected source (removed)");
  });

  it("says the platform for an action no person took", () => {
    const swept: SaidEvent = {
      action: "platform.graph.swept",
      by: { kind: "platform" },
      subject: null,
      detail: { generation: 3, nodes: 10, edges: 4 },
      named: {},
    };

    expect(sentenceOf(swept)).toBe("The platform cleared older copies of the map");
  });

  it("names a person with no display name by their address", () => {
    const signedIn = byHannah({
      action: "people.person.signed_in",
      by: { kind: "person", displayName: "", address: "new.starter@example.invalid" },
      subject: null,
    });

    expect(sentenceOf(signedIn)).toBe("new.starter@example.invalid signed in");
  });

  it("says no stored action name, actor id or person id", () => {
    const actorId = `human:${"01J6DDDDDDDDDDDDDDDDDDDDDD"}`;
    const said = DECLARED_ACTIONS.map((action) =>
      sentenceOf(
        byHannah({
          action,
          subject: PRIYA,
          detail: { userId: "01J6DDDDDDDDDDDDDDDDDDDDDD", role: "Editor" },
          named: { userId: PRIYA },
        }),
      ),
    );

    for (const sentence of said) {
      expect(sentence).not.toMatch(/[a-z]+\.[a-z_]+\.[a-z_]+/);
      expect(sentence).not.toContain(actorId);
      expect(sentence).not.toContain("01J6DDDDDDDDDDDDDDDDDDDDDD");
    }
  });
});

describe("an audit event's detail in today's words", () => {
  it("shows a connected source's id as its name", () => {
    const handbook = { kind: "connected-source", name: "Staff handbook" } as const;

    expect(
      detailLinesOf({
        detail: { bindingId: "01J6CCCCCCCCCCCCCCCCCCCCCC", sensitivity: "Restricted" },
        named: { bindingId: handbook },
      }),
    ).toEqual([
      { key: "bindingId", label: "Connected source", value: "Staff handbook" },
      { key: "sensitivity", label: "Sensitivity", value: "Restricted" },
    ]);
  });

  it("leaves off a detail it has no word for", () => {
    expect(
      detailLinesOf({
        detail: { commitSha: "a".repeat(40), setId: "01J6EEEEEEEEEEEEEEEEEEEEEE", replaced: true },
        named: {},
      }),
    ).toEqual([{ key: "replaced", label: "Replaced earlier codes", value: "Yes" }]);
  });

  it("puts a person's sign-in address beneath their name", () => {
    const lines = detailLinesOf({
      detail: { userId: "01J6FFFFFFFFFFFFFFFFFFFFFF" },
      named: { userId: PRIYA },
    });

    expect(lines).toEqual([
      { key: "userId", label: "Person", value: "Priya Shah", address: "priya@example.invalid" },
    ]);
  });

  it("names each person and group an export's search matched", () => {
    const matched = [PRIYA, { kind: "group", name: "Bid writers" }] as const;

    expect(
      detailLinesOf({
        detail: { matched: [], family: "people", eventCount: 1 },
        named: { matched },
      }),
    ).toEqual([
      { key: "matched", label: "Search matched", value: "Priya Shah, Bid writers" },
      { key: "family", label: "Family", value: "People" },
      { key: "eventCount", label: "Events", value: "1" },
    ]);
  });

  it("leaves off an id the read could not name", () => {
    expect(
      detailLinesOf({ detail: { invitationId: "01J6GGGGGGGGGGGGGGGGGGGGGG" }, named: {} }),
    ).toEqual([]);
  });

  it("reads a credentials ending's access as each assistant's name", () => {
    const grants = [
      { clientId: "https://claude.ai/metadata", clientName: "Claude", workspaceId: null },
    ];

    expect(detailLinesOf({ detail: { grants }, named: {} })).toEqual([
      { key: "grants", label: "Access ended", value: "Claude" },
    ]);
  });
});

describe("the sentences against the actions core declares", () => {
  it("says every action declared across the four families", () => {
    const unsaid = DECLARED_ACTIONS.filter((action) => !ACTIONS_SAID.includes(action));

    expect(unsaid, "declared actions with no sentence").toEqual([]);
  });

  it("heads every action declared across the four families", () => {
    const unheaded = DECLARED_ACTIONS.filter((action) => !ACTIONS_HEADED.includes(action));

    expect(unheaded, "declared actions with no headline").toEqual([]);
  });

  it("says no action core never declared", () => {
    const declared: readonly string[] = DECLARED_ACTIONS;
    const undeclared = [...ACTIONS_SAID, ...ACTIONS_HEADED].filter(
      (action) => !declared.includes(action),
    );

    expect(undeclared, "words for actions no slice declares").toEqual([]);
  });
});
