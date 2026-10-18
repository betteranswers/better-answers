import { describe, expect, it } from "vitest";

import { DECLARED_ACTIONS } from "@/shared/audit/audit-actions.ts";
import { detailLinesOf, type DetailLine } from "@/shared/audit/audit-details.ts";
import {
  ACTIONS_HEADED,
  ACTIONS_SAID,
  headlineOf,
  sentenceOf,
  type SaidEvent,
} from "@/shared/audit/audit-sentences.ts";

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

const BY_THE_PLATFORM = { kind: "platform" } as const;

const ledBy = (actor: string, ...parts: readonly string[]): RegExp =>
  new RegExp(
    `^${[actor, ...parts].map((part) => part.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)).join(".*")}`,
    "v",
  );

const LED_BY_NO_PERSON = /^\p{Lu}/v;

const shownIn = (lines: readonly DetailLine[]): readonly (readonly [string, string])[] =>
  lines.map(({ key, value }) => [key, value]);

describe("an audit event's sentence", () => {
  it("names who changed whose role, and the role", () => {
    const changed = byHannah({
      action: "people.member.role_changed",
      subject: PRIYA,
      detail: { previousRole: "Viewer", role: "Editor" },
    });

    expect(sentenceOf(changed)).toMatch(ledBy("Hannah Wright", "Priya Shah", "Editor"));
  });

  it("names the person added to a group since deleted", () => {
    const added = byHannah({
      action: "people.group.member_added",
      subject: { kind: "deleted-group" },
      detail: { userId: "01J6AAAAAAAAAAAAAAAAAAAAAA" },
      named: { userId: PRIYA },
    });

    expect(sentenceOf(added)).toMatch(ledBy("Hannah Wright", "Priya Shah"));
    expect(sentenceOf(added)).not.toContain("01J6AAAAAAAAAAAAAAAAAAAAAA");
  });

  it("names a group as it stands now", () => {
    const renamed = byHannah({
      action: "people.group.renamed",
      subject: { kind: "group", name: "Bid team" },
    });

    expect(sentenceOf(renamed)).toMatch(ledBy("Hannah Wright", "Bid team"));
  });

  it("names no one for an erased person", () => {
    const removed = (subject: SaidEvent["subject"]): string =>
      sentenceOf(
        byHannah({
          action: "people.member.removed",
          subject,
          detail: { role: "Editor", grants: [] },
        }),
      );

    expect(removed({ kind: "former-member" })).toMatch(ledBy("Hannah Wright"));
    expect(removed({ kind: "former-member" })).not.toBe(removed(PRIYA));
    expect(removed({ kind: "former-member" })).not.toBe(removed(null));
  });

  it("names an invitation by its address", () => {
    const invited = byHannah({
      action: "people.invitation.created",
      subject: { kind: "invitation", address: "jo.bloggs@example.invalid" },
      detail: { role: "Viewer" },
    });

    expect(sentenceOf(invited)).toMatch(
      ledBy("Hannah Wright", "jo.bloggs@example.invalid", "Viewer"),
    );
  });

  it("gives no address for an invitation an erasure deleted", () => {
    const invited = byHannah({
      action: "people.invitation.created",
      subject: { kind: "erased-invitation" },
      detail: { role: "Viewer" },
    });

    expect(sentenceOf(invited)).toMatch(ledBy("Hannah Wright", "Viewer"));
    expect(sentenceOf(invited)).not.toContain("@");
  });

  it("tells a replaced invitation from a cancelled one", () => {
    const cancelled = byHannah({
      action: "people.invitation.cancelled",
      subject: { kind: "invitation", address: "jo.bloggs@example.invalid" },
    });
    const replaced = sentenceOf({
      ...cancelled,
      detail: { replacedByInvitationId: "01J6BBBBBBBBBBBBBBBBBBBBBB" },
    });

    expect(replaced).toMatch(ledBy("Hannah Wright", "jo.bloggs@example.invalid"));
    expect(replaced).not.toBe(sentenceOf(cancelled));
    expect(replaced).not.toContain("01J6BBBBBBBBBBBBBBBBBBBBBB");
  });

  it("capitalises the platform or a former member as the actor", () => {
    const provisioned: SaidEvent = {
      action: "platform.workspace.provisioned",
      by: BY_THE_PLATFORM,
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

    expect(sentenceOf(provisioned)).toMatch(LED_BY_NO_PERSON);
    expect(sentenceOf(created)).toMatch(LED_BY_NO_PERSON);
    expect(sentenceOf(created)).toContain("Bid writers");
    expect(sentenceOf(created)).not.toBe(sentenceOf({ ...created, by: BY_THE_PLATFORM }));
  });

  it("never changes the case of a person's display name", () => {
    const signedIn: SaidEvent = {
      action: "people.person.signed_in",
      by: { kind: "person", displayName: "dj okoro", address: "dj@example.invalid" },
      subject: { kind: "person", displayName: "dj okoro", address: "dj@example.invalid" },
      detail: {},
      named: {},
    };

    expect(sentenceOf(signedIn)).toMatch(ledBy("dj okoro"));
  });

  it("reads an unknown action by its stored name in words", () => {
    const unknown = byHannah({ action: "people.probe.unheard_of", subject: null });

    expect(sentenceOf(unknown)).toMatch(/^probe unheard of$/iv);
  });
});

describe("a second factor's audit sentence", () => {
  const ofHerself = (action: SaidEvent["action"], detail: SaidEvent["detail"] = {}): SaidEvent =>
    byHannah({ action, subject: HANNAH, detail });

  it("names the factor a confirmation used", () => {
    expect(
      sentenceOf(ofHerself("people.person.second_factor_confirmed", { method: "passkey" })),
    ).toMatch(ledBy("Hannah Wright", "a passkey"));
    expect(
      sentenceOf(ofHerself("people.person.second_factor_confirmed", { method: "authenticator" })),
    ).toMatch(ledBy("Hannah Wright", "an authenticator"));
  });

  it("names the factor that replaced the old ones", () => {
    expect(
      sentenceOf(ofHerself("people.person.factors_replaced", { by: "authenticator" })),
    ).toMatch(ledBy("Hannah Wright", "an authenticator"));
  });

  it("keeps a factor it has not met off the page", () => {
    const unknown = sentenceOf(ofHerself("people.person.factors_replaced", { by: "microsoft" }));

    expect(unknown).toMatch(ledBy("Hannah Wright"));
    expect(unknown).not.toContain("microsoft");
    expect(unknown).not.toBe(
      sentenceOf(ofHerself("people.person.factors_replaced", { by: "authenticator" })),
    );
  });

  it("opens a used restore code with who used it", () => {
    expect(sentenceOf(ofHerself("people.person.restore_code_accepted"))).toMatch(
      ledBy("Hannah Wright"),
    );
  });

  it("names whose sign-in the platform restored", () => {
    const restored: SaidEvent = {
      action: "people.person.sign_in_restored",
      by: BY_THE_PLATFORM,
      subject: PRIYA,
      detail: {},
      named: {},
    };

    expect(sentenceOf(restored)).toMatch(LED_BY_NO_PERSON);
    expect(sentenceOf(restored).indexOf("Priya Shah")).toBeGreaterThan(0);
  });
});

describe("an audit event in today's words", () => {
  const HANDBOOK = { kind: "connected-source", name: "Staff handbook" } as const;

  it("names a published connected source, never its stored action", () => {
    const published = byHannah({
      action: "sources.binding.published",
      subject: HANDBOOK,
      detail: { bindingId: "01J6CCCCCCCCCCCCCCCCCCCCCC" },
      named: { bindingId: HANDBOOK },
    });

    expect(sentenceOf(published)).toMatch(ledBy("Hannah Wright", "Staff handbook"));
    expect(sentenceOf(published)).not.toMatch(/binding/iv);
    expect(headlineOf(published.action)).not.toBe("");
    expect(headlineOf(published.action)).not.toMatch(/binding/iv);
  });

  it("names no connected source once it is removed", () => {
    const widened = (subject: SaidEvent["subject"]): string =>
      sentenceOf(byHannah({ action: "sources.binding.widened", subject }));
    const removed = widened({ kind: "removed", of: "connected-source" });

    expect(removed).toMatch(ledBy("Hannah Wright"));
    expect(removed).not.toMatch(/binding/iv);
    expect(removed).not.toBe(widened(HANDBOOK));
    expect(removed).not.toBe(widened(null));
  });

  it("opens on the platform for an action no person took", () => {
    const swept: SaidEvent = {
      action: "platform.graph.swept",
      by: BY_THE_PLATFORM,
      subject: null,
      detail: { generation: 3, nodes: 10, edges: 4 },
      named: {},
    };

    expect(sentenceOf(swept)).toMatch(LED_BY_NO_PERSON);
    expect(sentenceOf(swept)).not.toBe(sentenceOf({ ...swept, by: HANNAH }));
  });

  it("names a person with no display name by their address", () => {
    const signedIn = byHannah({
      action: "people.person.signed_in",
      by: { kind: "person", displayName: "", address: "new.starter@example.invalid" },
      subject: null,
    });

    expect(sentenceOf(signedIn)).toMatch(ledBy("new.starter@example.invalid"));
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

  it("gives no two declared actions the same sentence", () => {
    const actionsBySentence = Map.groupBy(DECLARED_ACTIONS, (action) =>
      sentenceOf(
        byHannah({
          action,
          subject: PRIYA,
          detail: { userId: "01J6DDDDDDDDDDDDDDDDDDDDDD", role: "Editor" },
          named: { userId: PRIYA },
        }),
      ),
    );
    const shared = [...actionsBySentence.values()].filter((actions) => actions.length > 1);

    expect(shared, "actions that read as the same sentence").toEqual([]);
  });
});

describe("an audit event's detail in today's words", () => {
  it("shows a connected source's id as its name", () => {
    const handbook = { kind: "connected-source", name: "Staff handbook" } as const;

    expect(
      shownIn(
        detailLinesOf({
          detail: { bindingId: "01J6CCCCCCCCCCCCCCCCCCCCCC", sensitivity: "Restricted" },
          named: { bindingId: handbook },
        }),
      ),
    ).toEqual([
      ["bindingId", "Staff handbook"],
      ["sensitivity", "Restricted"],
    ]);
  });

  it("leaves off a detail it has no word for", () => {
    const lines = detailLinesOf({
      detail: { commitSha: "a".repeat(40), setId: "01J6EEEEEEEEEEEEEEEEEEEEEE", replaced: true },
      named: {},
    });

    expect(lines.map((line) => line.key)).toEqual(["replaced"]);
    expect(lines[0]?.value).not.toBe("true");
  });

  it("puts a person's sign-in address beneath their name", () => {
    const lines = detailLinesOf({
      detail: { userId: "01J6FFFFFFFFFFFFFFFFFFFFFF" },
      named: { userId: PRIYA },
    });

    expect(shownIn(lines)).toEqual([["userId", "Priya Shah"]]);
    expect(lines[0]?.address).toBe("priya@example.invalid");
  });

  it("names each person and group an export's search matched", () => {
    const matched = [PRIYA, { kind: "group", name: "Bid writers" }] as const;
    const lines = detailLinesOf({
      detail: { matched: [], family: "people", eventCount: 1 },
      named: { matched },
    });

    expect(lines.map((line) => line.key)).toEqual(["matched", "family", "eventCount"]);
    expect(lines[0]?.value).toMatch(/Priya Shah.*Bid writers/v);
    expect(lines[1]?.value).toMatch(/^people$/iv);
    expect(lines[2]?.value).toBe("1");
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

    expect(shownIn(detailLinesOf({ detail: { grants }, named: {} }))).toEqual([
      ["grants", "Claude"],
    ]);
  });

  it("labels each detail in words, never by its key", () => {
    const lines = detailLinesOf({
      detail: {
        bindingId: "01J6CCCCCCCCCCCCCCCCCCCCCC",
        sensitivity: "Restricted",
        replaced: true,
      },
      named: { bindingId: { kind: "connected-source", name: "Staff handbook" } },
    });

    expect(lines).toHaveLength(3);
    for (const { key, label } of lines) {
      expect(label).not.toBe("");
      expect(label).not.toBe(key);
    }
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
