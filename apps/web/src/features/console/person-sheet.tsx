import { useId, useRef, useState, type RefObject } from "react";

import { RefusalLine } from "@/shared/refusal-outcome.tsx";
import { RowSheet } from "@/shared/row-sheet.tsx";
import { SheetPart } from "@/shared/sheet-part.tsx";
import { SummaryRow } from "@/shared/summary-row.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/shared/ui/collapsible.tsx";
import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";
import { SheetDescription, SheetHeader, SheetTitle } from "@/shared/ui/sheet.tsx";
import { counted } from "@/shared/words.ts";

import { CorrectDisplayName } from "./correct-display-name.tsx";
import { Facts } from "./facts.tsx";
import type { FreshAct } from "./people-address.ts";
import { useInspected, type HeldGrant, type HeldSession, type ListedPerson } from "./people-api.ts";
import { At, grantStateOf, Instant, Memberships, nameOf } from "./person-words.tsx";
import { RevokeEverywhere } from "./revoke-everywhere.tsx";
import { readRefused } from "./words.ts";

/** Where focus lands when the sheet opens: on the person, or straight on one of their acts. */
export type OpenedAt = "person" | FreshAct;

export const personButtonId = (personId: string): string => `person-${personId}`;

function Sessions(properties: { readonly sessions: readonly HeldSession[] }) {
  const { sessions } = properties;
  return (
    <SheetPart title="Sessions">
      <p>
        {sessions.length === 0
          ? "No session is open."
          : `${counted(sessions.length, "session", "sessions")} open. Revoking credentials ends every one at once.`}
      </p>
      {sessions.length === 0 ? null : (
        <ul className="grid gap-3">
          {sessions.map((session) => (
            <li key={`${session.createdAt} ${session.expiresAt}`}>
              <Facts>
                <SummaryRow term="Began">
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

function Grant(properties: { readonly grant: HeldGrant; readonly nowMs: number }) {
  const { grant } = properties;
  const headingId = useId();
  const client = grant.client.name ?? grant.client.id;

  return (
    <li aria-labelledby={headingId}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h4 id={headingId} className="font-medium wrap-anywhere">
          {client}
        </h4>
        <Pill>{grantStateOf(grant, properties.nowMs)}</Pill>
      </div>
      <Facts>
        <SummaryRow term="Workspace">{grant.workspace?.name ?? "None"}</SummaryRow>
        <SummaryRow term="Issued">
          <At iso={grant.issuedAt} />
        </SummaryRow>
        <SummaryRow term="Last used">
          <At iso={grant.lastUsedAt} />
        </SummaryRow>
        {grant.revokedAt === null ? null : (
          <SummaryRow term="Revoked">
            <At iso={grant.revokedAt} />
          </SummaryRow>
        )}
      </Facts>
      <Collapsible className="mt-1">
        <CollapsibleTrigger asChild>
          <Button variant="link" size="sm" className="h-auto px-0 text-left whitespace-normal">
            More about {client}'s grant
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <Facts>
            <SummaryRow term="Client id">
              <code className="font-mono break-all">{grant.client.id}</code>
            </SummaryRow>
            <SummaryRow term="Expires">
              <At iso={grant.expiresAt} />
            </SummaryRow>
          </Facts>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

function Grants(properties: { readonly grants: readonly HeldGrant[]; readonly name: string }) {
  const { grants } = properties;
  const [openedAtMs] = useState(Date.now);
  return (
    <SheetPart title="Client grants">
      {grants.length === 0 ? (
        <p>No client has been connected as {properties.name}.</p>
      ) : (
        <ul className="grid gap-4">
          {grants.map((grant) => (
            <Grant key={`${grant.client.id} ${grant.issuedAt}`} grant={grant} nowMs={openedAtMs} />
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
        <Grants grants={inspected.data.grants} name={nameOf(properties.person)} />
      </>
    );
  }
  return (
    <SheetPart title="Sessions and client grants">
      <p>
        {inspected.error === null ? (
          "Reading the sessions and client grants."
        ) : (
          <RefusalLine {...readRefused(inspected.error)} />
        )}
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
            {nameOf(person)}
          </h2>
        </SheetTitle>
        <SheetDescription className="wrap-anywhere">{person.email}</SheetDescription>
      </SheetHeader>
      <div className="grid gap-4 px-4 pb-4">
        <SheetPart title="Workspaces">
          <Memberships person={person} />
        </SheetPart>
        <SheetPart title="Sign-in">
          <Facts>
            <SummaryRow term="Last sign-in">
              <Instant at={person.lastSignedInAt} none="None on record" />
            </SummaryRow>
            <SummaryRow term="Credentials revoked">
              <Instant at={person.credentialsRevokedAt} none="Never" />
            </SummaryRow>
          </Facts>
        </SheetPart>
        <HeldCredentials person={person} />
        <CorrectDisplayName person={person} actRef={correctRef} />
        <RevokeEverywhere person={person} actRef={revokeRef} />
      </div>
    </RowSheet>
  );
}
