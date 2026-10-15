import { type Outcome } from "@/shared/outcome.tsx";

import { GROUP_WORDS } from "./group-words.ts";
import { type ListedGroup, type useRenameGroup } from "./groups-api.ts";
import { outcomeOfGroupFailure } from "./refusal.tsx";

/** The trimmed name a group form holds, or nothing when the form carried none. */
const nameOfGroupForm = (form: HTMLFormElement): string | undefined => {
  const asked = new FormData(form).get("name");
  return typeof asked === "string" ? asked.trim() : undefined;
};

/** Sends what a rename form holds; a name the group already has is said, never sent. */
export const submitRename = (properties: {
  readonly group: ListedGroup;
  readonly form: HTMLFormElement;
  readonly renameGroup: ReturnType<typeof useRenameGroup>;
  /** Hears each outcome that leaves the form where it is. */
  readonly say: (outcome: Outcome) => void;
  /** Hears a rename that went, in `say`'s place, where the form closes on it. */
  readonly sent?: ((outcome: Outcome) => void) | undefined;
}): void => {
  const { group } = properties;
  const name = nameOfGroupForm(properties.form);
  if (name === undefined) return;
  const was = group.name;
  if (name === was) {
    properties.say({ tone: "said", words: `The group is already called ${was}.` });
    return;
  }
  void properties.renameGroup.mutateAsync({ groupId: group.id, name }).then(
    () => {
      (properties.sent ?? properties.say)({ tone: "said", words: GROUP_WORDS.renamed(was, name) });
    },
    (failure: Error) => {
      properties.say(outcomeOfGroupFailure(failure, "action"));
    },
  );
};
