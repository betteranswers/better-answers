import { describe, expect, it } from "vitest";

import { DECLARED_ACTS } from "@/features/people/audit-acts.ts";
import { ACTS_SAID, sentenceOf, type SaidEvent } from "@/features/people/audit-sentences.ts";

const HANNAH = { kind: "person", displayName: "Hannah Wright" } as const;

const byHannah = (event: Pick<SaidEvent, "act" | "subject"> & Partial<SaidEvent>): SaidEvent => ({
  by: HANNAH,
  detail: {},
  ...event,
});

describe("an audit event's sentence", () => {
  it("says a role change with both people named", () => {
    const changed = byHannah({
      act: "people.member.role_changed",
      subject: { kind: "person", displayName: "Priya Shah" },
      detail: { previousRole: "Viewer", role: "Editor" },
    });

    expect(sentenceOf(changed)).toBe("Hannah Wright changed Priya Shah's role to Editor");
  });

  it("says a deleted group for a group since deleted", () => {
    const added = byHannah({
      act: "people.group.member_added",
      subject: { kind: "deleted-group" },
      detail: { userId: "01J6AAAAAAAAAAAAAAAAAAAAAA" },
    });

    expect(sentenceOf(added)).toBe("Hannah Wright added a member to a deleted group");
  });

  it("names a group as it stands now", () => {
    const renamed = byHannah({
      act: "people.group.renamed",
      subject: { kind: "group", name: "Bid team" },
    });

    expect(sentenceOf(renamed)).toBe("Hannah Wright renamed the group now called Bid team");
  });

  it("names an erased person a former member", () => {
    const removed = byHannah({
      act: "people.member.removed",
      subject: { kind: "former-member" },
      detail: { role: "Editor", grants: [] },
    });

    expect(sentenceOf(removed)).toBe("Hannah Wright removed a former member from the workspace");
  });

  it("names an invitation by its address", () => {
    const invited = byHannah({
      act: "people.invitation.created",
      subject: { kind: "invitation", address: "jo.bloggs@example.invalid" },
      detail: { role: "Viewer" },
    });

    expect(sentenceOf(invited)).toBe(
      "Hannah Wright sent an invitation to jo.bloggs@example.invalid as Viewer",
    );
  });

  it("says an invitation erasure deleted without an address", () => {
    const invited = byHannah({
      act: "people.invitation.created",
      subject: { kind: "erased-invitation" },
      detail: { role: "Viewer" },
    });

    expect(sentenceOf(invited)).toBe("Hannah Wright sent an invitation as Viewer");
  });

  it("says a replaced invitation was replaced, not cancelled", () => {
    const replaced = byHannah({
      act: "people.invitation.cancelled",
      subject: { kind: "invitation", address: "jo.bloggs@example.invalid" },
      detail: { replacedByInvitationId: "01J6BBBBBBBBBBBBBBBBBBBBBB" },
    });

    expect(sentenceOf(replaced)).toBe(
      "Hannah Wright replaced an invitation to jo.bloggs@example.invalid with a new one",
    );
  });

  it("capitalises the platform or a former member as the actor", () => {
    const provisioned: SaidEvent = {
      act: "platform.workspace.provisioned",
      by: { kind: "platform" },
      subject: null,
      detail: { role: "Admin" },
    };
    const created: SaidEvent = {
      act: "people.group.created",
      by: { kind: "former-member" },
      subject: { kind: "group", name: "Bid writers" },
      detail: {},
    };

    expect(sentenceOf(provisioned)).toBe("The platform provisioned the workspace");
    expect(sentenceOf(created)).toBe("A former member created the group Bid writers");
  });

  it("never changes the case of a person's display name", () => {
    const signedIn: SaidEvent = {
      act: "people.person.signed_in",
      by: { kind: "person", displayName: "dj okoro" },
      subject: { kind: "person", displayName: "dj okoro" },
      detail: {},
    };

    expect(sentenceOf(signedIn)).toBe("dj okoro signed in");
  });

  it("draws today's label for an act it does not know", () => {
    const unknown = byHannah({ act: "people.probe.unheard_of", subject: null });

    expect(sentenceOf(unknown)).toBe("Probe unheard of");
  });
});

describe("the sentences against the acts core declares", () => {
  it("says every act declared across the four families", () => {
    const unsaid = DECLARED_ACTS.filter((act) => !ACTS_SAID.includes(act));

    expect(unsaid, "declared acts with no sentence").toEqual([]);
  });

  it("says no act core never declared", () => {
    const declared: readonly string[] = DECLARED_ACTS;
    const undeclared = ACTS_SAID.filter((act) => !declared.includes(act));

    expect(undeclared, "sentences for acts no slice declares").toEqual([]);
  });
});
