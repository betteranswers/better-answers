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

import { AcceptInvitationScreen } from "@/features/auth/accept-invitation-screen.tsx";
import { AccountPage } from "@/features/auth/account-page.tsx";
import {
  displayNameDetour,
  signedOutDetour,
  signedOutOfAStep,
} from "@/features/auth/auth-hooks.ts";
import { backTo, leavingFor, pageQuery } from "@/features/auth/carried-flow.ts";
import { ChooseWorkspaceScreen } from "@/features/auth/choose-workspace-screen.tsx";
import { DisplayNameScreen } from "@/features/auth/display-name-screen.tsx";
import { LinkScreen } from "@/features/auth/link-screen.tsx";
import {
  membershipRefusal,
  NEEDS_A_PICK,
  roleHeld,
  SECOND_FACTOR_PENDING,
  useMembership,
} from "@/features/auth/membership.ts";
import { NoWorkspaceScreen } from "@/features/auth/no-workspace-screen.tsx";
import { detourAfter } from "@/features/auth/pending-refusal.ts";
import { ConfirmScreen, RecoveryScreen } from "@/features/auth/second-factor-screens.tsx";
import {
  CODES_STEP,
  codesDetour,
  CONFIRM_STEP,
  detourTo,
  pendingDetour,
  RECOVERY_STEP,
  SETUP_STEP,
  type LeftFrom,
} from "@/features/auth/second-factor-steps.ts";
import { CodesScreen, SetupScreen } from "@/features/auth/setup-screen.tsx";
import { SignInScreen } from "@/features/auth/sign-in-screen.tsx";
import { EveryoneScreen } from "@/features/console/everyone-screen.tsx";
import { NamesWaitingScreen } from "@/features/console/names-waiting-screen.tsx";
import { mustSignInForTheConsole } from "@/features/console/operator.ts";
import { WorkspacesScreen } from "@/features/console/workspaces-screen.tsx";
import { AuditLogScreen } from "@/features/people/audit-log-screen.tsx";
import { GroupsScreen } from "@/features/people/groups-screen.tsx";
import { MemberPage } from "@/features/people/member-page.tsx";
import { PERSON_ID } from "@/features/people/members-address.ts";
import { MEMBERS_TOOLBAR, MembersScreen } from "@/features/people/members-screen.tsx";
import { BINDINGS_TOOLBAR, BindingsScreen } from "@/features/sources/bindings-screen.tsx";
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
  screensOf,
  SURFACES,
  visibleTo,
  type Moved,
  type Reader,
  type Screen,
  type ScreenPath,
  type Surface,
} from "@/shared/navigation.ts";
import type { ScreenToolbar } from "@/shared/screen-toolbar.tsx";

import { ConsoleFrame } from "./console-frame.tsx";
import { FailedScreen } from "./failed-screen.tsx";
import { WorkspaceFrame } from "./frame.tsx";
import type { AppClients } from "./providers.tsx";
import {
  ROUTES_AND_SPEND_TOOLBAR,
  RoutesAndSpendScreen,
} from "./screens/routes-and-spend-screen.tsx";
import { UnbuiltScreen } from "./screens/unbuilt-screen.tsx";
import { UnknownScreen } from "./unknown-screen.tsx";
import { useHidden, useVisibleTree } from "./visible-tree.ts";
import { ROLE_UNREAD } from "./words.ts";

type BuiltScreen = { readonly draw: () => ReactElement; readonly toolbar?: ScreenToolbar };

/** The list decides which screens are built; this map only says by what, and with what in hand. */
const BUILT_SCREENS: ReadonlyMap<string, BuiltScreen> = new Map<ScreenPath, BuiltScreen>([
  ["/sources/bindings", { draw: BindingsScreen, toolbar: BINDINGS_TOOLBAR }],
  [
    "/agent-operations/routes-and-spend",
    { draw: RoutesAndSpendScreen, toolbar: ROUTES_AND_SPEND_TOOLBAR },
  ],
  ["/people/members", { draw: MembersScreen, toolbar: MEMBERS_TOOLBAR }],
  ["/people/groups", { draw: GroupsScreen }],
  ["/system/audit-log", { draw: AuditLogScreen }],
  ["/console/people/everyone", { draw: EveryoneScreen }],
  ["/console/people/names-waiting", { draw: NamesWaitingScreen }],
  ["/console/workspaces/every-workspace", { draw: WorkspacesScreen }],
]);

type BuiltDetail = {
  /** What the address's segment must be; anything else draws as naming no row. */
  readonly value: z.ZodType<string>;
  readonly draw: (value: string | undefined) => ReactElement;
};

/** The list declares each detail address; this map says what draws it, keyed by its screen. */
const BUILT_DETAILS: ReadonlyMap<string, BuiltDetail> = new Map<ScreenPath, BuiltDetail>([
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
  notFoundComponent: () => <UnknownScreen />,
});

