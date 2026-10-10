import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";

import { refusalOf, type ApiError } from "@/shared/api/trpc.ts";
import type { Keystroke } from "@/shared/keystrokes.tsx";
import { RefusalLine } from "@/shared/refusal-outcome.tsx";
import { SAID_OF_CLASS, saidOfRefusal, type Said } from "@/shared/refusal-words.ts";
import { Button } from "@/shared/ui/button.tsx";
import { Input } from "@/shared/ui/input.tsx";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/shared/ui/item.tsx";
import { Label } from "@/shared/ui/label.tsx";

import { ActionButton, RemoveKeepingTheLast, type LandsAt } from "./account-sections.tsx";
import {
  ACCOUNT_ACTIONS,
  PASSKEY_WORDS,
  passkeyDates,
  removePasskeyTitle,
} from "./account-words.ts";
import { CodeRefused, SIGNED_OUT, TOO_MANY_REQUESTS } from "./auth-hooks.ts";
import { Outcome } from "./auth-page.tsx";
import {
  DeviceRefused,
  isCancelled,
  useAddPasskey,
  useRenamePasskey,
  type PasskeyAdded,
} from "./passkey-hooks.ts";
import {
  PASSKEY_ADD_UNANSWERED,
  PASSKEY_ASK_EXPIRED,
  PASSKEY_HELD,
  PASSKEY_NOT_ADDED,
  PASSKEY_NOT_VERIFIED,
  RENAME_UNANSWERED,
  RESTORE_CODE_NEEDED,
  SAID_OF_SECOND_FACTOR,
  SETUP_NOT_GRANTED,
  tooManyPasskeysAdded,
} from "./refusal-words.ts";
import type { SecondFactor } from "./second-factor-hooks.ts";

export const ADD_A_PASSKEY: Keystroke = { key: "a", action: ACCOUNT_ACTIONS.addPasskey };

const PASSKEYS_HEADING = "passkeys-heading";

/** The offer banner's link lands on this button. */
export const ADD_A_PASSKEY_BUTTON = "add-a-passkey";

export type Passkey = SecondFactor["passkeys"][number];

const nameOf = (passkey: Passkey): string => passkey.name ?? PASSKEY_WORDS.unnamed;

const SAID_OF_THE_DEVICE = {
  cancelled: undefined,
  held: PASSKEY_HELD,
  unverified: PASSKEY_NOT_VERIFIED,
  failed: PASSKEY_NOT_ADDED,
} satisfies Record<DeviceRefused["reason"], Said | undefined>;

const SAID_OF_THE_ROUTE: ReadonlyMap<string, Said> = new Map([
  ["not-verified", PASSKEY_NOT_VERIFIED],
  ["challenge-gone", PASSKEY_ASK_EXPIRED],
  ["passkey-refused", PASSKEY_NOT_ADDED],
  ["passkey-name-empty", SAID_OF_SECOND_FACTOR["passkey-name-empty"]],
  ["passkey-name-too-long", SAID_OF_SECOND_FACTOR["passkey-name-too-long"]],
  ["setup-not-granted", SETUP_NOT_GRANTED],
  ["restore-code-needed", RESTORE_CODE_NEEDED],
]);

const saidOfTheRoute = (refused: CodeRefused): Said => {
  if (refused.status === SIGNED_OUT) return SAID_OF_CLASS.unauthenticated;
  if (refused.status === TOO_MANY_REQUESTS) return tooManyPasskeysAdded(refused.waitSeconds);
  return SAID_OF_THE_ROUTE.get(refused.word ?? "") ?? PASSKEY_NOT_ADDED;
};

/** A cancelled prompt is no refusal: the status line says nothing was added. */
const saidOfAdding = (failure: Error | null): Said | undefined => {
  if (failure === null) return undefined;
  if (failure instanceof DeviceRefused) return SAID_OF_THE_DEVICE[failure.reason];
  return failure instanceof CodeRefused ? saidOfTheRoute(failure) : PASSKEY_ADD_UNANSWERED;
};

const saidWhileAdding = (pending: boolean, failure: Error | null): string | null => {
  if (pending) return PASSKEY_WORDS.waiting;
  return isCancelled(failure) ? PASSKEY_WORDS.notAdded : null;
};

const blankName = SAID_OF_SECOND_FACTOR["passkey-name-empty"];

/** Selected as it mounts, so typing replaces the name it was given. */
const selectOnMount = (node: HTMLInputElement | null): void => {
  node?.select();
};

/** For a page where adding a passkey is the first way on. */
const focusOnMount = (node: HTMLInputElement | null): void => {
  node?.focus();
  node?.select();
};

