import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type ComponentType,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";

import type { ApiError } from "@/shared/api/trpc.ts";
import { useKeystroke, usePageKeystrokes, type Keystroke } from "@/shared/keystrokes.tsx";
import { cn } from "@/shared/lib/utils.ts";
import { ListState } from "@/shared/list/list-pages.tsx";
import { Address } from "@/shared/member/address.tsx";
import { initialsOf } from "@/shared/member/initials.ts";
import type { Outcome } from "@/shared/outcome.tsx";
import { useBreadcrumbLastPart } from "@/shared/page/breadcrumb-last-part.ts";
import { PageHead } from "@/shared/page/page-head.tsx";
import { Avatar, AvatarFallback } from "@/shared/ui/avatar.tsx";

import { MEMBER_PAGE_WORDS as WORDS } from "../member-action-words.ts";
import { useMembers, useReaderId, useRemoveMember, type ListedMember } from "../people-api.ts";
import { MEMBER_PAGE_KEYSTROKES as KEY } from "../people-state.ts";
import { outcomeOfFailure } from "../refusal.tsx";
import { nameOf } from "../words.tsx";
import { MemberActivity } from "./member-activity.tsx";
import { Access, RemoveAndSignOut, type Landings, type Removal } from "./member-sections.tsx";
import {
  MEMBERS_PAGE,
  membersAt,
  OPENING,
  type OpenedAt,
  type Removed,
} from "./members-address.ts";
import { useSelfActionHome } from "./self-action.tsx";

const KEYSTROKES: readonly Keystroke[] = Object.values(KEY);

type Drawn = {
  readonly member: ListedMember;
  readonly landings: Landings;
  readonly removal: Removal;
  readonly heading: RefObject<HTMLHeadingElement | null>;
};

type Section = {
  readonly id: string;
  readonly title: string;
  readonly draw: ComponentType<Drawn>;
  readonly apart?: true;
};

const SECTIONS: readonly Section[] = [
  { id: "access", title: WORDS.access, draw: Access },
  { id: "activity", title: WORDS.activity, draw: MemberActivity },
  {
    id: "remove-and-end-every-sign-in",
    title: WORDS.removeAndSignOut,
    draw: RemoveAndSignOut,
    apart: true,
  },
];

const headingIdOf = (section: Section): string => `member-${section.id}`;

const useOpening = () => {
  const openedAt = useRouterState({
    select: (state) => OPENING.safeParse(state.location.state).data?.openedAt,
  });
  const membersQuery = useRouterState({
    select: (state) => OPENING.safeParse(state.location.state).data?.membersQuery,
  });
  return { openedAt, membersQuery };
};

const useRemoval = (
  membersQuery: string | undefined,
  hold: (member: ListedMember | undefined) => void,
): Removal => {
  const removeMember = useRemoveMember();
  const readerId = useReaderId();
  const { goHome } = useSelfActionHome();
  const navigate = useNavigate();
  const [outcome, setOutcome] = useState<Outcome>();

  if (removeMember === undefined) return { remove: undefined, outcome };

  const remove = (member: ListedMember) => {
    if (removeMember.isPending) return;
    const { personId } = member;
    hold(member);
    setOutcome(undefined);
    if (personId !== readerId) {
      removeMember.mutate({ personId });
      const removed: Removed = { personId, name: nameOf(member) };
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
          setOutcome(outcomeOfFailure(failure, "action"));
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
        action: (
          <Link to={MEMBERS_PAGE.path} className="text-brand underline">
            {WORDS.toMembers}
          </Link>
        ),
      }}
    />
  );
}

function MemberHeader(properties: { readonly member: ListedMember }) {
  const { member } = properties;

  return (
    <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2">
      <Avatar aria-hidden className="size-10">
        <AvatarFallback>{initialsOf(nameOf(member))}</AvatarFallback>
      </Avatar>
      <p className="min-w-0 flex-1 text-muted-foreground">
        <Address address={member.address} />
      </p>
    </div>
  );
}

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
              className="inline-flex min-h-6 items-center text-brand underline-offset-4 hover:underline"
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
    groups: () => landings.groups.current?.querySelector<HTMLElement>('[role="checkbox"], a'),
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
  useBreadcrumbLastPart(nameOf(member));

  usePageKeystrokes(KEYSTROKES);
  useKeystroke(KEY.changeRole, () => {
    landOn("role");
  });
  useKeystroke(KEY.changeGroups, () => {
    landOn("groups");
  });
  useKeystroke(KEY.flagName, () => {
    landOn("flag");
  });
  useKeystroke(KEY.signOut, () => {
    landOn("credentials");
  });
  useKeystroke(KEY.remove, () => {
    landOn("removal");
  });

  const arrive = useEffectEvent((at: OpenedAt) => {
    landOn(at);
  });
  useEffect(() => {
    if (openedAt !== undefined) arrive(openedAt);
  }, [openedAt]);

  return (
    <>
      <PageHead title={nameOf(member)} headingRef={title} />
      <MemberHeader member={member} />
      <SectionNav />
      <div className="mt-6 grid gap-6">
        {SECTIONS.map((section) => (
          <SectionShown key={section.id} section={section} drawn={{ member, landings, removal }} />
        ))}
      </div>
    </>
  );
}

function MemberRead(properties: {
  readonly personId: string;
  readonly heading: RefObject<HTMLHeadingElement | null>;
  readonly unread: ReactNode;
}) {
  const members = useMembers();
  const { openedAt, membersQuery } = useOpening();
  const [leaving, setLeaving] = useState<ListedMember>();
  const removal = useRemoval(membersQuery, setLeaving);

  const member =
    members.data?.find((each) => each.personId === properties.personId) ??
    (leaving?.personId === properties.personId ? leaving : undefined);
  if (members.error === null && members.data !== undefined && member !== undefined) {
    return <MemberShown member={member} openedAt={openedAt} removal={removal} />;
  }
  return (
    <>
      {properties.unread}
      <MemberUnread members={members} heading={properties.heading} />
    </>
  );
}

function MemberUnread(properties: {
  readonly members: ReturnType<typeof useMembers>;
  readonly heading: RefObject<HTMLHeadingElement | null>;
}) {
  const { members } = properties;
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
  return <NoSuchMember />;
}

export function MemberPage(properties: { readonly personId: string | undefined }) {
  const { personId } = properties;
  const heading = useRef<HTMLHeadingElement>(null);
  const unread = <PageHead title={MEMBERS_PAGE.name} headingRef={heading} />;

  return personId === undefined ? (
    <>
      {unread}
      <NoSuchMember />
    </>
  ) : (
    <MemberRead key={personId} personId={personId} heading={heading} unread={unread} />
  );
}
