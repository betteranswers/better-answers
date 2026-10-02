import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ComponentType,
  type MouseEvent,
  type RefObject,
} from "react";

import type { ApiError } from "@/shared/api/trpc.ts";
import { initialsOf } from "@/shared/initials.ts";
import { useKeystroke, useScreenKeystrokes, type Keystroke } from "@/shared/keystrokes.tsx";
import { useLastCrumb } from "@/shared/last-crumb.ts";
import { cn } from "@/shared/lib/utils.ts";
import { ListState } from "@/shared/list-pages.tsx";
import { CONTROL_CENTRE, groupIn } from "@/shared/navigation.ts";
import type { Outcome } from "@/shared/outcome.tsx";
import { Avatar, AvatarFallback } from "@/shared/ui/avatar.tsx";
import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";

import { MEMBER_PAGE_WORDS as WORDS } from "./member-act-words.ts";
import { MemberActivity } from "./member-activity.tsx";
import { Access, RemoveAndRevoke, type Landings, type Removal } from "./member-sections.tsx";
import {
  MEMBERS_SCREEN,
  membersAt,
  OPENING,
  type OpenedAt,
  type Removed,
} from "./members-address.ts";
import { useMembers, useReaderId, useRemoveMember, type ListedMember } from "./people-api.ts";
import { MEMBER_PAGE_KEYSTROKES as KEY } from "./people-state.ts";
import { outcomeOfFailure } from "./refusal.tsx";
import { useSelfActHome } from "./self-act.tsx";
import { nameOf } from "./words.tsx";

const people = groupIn(CONTROL_CENTRE, "people");

const KEYSTROKES: readonly Keystroke[] = Object.values(KEY);

type Drawn = {
  readonly member: ListedMember;
  readonly landings: Landings;
  readonly removal: Removal;
  /** The section's own heading, where focus goes when what the section drew is replaced. */
  readonly heading: RefObject<HTMLHeadingElement | null>;
};

type Section = {
  readonly id: string;
  readonly title: string;
  readonly draw: ComponentType<Drawn>;
  /** Set apart below the rest, since its acts end the person's access. */
  readonly apart?: true;
};

/** One page, each section drawn at once, in order. The security work adds Sign-in and Sessions. */
const SECTIONS: readonly Section[] = [
  { id: "access", title: WORDS.access, draw: Access },
  { id: "activity", title: WORDS.activity, draw: MemberActivity },
  { id: "remove-and-revoke", title: WORDS.removeAndRevoke, draw: RemoveAndRevoke, apart: true },
];

const headingIdOf = (section: Section): string => `member-${section.id}`;

/** What the move that opened the page asked of it, kept in the page's own history entry. */
const useOpening = () => {
  const openedAt = useRouterState({
    select: (state) => OPENING.safeParse(state.location.state).data?.openedAt,
  });
  const membersQuery = useRouterState({
    select: (state) => OPENING.safeParse(state.location.state).data?.membersQuery,
  });
  return { openedAt, membersQuery };
};

/**
 * Someone else's removal returns to Members before the api answers, and Members says how it
 * went. Your own waits: where you land depends on it.
 */
const useRemoval = (
  membersQuery: string | undefined,
  hold: (member: ListedMember | undefined) => void,
): Removal => {
  const removeMember = useRemoveMember();
  const readerId = useReaderId();
  const { goHome } = useSelfActHome();
  const navigate = useNavigate();
  const [outcome, setOutcome] = useState<Outcome>();

  const remove = (member: ListedMember) => {
    if (removeMember.isPending) return;
    const { personId } = member;
    hold(member);
    setOutcome(undefined);
    if (personId !== readerId) {
      removeMember.mutate({ personId });
      const removed: Removed = { personId, name: nameOf(member) };
      // Pushed, so Back finds this page with no one on it rather than skipping it.
      void navigate({ href: membersAt(membersQuery), state: (held) => ({ ...held, removed }) });
      return;
    }
    removeMember.mutate(
      { personId },
      {
        onSuccess: () => {
          void goHome("removed");
        },
        onError: (failure: Error | ApiError) => {
          hold(undefined);
          setOutcome(outcomeOfFailure(failure));
        },
      },
    );
  };

  return { remove, outcome };
};

function NoSuchMember() {
  return (
    <ListState
      state={{
        kind: "empty",
        words: WORDS.noSuchMember,
        act: (
          <Link to={MEMBERS_SCREEN.path} className="text-brand underline">
            {WORDS.toMembers}
          </Link>
        ),
      }}
    />
  );
}

function MemberHeader(properties: {
  readonly member: ListedMember;
  readonly titleRef: RefObject<HTMLHeadingElement | null>;
}) {
  const { member, titleRef } = properties;

  return (
    <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2">
      <Avatar aria-hidden className="size-10">
        <AvatarFallback>{initialsOf(nameOf(member))}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <h2 ref={titleRef} tabIndex={-1} className="wrap-anywhere">
          {nameOf(member)}
        </h2>
        <p className="text-sm text-muted-foreground wrap-anywhere">{member.address}</p>
      </div>
      <Pill>{member.role}</Pill>
    </div>
  );
}