export function AddAPasskey(properties: {
  readonly id: string;
  readonly suggested: string;
  readonly commit?: string;
  readonly focused?: boolean;
  readonly onAdded: (added: PasskeyAdded, name: string) => void;
  readonly onRefused?: (failure: Error) => void;
}) {
  const fieldId = useId();
  const refusedId = useId();
  const adding = useAddPasskey(properties.onAdded);
  const [name, setName] = useState(properties.suggested);
  const [blank, setBlank] = useState(false);
  const pending = adding.isPending || adding.isSuccess;
  const said = blank ? blankName : saidOfAdding(adding.error);

  const add = (event: FormEvent) => {
    event.preventDefault();
    const asked = name.trim();
    setBlank(asked === "");
    if (asked === "" || pending) return;
    adding.mutate(asked, { onError: (failure) => properties.onRefused?.(failure) });
  };

  return (
    <form id={properties.id} onSubmit={add} className="mt-4">
      <Label htmlFor={fieldId}>{PASSKEY_WORDS.nameField}</Label>
      <Input
        id={fieldId}
        ref={properties.focused === true ? focusOnMount : selectOnMount}
        name="passkey-name"
        autoComplete="off"
        required
        readOnly={pending}
        aria-describedby={said === undefined ? undefined : refusedId}
        aria-invalid={blank}
        className="mt-2 max-w-sm"
        value={name}
        onChange={(event) => {
          setName(event.target.value);
        }}
      />
      {/* Enabled while the device asks, so a cancelled prompt hands focus back to the button. */}
      <Button type="submit" className="mt-4 aria-disabled:opacity-50" aria-disabled={pending}>
        {properties.commit ?? PASSKEY_WORDS.addCommit}
      </Button>
      <Outcome tone="said">{saidWhileAdding(pending, adding.error)}</Outcome>
      <Outcome tone="refused" id={refusedId}>
        {said === undefined ? null : <RefusalLine said={said} />}
      </Outcome>
    </form>
  );
}

const saidOfRenaming = (failure: Error | ApiError | null): Said | undefined => {
  if (failure === null) return undefined;
  const refusal = refusalOf(failure);
  return refusal === undefined
    ? RENAME_UNANSWERED
    : saidOfRefusal(SAID_OF_SECOND_FACTOR, refusal.word, refusal.class);
};

/** Enter saves and Escape puts the name back; either way focus returns to Rename. */
function RenameAPasskey(properties: {
  readonly passkey: Passkey;
  readonly onDone: (renamedTo: string | undefined) => void;
}) {
  const { passkey } = properties;
  const refusedId = useId();
  const renaming = useRenamePasskey();
  const [name, setName] = useState(nameOf(passkey));
  const [blank, setBlank] = useState(false);
  const said = blank ? blankName : saidOfRenaming(renaming.error);

  const save = (event: FormEvent) => {
    event.preventDefault();
    const asked = name.trim();
    setBlank(asked === "");
    if (asked === "" || renaming.isPending) return;
    renaming.mutate(
      { passkeyId: passkey.id, name: asked },
      {
        onSuccess: (renamed) => {
          properties.onDone(renamed.name);
        },
      },
    );
  };

  const cancelOnEscape = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    properties.onDone(undefined);
  };

  return (
    <form onSubmit={save} className="flex flex-wrap items-end gap-2">
      <Input
        ref={selectOnMount}
        aria-label={PASSKEY_WORDS.nameField}
        autoComplete="off"
        onKeyDown={cancelOnEscape}
        readOnly={renaming.isPending}
        aria-describedby={said === undefined ? undefined : refusedId}
        aria-invalid={blank}
        className="max-w-sm"
        value={name}
        onChange={(event) => {
          setName(event.target.value);
        }}
      />
      <Button
        type="submit"
        size="sm"
        variant="accent"
        className="aria-disabled:opacity-50"
        aria-disabled={renaming.isPending}
      >
        {renaming.isPending ? PASSKEY_WORDS.saving : PASSKEY_WORDS.save}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => {
          properties.onDone(undefined);
        }}
      >
        {PASSKEY_WORDS.cancel}
      </Button>
      <div className="basis-full">
        <Outcome tone="refused" id={refusedId}>
          {said === undefined ? null : <RefusalLine said={said} />}
        </Outcome>
      </div>
    </form>
  );
}

