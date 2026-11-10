import { useId, useRef, useState, type ReactNode, type RefObject } from "react";

import { RowSheet } from "@/shared/list/row-sheet.tsx";
import { SummaryRow } from "@/shared/list/summary-row.tsx";
import { Address } from "@/shared/member/address.tsx";
import { SheetPart } from "@/shared/page/sheet-part.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/shared/ui/collapsible.tsx";
import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";
import { SheetDescription, SheetHeader, SheetTitle } from "@/shared/ui/sheet.tsx";
import { counted } from "@/shared/words.ts";

import { CorrectDisplayName } from "../correct-display-name.tsx";
import { Facts } from "../facts.tsx";
import { EVERYONE_WORDS } from "../list-words.ts";
import type { FreshAction } from "../people-address.ts";
import {
  useInspected,
  type EndedGrant,
  type HeldGrant,
  type HeldSession,
  type ListedPerson,
} from "../people-api.ts";
import {
  At,
  grantStateOf,
  Instant,
  nameOf,
  PersonName,
  WorkspacesAndRoles,
} from "../person-words.tsx";
import { PERSON_WORDS, readRefused } from "../words.ts";
import { EndEverySignInEverywhere } from "./end-every-sign-in-everywhere.tsx";
import { endedByWords } from "./grant-words.ts";

export type OpenedAt = "person" | FreshAction;

export const personButtonId = (personId: string): string => `person-${personId}`;

function Sessions(properties: { readonly sessions: readonly HeldSession[] }) {
  const { sessions } = properties;
  return (
    <SheetPart title={PERSON_WORDS.sessions}>
      <p>
        {sessions.length === 0
          ? "No open sessions"
          : `${counted(sessions.length, "session", "sessions")} open.`}
      </p>
      {sessions.length === 0 ? null : (
        <ul className="grid gap-3">
          {sessions.map((session) => (
            <li key={`${session.createdAt} ${session.expiresAt}`}>
              <Facts>
                <SummaryRow term="Signed in">
                  <At iso={session.createdAt} />
                </SummaryRow>
                <SummaryRow term="Last used">
                  <At iso={session.lastUsedAt} />
                </SummaryRow>
                <SummaryRow term="Expires">
                  <At iso={session.expiresAt} />
                </SummaryRow>
              </Facts>
            </li>
          ))}
        </ul>
      )}
    </SheetPart>
  );
}

