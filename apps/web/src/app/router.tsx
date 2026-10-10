import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Navigate,
  Outlet,
  redirect,
  useParams,
  type AnyRoute,
  type RouterHistory,
} from "@tanstack/react-router";
import type { ReactElement, ReactNode } from "react";
import { z } from "zod";

import { AcceptInvitationPage } from "@/features/auth/accept-invitation-page.tsx";
import { AccountPage } from "@/features/auth/account-page.tsx";
import { ACCOUNT_HEADING } from "@/features/auth/account-words.ts";
import {
  displayNameDetour,
  signedOutDetour,
  signedOutOfAStep,
} from "@/features/auth/auth-hooks.ts";
import { backTo, carriedFlow, leavingFor, pageQuery } from "@/features/auth/carried-flow.ts";
import { ChooseWorkspacePage } from "@/features/auth/choose-workspace-page.tsx";
import { DisplayNamePage } from "@/features/auth/display-name-page.tsx";
import { LinkPage } from "@/features/auth/link-page.tsx";
import {
  memberRefusal,
  NEEDS_A_PICK,
  roleHeld,
  SECOND_FACTOR_PENDING,
  useMember,
} from "@/features/auth/member.ts";
import { NoWorkspacePage } from "@/features/auth/no-workspace-page.tsx";
import { detourAfter } from "@/features/auth/pending-refusal.ts";
import { ConfirmPage, RecoveryPage } from "@/features/auth/second-factor-pages.tsx";
import {
  CODES_STEP,
  codesDetour,
  CONFIRM_STEP,
  confirmDetour,
  pendingDetour,
  RECOVERY_STEP,
  SETUP_STEP,
  type LeftFrom,
} from "@/features/auth/second-factor-steps.ts";
import { CodesPage, SetupPage } from "@/features/auth/setup-page.tsx";
import { SignInPage } from "@/features/auth/sign-in-page.tsx";
import { EveryonePage } from "@/features/console/everyone-page.tsx";
import { NamesWaitingPage } from "@/features/console/names-waiting-page.tsx";
import { isTheOperator, mustSignInForTheConsole } from "@/features/console/operator.ts";
import { WorkspacesPage } from "@/features/console/workspaces-page.tsx";
import { CONCEPT_IRI } from "@/features/knowledge/concept-address.ts";
import { ConceptPage } from "@/features/knowledge/concept-page.tsx";
import { SearchPage } from "@/features/knowledge/search-page.tsx";
import { AuditLogPage } from "@/features/people/audit-log-page.tsx";
import { GroupsPage } from "@/features/people/groups-page.tsx";
import { MemberPage } from "@/features/people/member-page.tsx";
import { PERSON_ID } from "@/features/people/members-address.ts";
import { MEMBERS_TOOLBAR, MembersPage } from "@/features/people/members-page.tsx";
import { ConnectedSourcesPage } from "@/features/sources/connected-sources-page.tsx";
import type { FailedDuring } from "@/shared/api/query-client.ts";
import { createApiProxy, type ApiProxy } from "@/shared/api/trpc.ts";
import {
  CONSOLE,
  hides,
  HOMES,
  leadsTo,
  movedWithin,
  OPERATOR_READER,
  readerOf,
  pagesOf,
  AREAS,
  visibleTo,
  type Moved,
  type Reader,
  type Page,
  type PagePath,
  type Area,
} from "@/shared/navigation.ts";
import type { PageToolbar } from "@/shared/page-toolbar.tsx";

import { ConsoleFrame } from "./console-frame.tsx";
import { FailedPage } from "./failed-page.tsx";
import { WorkspaceFrame } from "./frame.tsx";
import { MODELS_AND_SPEND_TOOLBAR, ModelsAndSpendPage } from "./pages/models-and-spend-page.tsx";
import { UnbuiltPage } from "./pages/unbuilt-page.tsx";
import type { AppClients } from "./providers.tsx";
import { UnknownAddress, UnknownPage } from "./unknown-page.tsx";
import { useHidden, useVisibleTree } from "./visible-tree.ts";
import { ROLE_UNREAD } from "./words.ts";