function PasskeyRow(properties: {
  readonly passkey: Passkey;
  readonly last: boolean;
  readonly removing: boolean;
  readonly landsAt: LandsAt;
  readonly onRenamed: (name: string) => void;
  readonly onRemove: (passkey: Passkey) => void;
}) {
  const { passkey } = properties;
  const backToRename = useRef(false);
  const [renaming, setRenaming] = useState(false);

  /** Rename is drawn again once the field closes, and takes focus as it mounts. */
  const renameMounted = (node: HTMLButtonElement | null) => {
    if (node === null || !backToRename.current) return;
    backToRename.current = false;
    node.focus();
  };

  const renamed = (renamedTo: string | undefined) => {
    backToRename.current = true;
    setRenaming(false);
    if (renamedTo !== undefined) properties.onRenamed(renamedTo);
  };

  return (
    <Item asChild variant="outline" size="sm">
      <li
        tabIndex={-1}
        ref={properties.landsAt(`passkey:${passkey.id}`)}
        aria-label={nameOf(passkey)}
      >
        <ItemContent>
          {renaming ? (
            <RenameAPasskey passkey={passkey} onDone={renamed} />
          ) : (
            <ItemTitle>{nameOf(passkey)}</ItemTitle>
          )}
          <ItemDescription className="tabular-nums">
            {passkeyDates(passkey.createdAt, passkey.lastUsedAt)}
          </ItemDescription>
        </ItemContent>
        <ItemActions className="flex-wrap">
          {renaming ? null : (
            <ActionButton
              actionRef={renameMounted}
              unavailable={false}
              label={PASSKEY_WORDS.rename}
              onAction={() => {
                setRenaming(true);
              }}
            />
          )}
          <RemoveKeepingTheLast
            words={{
              remove: PASSKEY_WORDS.remove,
              title: removePasskeyTitle(nameOf(passkey)),
              consequence: PASSKEY_WORDS.removeConsequence,
              commit: PASSKEY_WORDS.removeCommit,
            }}
            last={properties.last}
            removing={properties.removing}
            reasonClassName="basis-full"
            onRemove={() => {
              properties.onRemove(passkey);
            }}
          />
        </ItemActions>
      </li>
    </Item>
  );
}

/** Whoever must hold a factor keeps their last: a passkey alone, with no authenticator set up. */
const isTheLastFactor = (held: SecondFactor): boolean =>
  held.mustHoldOne && held.authenticator !== "set-up" && held.passkeys.length === 1;

type PasskeysProperties = {
  readonly held: SecondFactor | undefined;
  readonly here: boolean;
  readonly addOpen: boolean;
  readonly suggestedName: string;
  readonly removing: boolean;
  readonly landsAt: LandsAt;
  readonly onAddOpen: () => void;
  readonly onAdded: (added: PasskeyAdded, name: string) => void;
  readonly onRenamed: (name: string) => void;
  readonly onRemove: (passkey: Passkey) => void;
};

function PasskeyRows(properties: PasskeysProperties & { readonly held: SecondFactor }) {
  const { held } = properties;
  if (held.passkeys.length === 0) return <p className="mt-2">{PASSKEY_WORDS.none}</p>;
  return (
    <ul className="mt-3 flex flex-col gap-2">
      {held.passkeys.map((passkey) => (
        <PasskeyRow
          key={passkey.id}
          passkey={passkey}
          last={isTheLastFactor(held)}
          removing={properties.removing}
          landsAt={properties.landsAt}
          onRenamed={properties.onRenamed}
          onRemove={properties.onRemove}
        />
      ))}
    </ul>
  );
}

/** A browser with no WebAuthn adds nothing, but its rows can still be renamed and removed. */
function AddingHere(properties: PasskeysProperties) {
  const formId = useId();
  if (!properties.here) return <p className="mt-3">{PASSKEY_WORDS.noWebAuthn}</p>;
  return (
    <>
      <ActionButton
        id={ADD_A_PASSKEY_BUTTON}
        actionRef={properties.landsAt("add-a-passkey")}
        unavailable={false}
        label={PASSKEY_WORDS.add}
        className="mt-3"
        expanded={properties.addOpen}
        controls={properties.addOpen ? formId : undefined}
        keystroke={ADD_A_PASSKEY}
        onAction={properties.onAddOpen}
      />
      {properties.addOpen ? (
        <AddAPasskey
          id={formId}
          suggested={properties.suggestedName}
          onAdded={properties.onAdded}
        />
      ) : null}
    </>
  );
}

/** The heading stands while the read is out or has failed; the rows come once it is read. */
export function PasskeysSection(properties: PasskeysProperties) {
  const { held } = properties;
  return (
    <section aria-labelledby={PASSKEYS_HEADING} className="mt-6">
      <h3
        id={PASSKEYS_HEADING}
        ref={properties.landsAt("passkeys")}
        tabIndex={-1}
        className="font-medium"
      >
        {PASSKEY_WORDS.heading}
      </h3>
      {held === undefined ? null : (
        <>
          <PasskeyRows {...properties} held={held} />
          <AddingHere {...properties} />
        </>
      )}
    </section>
  );
}
