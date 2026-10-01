import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useEffectEvent, useRef, useState, type RefObject } from "react";

import { useMembers } from "@/features/people/people-api.ts";
import { asking, type Here } from "@/shared/address-ask.ts";
import { Icon, type IconName } from "@/shared/icon.tsx";
import type { Keystroke } from "@/shared/keystrokes.tsx";
import {
  CONTROL_CENTRE,
  groupIn,
  placeAt,
  screenNamed,
  screensOf,
  type Group,
  type Screen,
  type VisibleSurface,
  type VisibleTree,
} from "@/shared/navigation.ts";
import { Button } from "@/shared/ui/button.tsx";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/shared/ui/command.tsx";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/shared/ui/dialog.tsx";
import { nameOrAddress } from "@/shared/words.ts";

import { findWhat, JUMP_TO, nothingMatches } from "./words.ts";

const MEMBERS = screenNamed(groupIn(CONTROL_CENTRE, "people"), "Members");

/** Where focus goes once chosen: a place hands it to the screen, an act to its own dialog. */
type Kind = "place" | "member" | "act";

type Jump = {
  /** Unique across the list, so two namesakes are never one selection. */
  readonly value: string;
  readonly name: string;
  /** Where it sits, or whose address it is. */
  readonly said: string | undefined;
  readonly icon: IconName;
  readonly to: string;
  readonly kind: Kind;
  /** Lower-cased, and only words the reader sees: never an id or a path. */
  readonly words: string;
};

export type JumpGroup = { readonly heading: string; readonly jumps: readonly Jump[] };

type Member = {
  readonly personId: string;
  readonly displayName: string;
  readonly address: string;
};

type Placed = { readonly surface: VisibleSurface; readonly group: Group; readonly screen: Screen };

const jumpOf = (jump: Omit<Jump, "words">, ...also: readonly string[]): Jump => ({
  ...jump,
  words: [jump.name, jump.said ?? "", ...also].join(" ").toLowerCase(),
});

const surfaceJump = (surface: VisibleSurface): Jump =>
  jumpOf({
    value: `surface ${surface.id}`,
    name: surface.name,
    said: undefined,
    icon: surface.icon,
    to: surface.opensAt.path,
    kind: "place",
  });

/** A surface standing in for its own unbuilt home is listed once, as the surface. */
const placedIn = (surface: VisibleSurface): readonly Placed[] =>
  surface.groups.flatMap((group) =>
    group.screens
      .filter((screen) => screen !== surface.opensAt || screen.name !== surface.name)
      .map((screen) => ({ surface, group, screen })),
  );

const screenJump = ({ surface, group, screen }: Placed): Jump =>
  jumpOf(
    {
      value: `screen ${screen.path}`,
      name: screen.name,
      said: group.name ?? surface.name,
      icon: screen.icon,
      to: screen.path,
      kind: "place",
    },
    surface.name,
  );

const actJumps = (screen: Screen, here: Here | undefined): readonly Jump[] =>
  (screen.acts ?? []).map((act) =>
    jumpOf({
      value: `act ${screen.path} ${act.asks}`,
      name: act.name,
      said: screen.name,
      icon: act.icon,
      to: asking(screen.path, "act", act.asks, here),
      kind: "act",
    }),
  );

/** Found on Members by their address, which the list's own search box takes. */
const memberJump = (member: Member, here: Here | undefined): Jump =>
  jumpOf({
    value: `member ${member.personId}`,
    name: nameOrAddress(member.displayName, member.address),
    said: member.displayName === "" ? undefined : member.address,
    icon: "person",
    to: asking(MEMBERS.path, "search", member.address, here),
    kind: "member",
  });

/** Only what the visible tree holds, so an unbuilt or hidden screen and its acts never show. */
export const jumpsIn = (
  tree: VisibleTree,
  members: readonly Member[] | undefined,
  here?: Here,
): readonly JumpGroup[] => {
  const groups: readonly JumpGroup[] = [
    { heading: JUMP_TO.groups.surfaces, jumps: tree.surfaces.map(surfaceJump) },
    { heading: JUMP_TO.groups.screens, jumps: tree.surfaces.flatMap(placedIn).map(screenJump) },
    {
      heading: JUMP_TO.groups.acts,
      jumps: screensOf(tree.surfaces).flatMap((screen) => actJumps(screen, here)),
    },
    {
      heading: JUMP_TO.groups.members,
      jumps: (members ?? []).map((member) => memberJump(member, here)),
    },
  ];
  return groups.filter((group) => group.jumps.length > 0);
};