/** Its links move focus within the page and leave the address alone: a section has none. */
function SectionNav() {
  const toSection = (event: MouseEvent<HTMLAnchorElement>, section: Section) => {
    event.preventDefault();
    document.getElementById(headingIdOf(section))?.focus();
  };

  return (
    <nav aria-label={WORDS.sections} className="mt-4 border-y border-border py-2">
      <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {SECTIONS.map((section) => (
          <li key={section.id}>
            <a
              href={`#${headingIdOf(section)}`}
              className="text-brand underline-offset-4 hover:underline"
              onClick={(event) => {
                toSection(event, section);
              }}
            >
              {section.title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Each act's control, and focus put on it: by a keystroke, or as the page opens at the act. */
const useLandings = () => {
  const title = useRef<HTMLHeadingElement>(null);
  const landings: Landings = {
    role: useRef<HTMLDivElement>(null),
    groups: useRef<HTMLDivElement>(null),
    flag: useRef<HTMLButtonElement>(null),
    credentials: useRef<HTMLButtonElement>(null),
    removal: useRef<HTMLButtonElement>(null),
  };

  const controlAt = {
    member: () => title.current,
    role: () => landings.role.current?.querySelector<HTMLElement>('[aria-checked="true"]'),
    // A workspace with no groups offers its link to the Groups screen in their place.
    groups: () => landings.groups.current?.querySelector<HTMLElement>('[role="checkbox"], a'),
    // A member with no display name has no flag to land on, so focus goes to who they are.
    flag: () => landings.flag.current ?? title.current,
    credentials: () => landings.credentials.current,
    removal: () => landings.removal.current,
  } satisfies Readonly<Record<OpenedAt, () => HTMLElement | null | undefined>>;

  const landOn = (at: OpenedAt) => {
    (controlAt[at]() ?? title.current)?.focus();
  };

  return { title, landings, landOn };
};

function SectionShown(properties: {
  readonly section: Section;
  readonly drawn: Omit<Drawn, "heading">;
}) {
  const { section, drawn } = properties;
  const heading = useRef<HTMLHeadingElement>(null);
  const Draw = section.draw;

  return (
    <section
      aria-labelledby={headingIdOf(section)}
      className={cn("grid gap-4", section.apart && "mt-4 border-t border-border pt-8")}
    >
      <h2 ref={heading} id={headingIdOf(section)} tabIndex={-1}>
        {section.title}
      </h2>
      <Draw {...drawn} heading={heading} />
    </section>
  );
}

function MemberShown(properties: {
  readonly member: ListedMember;
  readonly openedAt: OpenedAt | undefined;
  readonly removal: Removal;
}) {
  const { member, openedAt, removal } = properties;
  const { title, landings, landOn } = useLandings();
  useLastCrumb(nameOf(member));

  useScreenKeystrokes(KEYSTROKES);
  useKeystroke(KEY.changeRole, () => {
    landOn("role");
  });
  useKeystroke(KEY.changeGroups, () => {
    landOn("groups");
  });
  useKeystroke(KEY.flagName, () => {
    landOn("flag");
  });
  useKeystroke(KEY.revokeCredentials, () => {
    landOn("credentials");
  });
  useKeystroke(KEY.remove, () => {
    landOn("removal");
  });

  // The page is opened at an act by a move from Members, which hands focus on to its control.
  const arrive = useEffectEvent((at: OpenedAt) => {
    landOn(at);
  });
  useEffect(() => {
    if (openedAt !== undefined) arrive(openedAt);
  }, [openedAt]);

  return (
    <>
      <MemberHeader member={member} titleRef={title} />
      <SectionNav />
      <div className="mt-6 grid gap-6">
        {SECTIONS.map((section) => (
          <SectionShown key={section.id} section={section} drawn={{ member, landings, removal }} />
        ))}
      </div>
    </>
  );
}

/** Drawn from the members list already held. A failed read stands in for even a stale page. */
function MemberRead(properties: {
  readonly personId: string;
  readonly heading: RefObject<HTMLHeadingElement | null>;
}) {
  const members = useMembers();
  const { openedAt, membersQuery } = useOpening();
  // Held while it goes, so the list taking the removal first draws no "no such member" meanwhile.
  const [leaving, setLeaving] = useState<ListedMember>();
  const removal = useRemoval(membersQuery, setLeaving);

  if (members.error !== null) {
    return (
      <ListState
        state={{
          kind: "failed",
          words: outcomeOfFailure(members.error, "read").words,
          onRetry: () => {
            void members.refetch();
          },
          focusAfterRetry: properties.heading,
        }}
      />
    );
  }
  if (members.data === undefined) {
    return <ListState state={{ kind: "loading", words: WORDS.loading }} />;
  }
  const member =
    members.data.find((each) => each.personId === properties.personId) ??
    (leaving?.personId === properties.personId ? leaving : undefined);
  if (member === undefined) return <NoSuchMember />;
  return <MemberShown member={member} openedAt={openedAt} removal={removal} />;
}

/** `personId` is undefined where the address holds no person's id, so nothing is asked about it. */
export function MemberPage(properties: { readonly personId: string | undefined }) {
  const { personId } = properties;
  const heading = useRef<HTMLHeadingElement>(null);

  return (
    <>
      <h1 ref={heading} tabIndex={-1}>
        {people.name}
      </h1>
      {personId === undefined ? (
        <NoSuchMember />
      ) : (
        <MemberRead key={personId} personId={personId} heading={heading} />
      )}
    </>
  );
}