type BuiltPage = { readonly draw: () => ReactElement; readonly toolbar?: PageToolbar };

/** The list decides which pages are built; this map only says by what, and with what in hand. */
const BUILT_PAGES: ReadonlyMap<string, BuiltPage> = new Map<PagePath, BuiltPage>([
  ["/knowledge/search", { draw: SearchPage }],
  ["/sources/connected-sources", { draw: ConnectedSourcesPage }],
  ["/models/models-and-spend", { draw: ModelsAndSpendPage, toolbar: MODELS_AND_SPEND_TOOLBAR }],
  ["/people/members", { draw: MembersPage, toolbar: MEMBERS_TOOLBAR }],
  ["/people/groups", { draw: GroupsPage }],
  ["/system/audit-log", { draw: AuditLogPage }],
  ["/console/people/everyone", { draw: EveryonePage }],
  ["/console/people/names-waiting", { draw: NamesWaitingPage }],
  ["/console/workspaces/every-workspace", { draw: WorkspacesPage }],
]);

type BuiltDetail = {
  /** What the address's segment must be; anything else draws as naming no row. */
  readonly value: z.ZodType<string>;
  readonly draw: (value: string | undefined) => ReactElement;
};

/** The list declares each detail address; this map says what draws it, keyed by its page. */
const BUILT_DETAILS: ReadonlyMap<string, BuiltDetail> = new Map<PagePath, BuiltDetail>([
  ["/knowledge/search", { value: CONCEPT_IRI, draw: (iri) => <ConceptPage iri={iri} /> }],
  ["/people/members", { value: PERSON_ID, draw: (personId) => <MemberPage personId={personId} /> }],
]);

type ShellContext = { readonly queryClient: QueryClient; readonly api: ApiProxy };

/** The router's address, and the address bar's query, which alone keeps a signed flow whole. */
const leftFrom = (location: { readonly href: string }): LeftFrom => ({
  href: location.href,
  query: pageQuery(),
});

/** A pending session confirms before any page that reads what the gate holds. */
const confirmedFirst = async (
  context: ShellContext,
  location: { readonly href: string },
  afresh = false,
): Promise<void> => {
  const from = leftFrom(location);
  const elsewhere = await pendingDetour(context.queryClient, context.api, from, afresh);
  if (elsewhere !== undefined) throw redirect(leavingFor(elsewhere));
};

const rootRoute = createRootRouteWithContext<ShellContext>()({
  component: Outlet,
  notFoundComponent: () => <UnknownAddress />,
});

const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sign-in",
  component: SignInPage,
});

/** The email's sign-in link, which carries its token in the fragment, so no server log holds it. */
const signInLinkRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sign-in/link",
  component: LinkPage,
});

const displayNameRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/display-name",
  component: DisplayNamePage,
  beforeLoad: async ({ context }) => {
    const elsewhere = await displayNameDetour(context.queryClient, context.api, pageQuery());
    if (elsewhere !== undefined) throw redirect(leavingFor(elsewhere));
  },
});

/** Only a signed-out visitor is sent on; each page's own read decides the rest as it draws. */
const pendingRoute = <const Path extends string>(path: Path, component: () => ReactElement) =>
  createRoute({
    getParentRoute: () => rootRoute,
    path,
    component,
    beforeLoad: async ({ context }) => {
      const elsewhere = await signedOutOfAStep(context.queryClient, pageQuery());
      if (elsewhere !== undefined) throw redirect(leavingFor(elsewhere));
    },
  });

const confirmRoute = pendingRoute(CONFIRM_STEP, ConfirmPage);

const recoveryRoute = pendingRoute(RECOVERY_STEP, RecoveryPage);

const setupRoute = pendingRoute(SETUP_STEP, SetupPage);

