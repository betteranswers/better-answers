import { useId, useState } from "react";

import { ActionDialog } from "@/shared/action-dialog.tsx";
import { refusalOf } from "@/shared/api/trpc.ts";
import { STOCK } from "@/shared/refusal-words.ts";
import { Button } from "@/shared/ui/button.tsx";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/shared/ui/item.tsx";
import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";

import { ActionButton, useLanding, type LandsAt } from "./account-sections.tsx";
import { Outcome } from "./auth-page.tsx";
import {
  useSessions,
  useSignOutOtherSessions,
  useSignOutSession,
  type SessionShown,
  type SessionsRead,
} from "./sessions-hooks.ts";
import {
  everywhereCommit,
  everywhereTitle,
  lastActiveAt,
  SESSIONS_HEADING_WORD,
  SESSIONS_WORDS,
  signOutNamed,
  signedOut,
  signedOutOthers,
  saidOfASignOutRefusal,
} from "./sessions-words.ts";

const SESSIONS_HEADING = "sessions-heading";

/** The sessions the read holds, without the ones a sign-out has already taken away. */
const heldAfter = (read: SessionsRead, taken: ReadonlySet<string>): readonly SessionShown[] =>
  (read.data ?? []).filter((session) => !taken.has(session.id));

/** The row's own name, so a session never reads the same as another list's row. */
const named = (device: string): string => `A session on ${device}`;

function CurrentSession(properties: { readonly session: SessionShown }) {
  return (
    <Item asChild variant="outline" size="sm">
      <li aria-label={named(properties.session.device)}>
        <ItemContent>
          <ItemTitle>{properties.session.device}</ItemTitle>
          <ItemDescription className="tabular-nums">{SESSIONS_WORDS.activeNow}</ItemDescription>
        </ItemContent>
        <Pill>{SESSIONS_WORDS.thisDevice}</Pill>
      </li>
    </Item>
  );
}

function AnotherSession(properties: {
  readonly session: SessionShown;
  readonly landsAt: LandsAt;
  /** A sign-out in flight: a second one sent now would drop the first's answer. */
  readonly pending: boolean;
  readonly onSignOut: (session: SessionShown) => void;
}) {
  const { session } = properties;
  return (
    <Item asChild variant="outline" size="sm">
      <li aria-label={named(session.device)}>
        <ItemContent>
          <ItemTitle>{session.device}</ItemTitle>
          <ItemDescription className="tabular-nums">
            {lastActiveAt(session.lastActiveAt)}
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          <ActionButton
            actionRef={properties.landsAt(`session:${session.id}`)}
            unavailable={properties.pending}
            label={signOutNamed(session.device)}
            onAction={() => {
              properties.onSignOut(session);
            }}
          />
        </ItemActions>
      </li>
    </Item>
  );
}

/** The Sessions section of the Account page: the person's own, and no one else's. */
export function SessionsSection() {
  const read = useSessions();
  const signOut = useSignOutSession();
  const signOutOthers = useSignOutOtherSessions();
  const landing = useLanding(undefined);
  const [taken, setTaken] = useState<ReadonlySet<string>>(new Set());
  const [said, setSaid] = useState<string | undefined>(undefined);
  const [refused, setRefused] = useState<string | undefined>(undefined);
  const [confirming, setConfirming] = useState(false);
  const onlyId = useId();

  const sessions = heldAfter(read, taken);
  const others = sessions.filter((session) => !session.current);
  const pending = signOut.isPending || signOutOthers.isPending;

  const take = (ids: readonly string[]) => {
    setTaken((held) => new Set([...held, ...ids]));
  };

  const bringBack = (ids: readonly string[]) => {
    setTaken((held) => {
      const next = new Set(held);
      for (const id of ids) next.delete(id);
      return next;
    });
  };

  /** The row leaves at once; on success focus reaches the next Sign out, or the heading. */
  const signOutOne = (session: SessionShown) => {
    setSaid(undefined);
    setRefused(undefined);
    take([session.id]);
    signOut.mutate(
      { sessionId: session.id },
      {
        onSuccess: () => {
          const next = sessions.find((row) => row.id !== session.id && !row.current);
          landing.expect(next === undefined ? "sessions" : `session:${next.id}`);
          setSaid(signedOut(session.device));
        },
        onError: (failure) => {
          bringBack([session.id]);
          landing.expect(`session:${session.id}`);
          const refusal = refusalOf(failure);
          setRefused(refusal === undefined ? STOCK.tryAgain : saidOfASignOutRefusal(refusal));
        },
      },
    );
  };

  const signOutEverywhereElse = () => {
    const ending = others.map((session) => session.id);
    setConfirming(false);
    setSaid(undefined);
    setRefused(undefined);
    take(ending);
    signOutOthers.mutate(undefined, {
      onSuccess: ({ ended }) => {
        landing.expect("sessions");
        setSaid(signedOutOthers(ended));
      },
      onError: (failure) => {
        bringBack(ending);
        landing.expect("sessions");
        const refusal = refusalOf(failure);
        setRefused(refusal === undefined ? STOCK.tryAgain : saidOfASignOutRefusal(refusal));
      },
    });
  };

  if (read.data === undefined) {
    return (
      <section aria-labelledby={SESSIONS_HEADING} className="mt-8">
        <h2 id={SESSIONS_HEADING}>{SESSIONS_HEADING_WORD}</h2>
        {read.error === null ? null : <Outcome tone="refused">{STOCK.notLoaded}</Outcome>}
      </section>
    );
  }

  return (
    <section aria-labelledby={SESSIONS_HEADING} className="mt-8">
      <h2 id={SESSIONS_HEADING} ref={landing.at("sessions")} tabIndex={-1}>
        {SESSIONS_HEADING_WORD}
      </h2>
      <ul className="mt-3 flex flex-col gap-2">
        {sessions.map((session) =>
          session.current ? (
            <CurrentSession key={session.id} session={session} />
          ) : (
            <AnotherSession
              key={session.id}
              session={session}
              landsAt={landing.at}
              pending={pending}
              onSignOut={signOutOne}
            />
          ),
        )}
      </ul>
      {others.length === 0 ? null : (
        <div className="mt-3">
          <ActionButton
            unavailable={pending}
            label={SESSIONS_WORDS.signOutEverywhereElse}
            onAction={() => {
              setConfirming(true);
            }}
          />
        </div>
      )}
      <p id={onlyId} className="mt-2 text-muted-foreground">
        {others.length === 0 ? SESSIONS_WORDS.onlySession : null}
      </p>
      <ActionDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={everywhereTitle(others.length)}
        consequence={SESSIONS_WORDS.consequence}
        commit={
          <Button variant="destructive" onClick={signOutEverywhereElse}>
            {everywhereCommit(others.length)}
          </Button>
        }
      />
      <p className="mt-4 text-muted-foreground">{SESSIONS_WORDS.standingLine}</p>
      <Outcome tone="said">{said}</Outcome>
      <Outcome tone="refused">{refused}</Outcome>
    </section>
  );
}