/** Every typed word must appear somewhere in what the reader sees of an item. */
export const matching = (groups: readonly JumpGroup[], typed: string): readonly JumpGroup[] => {
  const terms = typed
    .toLowerCase()
    .split(/\s+/u)
    .filter((term) => term !== "");
  return groups
    .map((group) => ({
      ...group,
      jumps: group.jumps.filter((jump) => terms.every((term) => jump.words.includes(term))),
    }))
    .filter((group) => group.jumps.length > 0);
};

/** `unasked` for a reader who may not see People, whose dialog reads no members. */
type MembersRead = "unasked" | "pending" | "failed" | "read";

type Lines = { readonly said: string | undefined; readonly refused: string | undefined };

/** Nothing matches only once nothing is still loading that might. */
export const linesOf = (read: MembersRead, shown: number, typed: string): Lines => {
  const words = typed.trim();
  const nothing = shown === 0 && words !== "" ? nothingMatches(words) : undefined;
  return {
    said: read === "pending" ? JUMP_TO.membersLoading : nothing,
    refused: read === "failed" ? JUMP_TO.membersUnread : undefined,
  };
};

const isTheChord = (event: KeyboardEvent): boolean =>
  (event.metaKey || event.ctrlKey) &&
  !event.altKey &&
  !event.shiftKey &&
  !event.isComposing &&
  event.key.toLowerCase() === "k";

type Jumping = {
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
  readonly triggerRef: RefObject<HTMLButtonElement | null>;
};

/** The frame's, so an open dialog survives the band redrawing at the breakpoint. */
export const useJumping = (offered: boolean): Jumping => {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const pressed = useEffectEvent((event: KeyboardEvent) => {
    if (!offered || !isTheChord(event)) return;
    // Both chords open the browser's own search bar unless refused here, a held key's repeats too.
    event.preventDefault();
    if (!event.repeat) setOpen((was) => !was);
  });

  // The document, so the chord works from inside a field as well as anywhere else.
  useEffect(() => {
    document.addEventListener("keydown", pressed);
    return () => {
      document.removeEventListener("keydown", pressed);
    };
  }, []);

  return { open, setOpen, triggerRef };
};

const ON_APPLE = typeof navigator !== "undefined" && /Mac|iPhone|iPad/u.test(navigator.platform);

/** As the reader's own keyboard labels it; either chord works on any. */
const CHORD = ON_APPLE ? "⌘K" : "Ctrl K";

/** For the shell's list of keystrokes, which names it on every screen. */
export const JUMP_TO_KEYSTROKE: Keystroke = { key: CHORD, act: JUMP_TO.name };

function Trigger(properties: {
  readonly wide: boolean;
  readonly open: boolean;
  readonly triggerRef: RefObject<HTMLButtonElement | null>;
  readonly onOpen: () => void;
}) {
  const { wide, open, triggerRef, onOpen } = properties;

  return (
    <Button
      ref={triggerRef}
      type="button"
      variant={wide ? "outline" : "ghost"}
      size={wide ? "sm" : "icon"}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-keyshortcuts="Meta+K Control+K"
      className={wide ? "w-44 justify-start font-normal text-muted-foreground" : "shrink-0"}
      onClick={onOpen}
    >
      <Icon name="search" />
      {wide ? (
        <>
          {JUMP_TO.name}
          <kbd aria-hidden className="ml-auto font-mono text-xs">
            {CHORD}
          </kbd>
        </>
      ) : (
        <span className="sr-only">{JUMP_TO.name}</span>
      )}
    </Button>
  );
}

function JumpItem(properties: { readonly jump: Jump; readonly onChoose: (jump: Jump) => void }) {
  const { jump } = properties;

  return (
    <CommandItem
      value={jump.value}
      onSelect={() => {
        properties.onChoose(jump);
      }}
    >
      <Icon name={jump.icon} />
      <span className="min-w-0 truncate">{jump.name}</span>
      {jump.said === undefined ? null : (
        <span className="ml-auto min-w-0 truncate pl-3 text-xs text-muted-foreground">
          {jump.said}
        </span>
      )}
    </CommandItem>
  );
}

type Listed = {
  readonly tree: VisibleTree;
  readonly onChoose: (jump: Jump) => void;
};

