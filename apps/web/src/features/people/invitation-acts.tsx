import { useState, type RefObject } from "react";

import { ceilingLiftsIn, type ApiError } from "@/shared/api/trpc.ts";
import { useKeystroke } from "@/shared/keystrokes.tsx";
import { selectFirst, type Outcome } from "@/shared/outcome.tsx";
import { setRefusalOutcome } from "@/shared/refusal-outcome.tsx";
import { SelectionAct } from "@/shared/selection-bar.tsx";

import { bulkResentOutcome, INVITATIONS_WORDS, resentOutcome } from "./invitation-words.ts";
import {
  useBulkCancelInvitations,
  useBulkResendInvitations,
  useCancelInvitation,
  useResendInvitation,
  type ListedInvitation,
  type SentInvitation,
} from "./invitations-api.ts";
import { BULK_WORDS } from "./member-act-words.ts";
import { shortcutOf } from "./member-bulk-acts.tsx";
import { PEOPLE_KEYSTROKES as KEY } from "./people-state.ts";
import { SAID_OF_TICKED_INVITATIONS } from "./refusal-words.ts";
import { outcomeOfInvitationFailure, outcomeOfSendingFailure } from "./refusal.tsx";

/** Each ticked invitation by its id, with its address as the tick took it, shown or not. */
export type Ticked = ReadonlyMap<string, string>;

/** What the list hands its acts: the ticks, and where an act's outcome and its unsent emails land. */
type ActedList = {
  /** False while the list's read waits or has failed, when its rows are not there to act on. */
  readonly readable: boolean;
  readonly ticked: Ticked;
  readonly tick: (ticked: Ticked) => void;
  readonly heading: RefObject<HTMLElement | null>;
  readonly say: (outcome: Outcome | undefined) => void;
  readonly unsent: (unsent: readonly SentInvitation[]) => void;
};

type Failure = Error | ApiError;

const NOTHING_TICKED = selectFirst("invitation");

const STILL_GOING: Outcome = { tone: "said", words: BULK_WORDS.stillGoing };

/** Matches the api's cap for one act, which refuses any more as input it cannot read. */
const MOST_TICKED = 50;

const TOO_MANY: Outcome = { tone: "said", words: INVITATIONS_WORDS.bulk.tooMany(MOST_TICKED) };

const NONE: Ticked = new Map();

/** A ceiling carries no items, so it is said first; names are those the ticks took. */
const refusalOf = (failure: Failure, names: Ticked): Outcome =>
  ceilingLiftsIn(failure) === undefined
    ? setRefusalOutcome({
        featureWords: SAID_OF_TICKED_INVITATIONS,
        failure,
        nameOf: (invitationId) => names.get(invitationId) ?? INVITATIONS_WORDS.noLongerListed,
        lead: INVITATIONS_WORDS.bulk.refused,
      })
    : outcomeOfSendingFailure(failure);

export const useInvitationActs = (list: ActedList) => {
  // One act at a time: a second call on a mutation takes over the first's callbacks.
  const [acting, setActing] = useState(false);
  const resend = useResendInvitation();
  const cancel = useCancelInvitation();
  const bulkResend = useBulkResendInvitations();
  const bulkCancel = useBulkCancelInvitations();

  /** Said at the press, so the act reads as taken within a tenth of a second. */
  const begun = (pending: string): boolean => {
    if (acting) {
      list.say(STILL_GOING);
      return false;
    }
    setActing(true);
    list.unsent([]);
    list.say({ tone: "said", words: pending });
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

  const untick = (invitationId: string) => {
    if (!list.ticked.has(invitationId)) return;
    const kept = new Map(list.ticked);
    kept.delete(invitationId);
    list.tick(kept);
  };

  /** An expired row leaves the list as it is resent, so focus goes to the list it left. */
  const resendOne = (invitation: ListedInvitation) => {
    if (!begun(INVITATIONS_WORDS.resending(invitation.address))) return;
    if (invitation.status === "expired") {
      untick(invitation.invitationId);
      list.heading.current?.focus();
    }
    resend.mutate(
      { invitationId: invitation.invitationId },
      settled<SentInvitation>(
        (sent) => {
          list.say(resentOutcome(sent));
        },
        (failure) => {
          list.say(outcomeOfSendingFailure(failure));
        },
      ),
    );
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
          list.say(outcomeOfInvitationFailure(failure));
        },
      ),
    );
  };

  const refusedBefore = (): Outcome | undefined => {
    if (acting) return STILL_GOING;
    if (list.ticked.size === 0) return NOTHING_TICKED;
    return list.ticked.size > MOST_TICKED ? TOO_MANY : undefined;
  };

  /** The ticks are spent at the press, and come back if the set is refused. */
  const onTheTicked = (pending: (count: number) => string, run: (names: Ticked) => void) => {
    // The failed or waiting read already says why there is no list to act on.
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
        settled<{ readonly invitations: readonly SentInvitation[] }>(
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
        settled<{ readonly changed: readonly string[]; readonly skipped: number }>(
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

type Acts = ReturnType<typeof useInvitationActs>;

/** Shifted, so an act on the selection never shares a key with the act on the row in focus. */
export function InvitationBulkActs(properties: { readonly acts: Acts }) {
  const { acts } = properties;
  return (
    <>
      <SelectionAct
        aria-keyshortcuts={shortcutOf(KEY.resendSelected)}
        aria-disabled={acts.acting}
        className="aria-disabled:opacity-50"
        onClick={acts.resendTicked}
      >
        {INVITATIONS_WORDS.resend}
      </SelectionAct>
      <SelectionAct
        aria-keyshortcuts={shortcutOf(KEY.cancelSelected)}
        aria-disabled={acts.acting}
        className="aria-disabled:opacity-50"
        onClick={acts.cancelTicked}
      >
        {INVITATIONS_WORDS.cancel}
      </SelectionAct>
    </>
  );
}