/** After the pending pages and before the display name, for a set never ticked as saved. */
const codesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: CODES_STEP,
  component: CodesPage,
  beforeLoad: async ({ context }) => {
    const elsewhere = await codesDetour(context.queryClient, context.api, pageQuery());
    if (elsewhere !== undefined) throw redirect(leavingFor(elsewhere));
  },
});

/** Framed once a workspace is open, and decided on arrival: a later read never swaps the page. */
function AccountWhereHeld(): ReactElement {
  const framed = accountRoute.useRouteContext({ select: (context) => context.framed });

  return framed ? (
    <WorkspaceFrame page={{ draw: <AccountPage framed />, name: ACCOUNT_HEADING }} />
  ) : (
    <AccountPage />
  );
}

/** Outside the shell's route, so a person with no workspace and the operator reach it too. */
const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/account",
  component: AccountWhereHeld,
  beforeLoad: async ({ context, location }) => {
    const elsewhere = await signedOutDetour(context.queryClient, location.href);
    if (elsewhere !== undefined) throw redirect(leavingFor(elsewhere));
    await confirmedFirst(context, location);
    await memberRefusal(context.queryClient, context.api);
    return { framed: roleHeld(context.queryClient, context.api) !== undefined };
  },
});

/** A pending "connect Claude" flow lands here, and keeps its signed query through confirm. */
const chooseWorkspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/choose-workspace",
  component: ChooseWorkspacePage,
  beforeLoad: ({ context, location }) => confirmedFirst(context, location),
});

/** The operator's home is the console's, unless a carried Claude flow waits on joining one. */
const noWorkspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/no-workspace",
  component: NoWorkspacePage,
  beforeLoad: async ({ context, location, cause }) => {
    await confirmedFirst(context, location);
    if (carriedFlow(pageQuery()) !== "") return;
    if (await isTheOperator(context.queryClient, context.api, cause === "enter")) {
      throw redirect({ href: HOMES.operator.path, replace: true });
    }
  },
});

/** Outside the shell: the person joining is not yet a member of the workspace. */
const acceptInvitationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/invitations/$invitationId",
  component: function AcceptInvitationAtAddress(): ReactElement {
    const { invitationId } = acceptInvitationRoute.useParams();
    return <AcceptInvitationPage invitationId={invitationId} />;
  },
  // The page asks a nameless invitee's name beside its join, so only a signed-out one is sent on.
  beforeLoad: async ({ context, location }) => {
    const elsewhere = await signedOutDetour(context.queryClient, location.pathname);
    if (elsewhere !== undefined) throw redirect(leavingFor(elsewhere));
    await confirmedFirst(context, location);
  },
});

const signInAndBackTo = (href: string) => ({ href: backTo("/sign-in", href), replace: true });

/** A pending session's own step is asked afresh: a held read may predate the refusal. */
const shellDetour = async (
  context: ShellContext,
  location: { readonly href: string },
  refusal: string,
) => {
  if (refusal === NEEDS_A_PICK) return { href: "/choose-workspace", replace: true };
  if (refusal !== SECOND_FACTOR_PENDING) return signInAndBackTo(location.href);
  return leavingFor(await confirmDetour(context.queryClient, context.api, leftFrom(location)));
};

const shellRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "shell",
  component: WorkspaceFrame,
  notFoundComponent: () => <UnknownPage />,
  // The sign-in page and the picker are this route's siblings, so this never runs on them.
  beforeLoad: async ({ context, location }) => {
    const refusal = await memberRefusal(context.queryClient, context.api);
    if (refusal === undefined) return;

    throw redirect(await shellDetour(context, location, refusal));
  },
});

/** Read after the shell's own read, which left no role in hand when it failed. */
const memberOf = (context: ShellContext): Reader =>
  readerOf(roleHeld(context.queryClient, context.api));

/** No role is held, so asking again is the one way on; the route moves once it answers. */
function RoleUnread() {
  const member = useMember();

  return (
    <FailedPage
      reset={() => {
        void member.refetch();
      }}
      said={ROLE_UNREAD}
    />
  );
}

const indexRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: "/",
  beforeLoad: ({ context }) => {
    const { role } = memberOf(context);
    if (role !== undefined) throw redirect({ href: HOMES[role].path, replace: true });
  },
  component: function HomeUnread() {
    const { home } = useVisibleTree();
    return home === undefined ? <RoleUnread /> : <Navigate to={home.path} replace />;
  },
});

/** Outside any workspace, so it asks for a session and never for a workspace pick. */
const consoleRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "console",
  component: ConsoleFrame,
  notFoundComponent: () => <UnknownPage home={HOMES.operator} />,
  // Asked afresh on the way in, and not again on each move between the console's own pages.
  beforeLoad: async ({ context, location, cause }) => {
    const afresh = cause === "enter";
    if (await mustSignInForTheConsole(context.queryClient, context.api, afresh)) {
      throw redirect(signInAndBackTo(location.href));
    }
    // The operator's standing never refuses a pending session, so the console asks itself.
    await confirmedFirst(context, location, afresh);
  },
});

const consoleIndexRoute = createRoute({
  getParentRoute: () => consoleRoute,
  path: "/console",
  beforeLoad: () => {
    throw redirect({ href: HOMES.operator.path, replace: true });
  },
});

/** A page hidden from a held role draws as an address that never existed. */
function Seen(properties: { readonly path: string; readonly children: ReactNode }) {
  if (useHidden(useVisibleTree(), properties.path)) return <UnknownPage />;
  return properties.children;
}

const PARAMS = z.record(z.string(), z.string());

/** The address's segment is read once, here, and reaches the page only once it is valid. */
function DetailOf(properties: {
  readonly page: Page;
  readonly param: string;
  readonly detail: BuiltDetail;
}) {
  const { page, param, detail } = properties;
  // Typed as every route's params at once, so this route's segment is read by its name.
  const value = useParams({
    strict: false,
    select: (params) => PARAMS.safeParse(params).data?.[param],
  });
  const valid = detail.value.safeParse(value);

  return <Seen path={page.path}>{detail.draw(valid.success ? valid.data : undefined)}</Seen>;
}

/** An older address moves on only once the reader may see where it leads. */
function MovedAway(properties: { readonly moved: Moved }) {
  const visible = useVisibleTree();
  if (visible.home === undefined) return <RoleUnread />;

  const to = leadsTo(visible, properties.moved);
  return to === undefined ? <UnknownPage /> : <Navigate to={to.path} replace />;
}

const HOME_PAGES: readonly Page[] = Object.values(HOMES);

/** A detail address is declared beneath a built page, and nowhere else is one drawn. */
const detailOf = (page: Page): BuiltDetail | undefined => {
  const built = BUILT_DETAILS.get(page.path);
  if (page.detail !== undefined && built === undefined) {
    throw new Error(`the list declares an address beneath ${page.path}, and nothing draws it`);
  }
  if (page.detail === undefined && built !== undefined) {
    throw new Error(`something draws an address beneath ${page.path}, and the list declares none`);
  }
  return built;
};

const drawOf = (page: Page): BuiltPage | undefined => {
  const built = BUILT_PAGES.get(page.path);
  if (page.built && built === undefined) {
    throw new Error(`the list calls ${page.path} built, and nothing draws it`);
  }
  if (!page.built && built !== undefined) {
    throw new Error(`the list calls ${page.path} unbuilt, and something draws it`);
  }
  return (
    built ?? (HOME_PAGES.includes(page) ? { draw: () => <UnbuiltPage home={page} /> } : undefined)
  );
};

type Reading = {
  readonly readerIn: (context: ShellContext) => Reader;
  /** A failed page offers the way home, which in the console is the console's own. */
  readonly home?: Page;
};

