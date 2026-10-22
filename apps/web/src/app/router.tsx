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

import { RECORD_ID } from "@/features/ask/ask-state.ts";
import { NewQuestionPage } from "@/features/ask/new-question-page.tsx";
import { YourQuestionsPage, YourRecordPage } from "@/features/ask/your-questions-page.tsx";
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
import { NoWorkspacePage } from "@/features/auth/no-workspace-page.tsx";
import { detourAfter } from "@/features/auth/pending-refusal.ts";
import { reconfirmAfter, ReconfirmDialog } from "@/features/auth/reconfirm-dialog.tsx";
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
import { rememberTheSession } from "@/features/auth/session-memory.ts";
import { CodesPage, SetupPage } from "@/features/auth/setup-page.tsx";
import { SignInPage } from "@/features/auth/sign-in-page.tsx";
import { homeAfterASwitchElsewhere, homeOnceLeft } from "@/features/auth/switched-elsewhere.ts";
import { EveryonePage } from "@/features/console/everyone-page.tsx";
import { NamesWaitingPage } from "@/features/console/names-waiting-page.tsx";
import { isTheOperator, mustSignInForTheConsole } from "@/features/console/operator.ts";
import { WorkspacesPage } from "@/features/console/workspaces-page.tsx";
import { CollectionsAndOwnersPage } from "@/features/knowledge/collections-and-owners-page.tsx";
import { ConceptPage } from "@/features/knowledge/concept-page.tsx";
import { KnowledgeBasePage } from "@/features/knowledge/knowledge-base-page.tsx";
import { SearchPage } from "@/features/knowledge/search-page.tsx";
import { AuditLogPage } from "@/features/people/audit-log-page.tsx";
import { GroupsPage } from "@/features/people/groups-page.tsx";
import { MemberPage } from "@/features/people/member-page.tsx";
import { PERSON_ID } from "@/features/people/members-address.ts";
import { MEMBERS_TOOLBAR, MembersPage } from "@/features/people/members-page.tsx";
import { AnswerTestsPage } from "@/features/questions/answer-tests-page.tsx";
import { QuestionsAskedPage } from "@/features/questions/questions-asked-page.tsx";
import { ConnectedSourcesPage } from "@/features/sources/connected-sources-page.tsx";
import { ADDRESS_QUERY } from "@/shared/address-query.ts";
import type { FailedDuring } from "@/shared/api/query-client.ts";
import { createApiProxy, type ApiProxy } from "@/shared/api/trpc.ts";
import { CONCEPT_IRI } from "@/shared/knowledge/concept-address.ts";
import {
  memberRefusal,
  NEEDS_A_PICK,
  ownsHeld,
  roleHeld,
  SECOND_FACTOR_PENDING,
  useMember,
} from "@/shared/member.ts";
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
import { ConnectClaudePage } from "./pages/connect-assistant.tsx";
import { MODELS_AND_SPEND_TOOLBAR, ModelsAndSpendPage } from "./pages/models-and-spend-page.tsx";
import { UnbuiltPage } from "./pages/unbuilt-page.tsx";
import type { AppClients } from "./providers.tsx";
import { UnknownAddress, UnknownPage } from "./unknown-page.tsx";
import { useHidden, useVisibleTree } from "./visible-tree.ts";
import { ROLE_UNREAD } from "./words.ts";

type BuiltPage = { readonly draw: () => ReactElement; readonly toolbar?: PageToolbar };

const BUILT_PAGES: ReadonlyMap<string, BuiltPage> = new Map<PagePath, BuiltPage>([
  ["/ask/new-question", { draw: NewQuestionPage }],
  ["/ask/your-questions", { draw: YourQuestionsPage }],
  ["/ask/connect-claude", { draw: ConnectClaudePage }],
  ["/knowledge/search", { draw: SearchPage }],
  ["/knowledge/knowledge-base", { draw: KnowledgeBasePage }],
  ["/knowledge/collections-and-owners", { draw: CollectionsAndOwnersPage }],
  ["/sources/connected-sources", { draw: ConnectedSourcesPage }],
  ["/models/models-and-spend", { draw: ModelsAndSpendPage, toolbar: MODELS_AND_SPEND_TOOLBAR }],
  ["/questions/questions-asked", { draw: QuestionsAskedPage }],
  ["/questions/answer-tests", { draw: AnswerTestsPage }],
  ["/people/members", { draw: MembersPage, toolbar: MEMBERS_TOOLBAR }],
  ["/people/groups", { draw: GroupsPage }],
  ["/system/audit-log", { draw: AuditLogPage }],
  ["/console/people/everyone", { draw: EveryonePage }],
  ["/console/people/names-waiting", { draw: NamesWaitingPage }],
  ["/console/workspaces/every-workspace", { draw: WorkspacesPage }],
]);

type BuiltDetail = {
  readonly value: z.ZodType<string>;
  readonly draw: (value: string | undefined) => ReactElement;
};

const BUILT_DETAILS: ReadonlyMap<string, BuiltDetail> = new Map<PagePath, BuiltDetail>([
  [
    "/ask/your-questions",
    {
      value: RECORD_ID,
      draw: (recordId) => <YourRecordPage recordId={recordId} notFound={<UnknownPage />} />,
    },
  ],
  ["/knowledge/search", { value: CONCEPT_IRI, draw: (iri) => <ConceptPage iri={iri} /> }],
  ["/people/members", { value: PERSON_ID, draw: (personId) => <MemberPage personId={personId} /> }],
]);

type ShellContext = { readonly queryClient: QueryClient; readonly api: ApiProxy };

const leftFrom = (location: { readonly href: string }): LeftFrom => ({
  href: location.href,
  query: pageQuery(),
});