const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sign-in",
  component: SignInScreen,
});

/** The email's sign-in link, which carries its token in the fragment, so no server log holds it. */
const signInLinkRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sign-in/link",
  component: LinkScreen,
});

const displayNameRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/display-name",
  component: DisplayNameScreen,
  beforeLoad: async ({ context }) => {
    const elsewhere = await displayNameDetour(context.queryClient, context.api, pageQuery());
    if (elsewhere !== undefined) throw redirect(leavingFor(elsewhere));
  },
});

/** Only a signed-out visitor is sent on; each screen's own read decides the rest as it draws. */
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

const confirmRoute = pendingRoute(CONFIRM_STEP, ConfirmScreen);

const recoveryRoute = pendingRoute(RECOVERY_STEP, RecoveryScreen);

const setupRoute = pendingRoute(SETUP_STEP, SetupScreen);

/** After the pending screens and before the display name, for a set never ticked as saved. */
const codesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: CODES_STEP,
  component: CodesScreen,
  beforeLoad: async ({ context }) => {
    const elsewhere = await codesDetour(context.queryClient, context.api, pageQuery());
    if (elsewhere !== undefined) throw redirect(leavingFor(elsewhere));
  },
});

/** Outside the shell, so a person with no workspace and the operator reach it too. */
const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/account",
  component: AccountPage,
  beforeLoad: async ({ context, location }) => {
    const elsewhere = await signedOutDetour(context.queryClient, location.href);
    if (elsewhere !== undefined) throw redirect(leavingFor(elsewhere));
    await confirmedFirst(context, location);
  },
});

/** A pending "connect Claude" flow lands here, and keeps its signed query through confirm. */
const chooseWorkspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/choose-workspace",
  component: ChooseWorkspaceScreen,
  beforeLoad: ({ context, location }) => confirmedFirst(context, location),
});

const noWorkspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/no-workspace",
  component: NoWorkspaceScreen,
  beforeLoad: ({ context, location }) => confirmedFirst(context, location),
});

/** Outside the shell: the person joining holds no membership of the workspace yet. */
const acceptInvitationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/invitations/$invitationId",
  component: function AcceptInvitationPage(): ReactElement {
    const { invitationId } = acceptInvitationRoute.useParams();
    return <AcceptInvitationScreen invitationId={invitationId} />;
  },
  // The page asks a nameless invitee's name beside its join, so only a signed-out one is sent on.
  beforeLoad: async ({ context, location }) => {
    const elsewhere = await signedOutDetour(context.queryClient, location.pathname);
    if (elsewhere !== undefined) throw redirect(leavingFor(elsewhere));
    await confirmedFirst(context, location);
  },
});

const signInAndBackTo = (href: string) => ({ href: backTo("/sign-in", href), replace: true });

/** Asked afresh: the refusal says the session is pending, and a held read may predate that. */
const confirmAndBackTo = async (context: ShellContext, location: { readonly href: string }) => {
  const from = leftFrom(location);
  const detour = await pendingDetour(context.queryClient, context.api, from, true);
  return leavingFor(detour ?? detourTo(CONFIRM_STEP, from));
};

const shellDetour = (
  context: ShellContext,
  location: { readonly href: string },
  refusal: string,
) => {
  if (refusal === NEEDS_A_PICK) return { href: "/choose-workspace", replace: true };
  return refusal === SECOND_FACTOR_PENDING
    ? confirmAndBackTo(context, location)
    : signInAndBackTo(location.href);
};

const shellRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "shell",
  component: WorkspaceFrame,
  notFoundComponent: () => <UnknownScreen />,
  // The sign-in screen and the picker are this route's siblings, so this never runs on them.
  beforeLoad: async ({ context, location }) => {
    const refusal = await membershipRefusal(context.queryClient, context.api);
    if (refusal === undefined) return;

    throw redirect(await shellDetour(context, location, refusal));
  },
});

/** Read after the shell's own read, which left no role in hand when it failed. */
const memberOf = (context: ShellContext): Reader =>
  readerOf(roleHeld(context.queryClient, context.api));