/** Its own lines, not the band's: an open dialog hides the band from assistive technology. */
function JumpList(
  properties: Listed & {
    readonly read: MembersRead;
    readonly members: readonly Member[] | undefined;
  },
) {
  const { read } = properties;
  const [typed, setTyped] = useState("");
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const searchStr = useRouterState({ select: (state) => state.location.searchStr });
  const every = jumpsIn(properties.tree, properties.members, { pathname, searchStr });
  const shown = matching(every, typed);
  const lines = linesOf(
    read,
    shown.reduce((count, group) => count + group.jumps.length, 0),
    typed,
  );
  const kinds = [
    JUMP_TO.kinds.screen,
    ...(read === "unasked" ? [] : [JUMP_TO.kinds.member]),
    ...(every.some(({ jumps }) => jumps.some(({ kind }) => kind === "act"))
      ? [JUMP_TO.kinds.act]
      : []),
  ];

  return (
    // The list is filtered here, so "Nothing matches" can wait on a read still loading.
    <Command
      label={JUMP_TO.name}
      shouldFilter={false}
      vimBindings={false}
      loop
      // Room on the right, so the dialog's close button stands clear of the field.
      className="**:data-[slot=command-input-wrapper]:h-12 **:data-[slot=command-input-wrapper]:pr-12 [&_[cmdk-item]]:py-2"
    >
      <CommandInput value={typed} onValueChange={setTyped} placeholder={findWhat(kinds)} />
      <output className="block border-b border-border px-3 py-2 text-sm text-muted-foreground empty:hidden">
        {lines.said}
      </output>
      <p role="alert" className="border-b border-border px-3 py-2 text-sm empty:hidden">
        {lines.refused}
      </p>
      <CommandList label={JUMP_TO.list} className="max-h-[min(24rem,60vh)]">
        {shown.map((group) => (
          <CommandGroup key={group.heading} heading={group.heading}>
            {group.jumps.map((jump) => (
              <JumpItem key={jump.value} jump={jump} onChoose={properties.onChoose} />
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </Command>
  );
}

/** Read as the dialog opens, by the Members list's own query, so a list it read shows at once. */
function WithMembers(properties: Listed) {
  const members = useMembers();
  const read = members.error === null ? "pending" : "failed";

  return (
    <JumpList
      {...properties}
      read={members.data === undefined ? read : "read"}
      members={members.data}
    />
  );
}

/** The frame says whether it is offered, as it does for the chord and the list of keystrokes. */
export function JumpTo(properties: {
  readonly offered: boolean;
  readonly wide: boolean;
  readonly tree: VisibleTree;
  readonly jumping: Jumping;
  /** A member is found on Members' first tab, whichever tab was last open. */
  readonly onFindMember: () => void;
}) {
  const { tree, jumping } = properties;
  const navigate = useNavigate();
  const chosen = useRef<Kind>(undefined);

  if (!properties.offered) return null;

  const choose = (jump: Jump) => {
    chosen.current = jump.kind;
    if (jump.kind === "member") properties.onFindMember();
    jumping.setOpen(false);
    void navigate({ href: jump.to });
  };

  // Fired once the dialog has gone, which is after an act's own dialog has opened.
  const landFocus = (event: Event) => {
    event.preventDefault();
    const kind = chosen.current;
    chosen.current = undefined;
    if (kind === undefined) jumping.triggerRef.current?.focus();
    else if (kind !== "act") document.querySelector("main")?.focus();
  };

  return (
    <>
      <Trigger
        wide={properties.wide}
        open={jumping.open}
        triggerRef={jumping.triggerRef}
        onOpen={() => {
          jumping.setOpen(true);
        }}
      />
      <Dialog open={jumping.open} onOpenChange={jumping.setOpen}>
        <DialogContent
          className="top-[12%] translate-y-0 gap-0 overflow-hidden p-0"
          onCloseAutoFocus={landFocus}
        >
          <DialogTitle className="sr-only">{JUMP_TO.name}</DialogTitle>
          <DialogDescription className="sr-only">{JUMP_TO.said}</DialogDescription>
          {placeAt(tree.surfaces, MEMBERS.path) === undefined ? (
            <JumpList tree={tree} onChoose={choose} read="unasked" members={undefined} />
          ) : (
            <WithMembers tree={tree} onChoose={choose} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