function GrantItem(properties: {
  readonly grant: HeldGrant | EndedGrant;
  readonly state: string;
  readonly facts: ReactNode;
  readonly more?: ReactNode;
}) {
  const { grant } = properties;
  const headingId = useId();
  const assistant = grant.assistant.name ?? grant.assistant.id;

  return (
    <li aria-labelledby={headingId}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h4 id={headingId} className="font-medium wrap-anywhere">
          {assistant}
        </h4>
        <Pill>{properties.state}</Pill>
      </div>
      <Facts>
        <SummaryRow term="Workspace">{grant.workspace?.name ?? "None"}</SummaryRow>
        <SummaryRow term="Issued">
          <At iso={grant.issuedAt} />
        </SummaryRow>
        {properties.facts}
      </Facts>
      <Collapsible className="mt-1">
        <CollapsibleTrigger asChild>
          <Button variant="link" size="sm" className="h-auto px-0 text-left whitespace-normal">
            {PERSON_WORDS.moreAbout(assistant)}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <Facts>
            <SummaryRow term="Client ID">
              <code className="font-mono break-all">{grant.assistant.id}</code>
            </SummaryRow>
            {properties.more}
          </Facts>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

function OpenGrant(properties: { readonly grant: HeldGrant; readonly nowMs: number }) {
  const { grant } = properties;
  return (
    <GrantItem
      grant={grant}
      state={grantStateOf(grant, properties.nowMs)}
      facts={
        <SummaryRow term="Last used">
          <At iso={grant.lastUsedAt} />
        </SummaryRow>
      }
      more={
        <SummaryRow term="Expires">
          <At iso={grant.expiresAt} />
        </SummaryRow>
      }
    />
  );
}

function Ended(properties: { readonly grant: EndedGrant }) {
  const { grant } = properties;
  return (
    <GrantItem
      grant={grant}
      state="Ended"
      facts={
        <>
          <SummaryRow term="Ended">
            <At iso={grant.endedAt} />
          </SummaryRow>
          <SummaryRow term={PERSON_WORDS.endedBy}>{endedByWords(grant.endedBy)}</SummaryRow>
          <SummaryRow term={PERSON_WORDS.endedIn}>
            {grant.scope === "everywhere" ? "Every workspace" : (grant.workspace?.name ?? "None")}
          </SummaryRow>
        </>
      }
    />
  );
}

function Grants(properties: {
  readonly grants: readonly HeldGrant[];
  readonly ended: readonly EndedGrant[];
  readonly name: string;
}) {
  const { grants, ended } = properties;
  const [openedAtMs] = useState(Date.now);
  return (
    <SheetPart title={PERSON_WORDS.assistantAccess}>
      {grants.length === 0 && ended.length === 0 ? (
        <p>{properties.name} hasn’t connected an assistant yet.</p>
      ) : (
        <ul className="grid gap-4">
          {grants.map((grant) => (
            <OpenGrant
              key={`${grant.assistant.id} ${grant.issuedAt}`}
              grant={grant}
              nowMs={openedAtMs}
            />
          ))}
          {ended.map((grant) => (
            <Ended key={`${grant.assistant.id} ${grant.issuedAt} ${grant.endedAt}`} grant={grant} />
          ))}
        </ul>
      )}
    </SheetPart>
  );
}

function HeldCredentials(properties: { readonly person: ListedPerson }) {
  const inspected = useInspected(properties.person.id);
  if (inspected.data !== undefined) {
    return (
      <>
        <Sessions sessions={inspected.data.sessions} />
        <Grants
          grants={inspected.data.grants}
          ended={inspected.data.ended}
          name={nameOf(properties.person)}
        />
      </>
    );
  }
  return (
    <SheetPart title={PERSON_WORDS.sessionsAndAccess}>
      <p>
        {inspected.error === null
          ? "Loading sessions and assistant access…"
          : readRefused(inspected.error)}
      </p>
    </SheetPart>
  );
}

export function PersonSheet(properties: {
  readonly person: ListedPerson;
  readonly openedAt: OpenedAt;
  readonly onClose: () => void;
  readonly returnFocus: () => void;
}) {
  const { person, openedAt } = properties;
  const titleRef = useRef<HTMLHeadingElement>(null);
  const revokeRef = useRef<HTMLButtonElement>(null);
  const correctRef = useRef<HTMLButtonElement>(null);

  const landOn = {
    person: titleRef,
    revoke: revokeRef,
    correct: correctRef,
  } satisfies Readonly<Record<OpenedAt, RefObject<HTMLElement | null>>>;

  return (
    <RowSheet
      rowButtonId={personButtonId(person.id)}
      onOpen={() => {
        landOn[openedAt].current?.focus();
      }}
      onClose={properties.onClose}
      returnFocus={properties.returnFocus}
    >
      <SheetHeader className="border-b border-border">
        <SheetTitle asChild>
          <h2 ref={titleRef} tabIndex={-1} className="pr-8 wrap-anywhere">
            <PersonName person={person} />
          </h2>
        </SheetTitle>
        <SheetDescription>
          <Address address={person.email} />
        </SheetDescription>
      </SheetHeader>
      <div className="grid gap-4 px-4 pb-4">
        <SheetPart title={PERSON_WORDS.workspaces}>
          <WorkspacesAndRoles person={person} />
        </SheetPart>
        <SheetPart title={PERSON_WORDS.signIn}>
          <Facts>
            <SummaryRow term={EVERYONE_WORDS.columns.lastSignIn}>
              <Instant at={person.lastSignedInAt} none={EVERYONE_WORDS.never} />
            </SummaryRow>
            <SummaryRow term={PERSON_WORDS.signedOutEverywhere}>
              <Instant at={person.credentialsRevokedAt} none={EVERYONE_WORDS.never} />
            </SummaryRow>
          </Facts>
        </SheetPart>
        <HeldCredentials person={person} />
        <CorrectDisplayName person={person} actionRef={correctRef} />
        <EndEverySignInEverywhere person={person} actionRef={revokeRef} />
      </div>
    </RowSheet>
  );
}