/** No role is held, so asking again is the one way on; the route moves once it answers. */
function RoleUnread() {
  const membership = useMembership();

  return (
    <FailedScreen
      reset={() => {
        void membership.refetch();
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
  notFoundComponent: () => <UnknownScreen home={HOMES.operator} />,
  // Asked afresh on the way in, and not again on each move between the console's own screens.
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

/** A screen hidden from a held role draws as an address that never existed. */
function Seen(properties: { readonly path: string; readonly children: ReactNode }) {
  if (useHidden(useVisibleTree(), properties.path)) return <UnknownScreen />;
  return properties.children;
}

const PARAMS = z.record(z.string(), z.string());

/** The address's segment is read once, here, and reaches the page only once it is valid. */
function DetailOf(properties: {
  readonly screen: Screen;
  readonly param: string;
  readonly detail: BuiltDetail;
}) {
  const { screen, param, detail } = properties;
  // Typed as every route's params at once, so this route's segment is read by its name.
  const value = useParams({
    strict: false,
    select: (params) => PARAMS.safeParse(params).data?.[param],
  });
  const valid = detail.value.safeParse(value);

  return <Seen path={screen.path}>{detail.draw(valid.success ? valid.data : undefined)}</Seen>;
}

/** An older address moves on only once the reader may see where it leads. */
function MovedAway(properties: { readonly moved: Moved }) {
  const visible = useVisibleTree();
  if (visible.home === undefined) return <RoleUnread />;

  const to = leadsTo(visible, properties.moved);
  return to === undefined ? <UnknownScreen /> : <Navigate to={to.path} replace />;
}

const HOME_SCREENS: readonly Screen[] = Object.values(HOMES);

/** A detail address is declared beneath a built screen, and nowhere else is one drawn. */
const detailOf = (screen: Screen): BuiltDetail | undefined => {
  const built = BUILT_DETAILS.get(screen.path);
  if (screen.detail !== undefined && built === undefined) {
    throw new Error(`the list declares an address beneath ${screen.path}, and nothing draws it`);
  }
  if (screen.detail === undefined && built !== undefined) {
    throw new Error(
      `something draws an address beneath ${screen.path}, and the list declares none`,
    );
  }
  return built;
};

const drawOf = (screen: Screen): BuiltScreen | undefined => {
  const built = BUILT_SCREENS.get(screen.path);
  if (screen.built && built === undefined) {
    throw new Error(`the list calls ${screen.path} built, and nothing draws it`);
  }
  if (!screen.built && built !== undefined) {
    throw new Error(`the list calls ${screen.path} unbuilt, and something draws it`);
  }
  return (
    built ??
    (HOME_SCREENS.includes(screen) ? { draw: () => <UnbuiltScreen home={screen} /> } : undefined)
  );
};

type Reading = {
  readonly readerIn: (context: ShellContext) => Reader;
  /** A failed screen offers the way home, which in the console is the console's own. */
  readonly home?: Screen;
};

const routesOf = (surfaces: readonly Surface[], shell: AnyRoute, reading: Reading): AnyRoute[] => {
  const { readerIn, home } = reading;
  const failed = (failure: { readonly reset: () => void }) => (
    <FailedScreen reset={failure.reset} home={home} />
  );

  // An unbuilt screen has no route at all, so its address is one that never existed.
  const drawn = screensOf(surfaces).flatMap((screen) => {
    const built = drawOf(screen);
    return built === undefined ? [] : [{ screen, built }];
  });

  // Decided by the screen's own address, so a detail beneath it is seen exactly as it is.
  const arriving = (screen: Screen) => (context: ShellContext) => {
    const reader = readerIn(context);
    return {
      hidden: hides(visibleTo(reader, surfaces), screen.path),
      unread: reader.role === undefined,
    };
  };

  const details = drawn.flatMap(({ screen }) => {
    const detail = detailOf(screen);
    return detail === undefined || screen.detail === undefined
      ? []
      : [{ screen, param: screen.detail.param, detail }];
  });

  return [
    ...drawn.map(({ screen, built }) => {
      const Draw = built.draw;
      return createRoute({
        getParentRoute: () => shell,
        path: screen.path,
        beforeLoad: ({ context }) => arriving(screen)(context),
        component: () => (
          <Seen path={screen.path}>
            <Draw />
          </Seen>
        ),
        errorComponent: failed,
        staticData: { toolbar: built.toolbar },
      });
    }),
    // No toolbar: a detail has the screen's place, not its tabs or acts.
    ...details.map(({ screen, param, detail }) =>
      createRoute({
        getParentRoute: () => shell,
        path: `${screen.path}/$${param}`,
        beforeLoad: ({ context }) => arriving(screen)(context),
        component: () => <DetailOf screen={screen} param={param} detail={detail} />,
        errorComponent: failed,
      }),
    ),
    ...movedWithin(surfaces).map((moved) =>
      createRoute({
        getParentRoute: () => shell,
        path: moved.from,
        beforeLoad: ({ context }) => {
          const to = leadsTo(visibleTo(readerIn(context), surfaces), moved);
          if (to !== undefined) throw redirect({ href: to.path, replace: true });
        },
        component: () => <MovedAway moved={moved} />,
      }),
    ),
  ];
};

const workspaceRoutes = routesOf(SURFACES, shellRoute, { readerIn: memberOf });

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
    defaultErrorComponent: FailedScreen,
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

  /** The route is how a screen's toolbar reaches the shell: props down, never an import up. */
  interface StaticDataRouteOption {
    readonly toolbar?: ScreenToolbar | undefined;
  }
}