const confirmedFirst = async (
  context: ShellContext,
  location: { readonly href: string },
  afresh = false,
): Promise<void> => {
  const from = leftFrom(location);
  const elsewhere = await pendingDetour(context.queryClient, context.api, from, afresh);
  if (elsewhere !== undefined) throw redirect(leavingFor(elsewhere));
};

function RootFrame() {
  return (
    <>
      <ReconfirmDialog />
      <Outlet />
    </>
  );
}

const rootRoute = createRootRouteWithContext<ShellContext>()({
  component: RootFrame,
  notFoundComponent: () => <UnknownAddress />,
});

const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sign-in",
  component: SignInPage,
});

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

const codesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: CODES_STEP,
  component: CodesPage,
  beforeLoad: async ({ context }) => {
    const elsewhere = await codesDetour(context.queryClient, context.api, pageQuery());
    if (elsewhere !== undefined) throw redirect(leavingFor(elsewhere));
  },
});

const sessionHeld = (): void => {
  rememberTheSession("held");
};

function AccountWhereHeld(): ReactElement {
  const framed = accountRoute.useRouteContext({ select: (context) => context.framed });

  return framed ? (
    <WorkspaceFrame page={{ draw: <AccountPage framed />, name: ACCOUNT_HEADING }} />
  ) : (
    <AccountPage />
  );
}

const accountRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/account",
  component: AccountWhereHeld,
  beforeLoad: async ({ context, location }) => {
    const elsewhere = await signedOutDetour(context.queryClient, location.href);
    if (elsewhere !== undefined) throw redirect(leavingFor(elsewhere));
    await confirmedFirst(context, location);
    await memberRefusal(context.queryClient, context.api, sessionHeld);
    return { framed: roleHeld(context.queryClient, context.api) !== undefined };
  },
});

const chooseWorkspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/choose-workspace",
  component: ChooseWorkspacePage,
  beforeLoad: ({ context, location }) => confirmedFirst(context, location),
});

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

const acceptInvitationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/invitations/$invitationId",
  component: function AcceptInvitationAtAddress(): ReactElement {
    const { invitationId } = acceptInvitationRoute.useParams();
    return <AcceptInvitationPage invitationId={invitationId} />;
  },
  beforeLoad: async ({ context, location }) => {
    const elsewhere = await signedOutDetour(context.queryClient, location.pathname);
    if (elsewhere !== undefined) throw redirect(leavingFor(elsewhere));
    await confirmedFirst(context, location);
  },
});

const signInAndBackTo = (href: string) => ({ href: backTo("/sign-in", href), replace: true });

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
  beforeLoad: async ({ context, location }) => {
    const refusal = await memberRefusal(context.queryClient, context.api, sessionHeld);
    if (refusal === undefined) return;

    throw redirect(await shellDetour(context, location, refusal));
  },
});

const memberOf = (context: ShellContext): Reader =>
  readerOf(roleHeld(context.queryClient, context.api), ownsHeld(context.queryClient, context.api));

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
    if (role !== undefined) throw redirect({ href: HOMES[role].path, replace: true, state: true });
  },
  component: function HomeUnread() {
    const { home } = useVisibleTree();
    return home === undefined ? <RoleUnread /> : <Navigate to={home.path} replace state />;
  },
});

const consoleRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "console",
  component: ConsoleFrame,
  notFoundComponent: () => <UnknownPage home={HOMES.operator} />,
  beforeLoad: async ({ context, location, cause }) => {
    const afresh = cause === "enter";
    if (await mustSignInForTheConsole(context.queryClient, context.api, afresh)) {
      throw redirect(signInAndBackTo(location.href));
    }
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

function Seen(properties: { readonly path: string; readonly children: ReactNode }) {
  if (useHidden(useVisibleTree(), properties.path)) return <UnknownPage />;
  return properties.children;
}

const PARAMS = z.record(z.string(), z.string());

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

function MovedAway(properties: { readonly moved: Moved }) {
  const visible = useVisibleTree();
  if (visible.home === undefined) return <RoleUnread />;

  const to = leadsTo(visible, properties.moved);
  return to === undefined ? <UnknownPage /> : <Navigate to={to.path} replace />;
}

const HOME_PAGES: readonly Page[] = Object.values(HOMES);

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
  readonly home?: Page;
};

const routesOf = (areas: readonly Area[], shell: AnyRoute, reading: Reading): AnyRoute[] => {
  const { readerIn, home } = reading;
  const failed = (failure: { readonly reset: () => void }) => (
    <FailedPage reset={failure.reset} home={home} />
  );

  const drawn = pagesOf(areas).flatMap((page) => {
    const built = drawOf(page);
    return built === undefined ? [] : [{ page, built }];
  });

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
    ...ADDRESS_QUERY,
  };

  const router =
    history === undefined ? createRouter(options) : createRouter({ ...options, history });
  const detour = detouringOn(context, {
    at: () => ({ ...leftFrom(router.latestLocation), pathname: router.latestLocation.pathname }),
    go: (href) => {
      void router.navigate(leavingFor(href));
    },
  });
  clients.failures.answeredBy((failure, during, refusedAct) => {
    if (refusedAct !== undefined && reconfirmAfter(failure, refusedAct)) return;
    const home = homeAfterASwitchElsewhere(failure, context);
    if (home === undefined) detour(failure, during);
    else void home.then((to) => router.navigate(to));
  });
  clients.shown.whenLeft(() => {
    void homeOnceLeft(context).then((to) => router.navigate(to));
  });
  return router;
};

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }

  interface StaticDataRouteOption {
    readonly toolbar?: PageToolbar | undefined;
  }
}
