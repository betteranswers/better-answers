import { useState, type RefObject } from "react";

import { ceilingLiftsIn, type ApiError } from "@/shared/api/trpc.ts";
import { useKeystroke } from "@/shared/keystrokes.tsx";
import { selectFirst, type Outcome } from "@/shared/outcome.tsx";
import { setRefusalOutcome } from "@/shared/refusal-outcome.tsx";
import { SelectionAction } from "@/shared/selection-bar.tsx";

import { bulkResentOutcome, INVITATIONS_WORDS, resentOutcome } from "./invitation-words.ts";
import {
  useBulkCancelInvitations,
  useBulkResendInvitations,
  useCancelInvitation,
  useResendInvitation,
  type BulkCancelled,
  type BulkResent,
  type ListedInvitation,
  type SentInvitation,
} from "./invitations-api.ts";
import { MOST_AT_ONCE } from "./invite-addresses.ts";
import { BULK_WORDS } from "./member-action-words.ts";
import { PEOPLE_KEYSTROKES as KEY, PEOPLE_SELECT_FIRST, shortcutOf } from "./people-state.ts";
import { SAID_OF_TICKED_INVITATIONS } from "./refusal-words.ts";
import { outcomeOfInvitationFailure, outcomeOfSendingFailure } from "./refusal.tsx";

export type Ticked = ReadonlyMap<string, string>;

export const NONE: Ticked = new Map();

type ActedList = {
  readonly readable: boolean;
  readonly ticked: Ticked;
  readonly tick: (ticked: Ticked) => void;
  readonly heading: RefObject<HTMLElement | null>;
  readonly say: (outcome: Outcome | undefined) => void;
  readonly unsent: (unsent: readonly SentInvitation[]) => void;
};

type Failure = Error | ApiError;

const NOTHING_TICKED = selectFirst(PEOPLE_SELECT_FIRST.invitation);

const STILL_GOING: Outcome = { tone: "said", words: BULK_WORDS.stillGoing };

const TOO_MANY: Outcome = { tone: "said", words: INVITATIONS_WORDS.bulk.tooMany(MOST_AT_ONCE) };

const refusalOf = (failure: Failure, names: Ticked): Outcome =>
  ceilingLiftsIn(failure) === undefined
    ? setRefusalOutcome({
        featureWords: SAID_OF_TICKED_INVITATIONS,
        failure,
        nameOf: (invitationId) => names.get(invitationId) ?? INVITATIONS_WORDS.noLongerListed,
        lead: INVITATIONS_WORDS.bulk.refused,
      })
    : outcomeOfSendingFailure(failure);

export const useOneAtATime = (say: (outcome: Outcome) => void) => {
  const [acting, setActing] = useState(false);
  const resend = useResendInvitation();

  const begin = (): boolean => {
    if (acting) return false;
    setActing(true);
    return true;
  };

  const settled = <Answer,>(
    done: (answer: Answer) => void,
    refused: (failure: Failure) => void,
  ) => ({
    onSuccess: (answer: Answer) => {
      setActing(false);
      done(answer);
    },
    onError: (failure: Failure) => {
      setActing(false);
      refused(failure);
    },
  });

  const resendOne = (invitationId: string) => {
    resend.mutate(
      { invitationId },
      settled<SentInvitation>(
        (sent) => {
          say(resentOutcome(sent));
        },
        (failure) => {
          say(outcomeOfSendingFailure(failure));
        },
      ),
    );
  };

  return { acting, begin, settled, resendOne };
};

export const useInvitationActions = (list: ActedList) => {
  const { acting, begin, settled, resendOne: resend } = useOneAtATime(list.say);
  const cancel = useCancelInvitation();
  const bulkResend = useBulkResendInvitations();
  const bulkCancel = useBulkCancelInvitations();

  const begun = (pending: string): boolean => {
    if (!begin()) {
      list.say(STILL_GOING);
      return false;
    }
    list.unsent([]);
    list.say({ tone: "said", words: pending });
    return true;
  };

  const untick = (invitationId: string) => {
    if (!list.ticked.has(invitationId)) return;
    const kept = new Map(list.ticked);
    kept.delete(invitationId);
    list.tick(kept);
  };

  const resendOne = (invitation: ListedInvitation) => {
    if (!begun(INVITATIONS_WORDS.resending(invitation.address))) return;
    if (invitation.status === "expired") {
      untick(invitation.invitationId);
      list.heading.current?.focus();
    }
    resend(invitation.invitationId);
  };

  const cancelOne = (invitation: ListedInvitation) => {
    if (!begun(INVITATIONS_WORDS.cancelled(invitation.address))) return;
    untick(invitation.invitationId);
    list.heading.current?.focus();
    cancel.mutate(
      { invitationId: invitation.invitationId },
      settled(
        () => undefined,
        (failure) => {
          list.say(outcomeOfInvitationFailure(failure, "action"));
        },
      ),
    );
  };

  const refusedBefore = (): Outcome | undefined => {
    if (acting) return STILL_GOING;
    if (list.ticked.size === 0) return NOTHING_TICKED;
    return list.ticked.size > MOST_AT_ONCE ? TOO_MANY : undefined;
  };

  const onTheTicked = (pending: (count: number) => string, run: (names: Ticked) => void) => {
    if (!list.readable) return;
    const refused = refusedBefore();
    if (refused !== undefined) {
      list.say(refused);
      return;
    }
    const names = list.ticked;
    if (!begun(pending(names.size))) return;
    list.tick(NONE);
    list.heading.current?.focus();
    run(names);
  };

  const resendTicked = () => {
    onTheTicked(INVITATIONS_WORDS.bulk.resending, (names) => {
      bulkResend.mutate(
        { invitationIds: [...names.keys()] },
        settled<BulkResent>(
          ({ invitations }) => {
            list.say(bulkResentOutcome(invitations));
            list.unsent(invitations.filter((invitation) => !invitation.emailSent));
          },
          (failure) => {
            list.tick(names);
            list.say(refusalOf(failure, names));
          },
        ),
      );
    });
  };

  const cancelTicked = () => {
    onTheTicked(INVITATIONS_WORDS.bulk.cancelling, (names) => {
      bulkCancel.mutate(
        { invitationIds: [...names.keys()] },
        settled<BulkCancelled>(
          ({ changed, skipped }) => {
            list.say({
              tone: "said",
              words: INVITATIONS_WORDS.bulk.cancelled(changed.length, skipped),
            });
          },
          (failure) => {
            list.tick(names);
            list.say(refusalOf(failure, names));
          },
        ),
      );
    });
  };

  useKeystroke(KEY.resendSelected, resendTicked);
  useKeystroke(KEY.cancelSelected, cancelTicked);

  return { acting, resendOne, cancelOne, resendTicked, cancelTicked };
};

type Actions = ReturnType<typeof useInvitationActions>;

export function InvitationBulkActions(properties: { readonly actions: Actions }) {
  const { actions } = properties;
  return (
    <>
      <SelectionAction
        aria-keyshortcuts={shortcutOf(KEY.resendSelected)}
        aria-disabled={actions.acting}
        className="aria-disabled:opacity-50"
        onClick={actions.resendTicked}
      >
        {INVITATIONS_WORDS.resend}
      </SelectionAction>
      <SelectionAction
        aria-keyshortcuts={shortcutOf(KEY.cancelSelected)}
        aria-disabled={actions.acting}
        className="aria-disabled:opacity-50"
        onClick={actions.cancelTicked}
      >
        {INVITATIONS_WORDS.cancel}
      </SelectionAction>
    </>
  );
}