const routesOf = (areas: readonly Area[], shell: AnyRoute, reading: Reading): AnyRoute[] => {
  const { readerIn, home } = reading;
  const failed = (failure: { readonly reset: () => void }) => (
    <FailedPage reset={failure.reset} home={home} />
  );

  // An unbuilt page has no route at all, so its address is one that never existed.
  const drawn = pagesOf(areas).flatMap((page) => {
    const built = drawOf(page);
    return built === undefined ? [] : [{ page, built }];
  });

  // Decided by the page's own address, so a detail beneath it is seen exactly as it is.
  const arriving = (page: Page) => (context: ShellContext) => {
    const reader = readerIn(context);
    return {
      hidden: hides(visibleTo(reader, areas), page.path),
      unread: reader.role === undefined,
    };
  };

  const details = drawn.flatMap(({ page }) => {
    const detail = detailOf(page);
    return detail === undefined || page.detail === undefined
      ? []
      : [{ page, param: page.detail.param, detail }];
  });

  return [
    ...drawn.map(({ page, built }) => {
      const Draw = built.draw;
      return createRoute({
        getParentRoute: () => shell,
        path: page.path,
        beforeLoad: ({ context }) => arriving(page)(context),
        component: () => (
          <Seen path={page.path}>
            <Draw />
          </Seen>
        ),
        errorComponent: failed,
        staticData: { toolbar: built.toolbar },
      });
    }),
    // No toolbar: a detail has the page's place, not its tabs.
    ...details.map(({ page, param, detail }) =>
      createRoute({
        getParentRoute: () => shell,
        path: `${page.path}/$${param}`,
        beforeLoad: ({ context }) => arriving(page)(context),
        component: () => <DetailOf page={page} param={param} detail={detail} />,
        errorComponent: failed,
      }),
    ),
    ...movedWithin(areas).map((moved) =>
      createRoute({
        getParentRoute: () => shell,
        path: moved.from,
        beforeLoad: ({ context }) => {
          const to = leadsTo(visibleTo(readerIn(context), areas), moved);
          if (to !== undefined) throw redirect({ href: to.path, replace: true });
        },
        component: () => <MovedAway moved={moved} />,
      }),
    ),
  ];
};

const workspaceRoutes = routesOf(AREAS, shellRoute, { readerIn: memberOf });

const consoleRoutes = routesOf([CONSOLE], consoleRoute, {
  readerIn: () => OPERATOR_READER,
  home: HOMES.operator,
});

/** Each failure is heard where it happened, and acted on only if the person is still there. */
const detouringOn =
  (
    context: ShellContext,
    routing: {
      readonly at: () => LeftFrom & { readonly pathname: string };
      readonly go: (href: string) => void;
    },
  ) =>
  (failure: Error, during: FailedDuring) => {
    const at = routing.at();
    void detourAfter(failure, during, at, context).then((href) => {
      if (href !== undefined && routing.at().href === at.href) routing.go(href);
    });
  };

export const createAppRouter = (clients: AppClients, history?: RouterHistory) => {
  const context = {
    queryClient: clients.queryClient,
    api: createApiProxy(clients.apiClient, clients.queryClient),
  };
  const options = {
    routeTree: rootRoute.addChildren([
      signInRoute,
      signInLinkRoute,
      displayNameRoute,
      confirmRoute,
      recoveryRoute,
      setupRoute,
      codesRoute,
      accountRoute,
      chooseWorkspaceRoute,
      noWorkspaceRoute,
      acceptInvitationRoute,
      shellRoute.addChildren([indexRoute, ...workspaceRoutes]),
      consoleRoute.addChildren([consoleIndexRoute, ...consoleRoutes]),
    ]),

    context,
    defaultErrorComponent: FailedPage,
  };

  const router =
    history === undefined ? createRouter(options) : createRouter({ ...options, history });
  clients.failures.answeredBy(
    detouringOn(context, {
      at: () => ({ ...leftFrom(router.latestLocation), pathname: router.latestLocation.pathname }),
      go: (href) => {
        void router.navigate(leavingFor(href));
      },
    }),
  );
  return router;
};

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }

  /** The route is how a page's toolbar reaches the shell: props down, never an import up. */
  interface StaticDataRouteOption {
    readonly toolbar?: PageToolbar | undefined;
  }
}
