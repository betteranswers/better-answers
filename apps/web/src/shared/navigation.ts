import {
  ASK,
  CONTROL_CENTRE,
  CONSOLE,
  OWNS_NOTHING,
  OWNING,
  EVERY_AREA,
  type Area,
  type MenuGroup,
  type Page,
  type RoleOrOperator,
  type Owns,
} from "./navigation/areas.ts";

export {
  INVITE_A_PERSON,
  OWNS_NOTHING,
  ASK,
  KNOWLEDGE,
  INBOX,
  CONTROL_CENTRE,
  CONSOLE,
  AREAS,
  EVERY_AREA,
} from "./navigation/areas.ts";
export type {
  Role,
  RoleOrOperator,
  Owns,
  Page,
  MenuGroup,
  Area,
  PagePath,
} from "./navigation/areas.ts";

type MenuGroupOf<Held extends Area> = Held["menuGroups"][number];

export const menuGroupIn = <Held extends Area, Id extends MenuGroupOf<Held>["id"]>(
  area: Held,
  id: Id,
): Extract<MenuGroupOf<Held>, { readonly id: Id }> => {
  const group = area.menuGroups.find(
    (candidate): candidate is Extract<MenuGroupOf<Held>, { readonly id: Id }> =>
      candidate.id === id,
  );
  if (group === undefined) throw new Error(`${area.name} has no group ${id}`);
  return group;
};

export const pageNamed = <Held extends MenuGroup>(
  group: Held,
  name: Held["pages"][number]["name"],
): Page => {
  const page = group.pages.find((candidate) => candidate.name === name);
  if (page === undefined) throw new Error(`${group.id} has no page named ${name}`);
  return page;
};

const NEW_QUESTION = pageNamed(menuGroupIn(ASK, "ask"), "New Question");

export const HOMES = {
  Admin: pageNamed(menuGroupIn(CONTROL_CENTRE, "people"), "Members"),
  Editor: NEW_QUESTION,
  Viewer: NEW_QUESTION,
  operator: pageNamed(menuGroupIn(CONSOLE, "workspaces"), "Every Workspace"),
} as const satisfies { readonly [who in RoleOrOperator]: Page };

export type Reader = {
  readonly role: RoleOrOperator | undefined;
  readonly owns: Owns;
};

export const readerOf = (role: RoleOrOperator | undefined, owns: Owns = OWNS_NOTHING): Reader => ({
  role,
  owns,
});

export const OPERATOR_READER: Reader = readerOf("operator");

export type VisibleArea = Area & { readonly opensAt: Page };

export type VisibleTree = {
  readonly areas: readonly VisibleArea[];
  readonly home: Page | undefined;
};

export const NO_TREE: VisibleTree = { areas: [], home: undefined };

const sees = (role: RoleOrOperator, owns: Owns, page: Page): boolean =>
  page.built &&
  (page.seenBy.includes(role) || (page.owners !== undefined && OWNING[page.owners](owns)));

const shownOf = (
  area: Area,
  seen: (page: Page) => boolean,
  home: Page,
): VisibleArea | undefined => {
  const shown = area.menuGroups
    .map((group) => ({ ...group, pages: group.pages.filter(seen) }))
    .filter((group) => group.pages.length > 0);
  const first = shown[0]?.pages[0];
  if (first === undefined) return undefined;

  const holdsHome = shown.some((group) => group.pages.includes(home));
  return {
    id: area.id,
    name: area.name,
    icon: area.icon,
    menuGroups: shown,
    opensAt: holdsHome ? home : first,
  };
};

export const visibleTo = (reader: Reader, areas: readonly Area[]): VisibleTree => {
  const { role, owns } = reader;
  if (role === undefined) return NO_TREE;

  const home = HOMES[role];
  const seen = (page: Page) => page === home || sees(role, owns, page);
  return {
    areas: areas.flatMap((area) => shownOf(area, seen, home) ?? []),
    home,
  };
};

export type Place<Held extends Area = Area> = {
  readonly area: Held;
  readonly menuGroup: MenuGroup | undefined;
  readonly page: Page;
  readonly detail?: string;
};

const placesIn = <Held extends Area>(area: Held): readonly Place<Held>[] =>
  area.menuGroups.flatMap((menuGroup) =>
    menuGroup.pages.map((page) => ({ area, menuGroup, page })),
  );

export const pagesOf = (areas: readonly Area[]): readonly Page[] =>
  areas.flatMap(placesIn).map(({ page }) => page);

const detailIn = (page: Page, pathname: string): string | undefined => {
  const beneath = `${page.path}/`;
  if (page.detail === undefined || !pathname.startsWith(beneath)) return undefined;
  const segment = pathname.slice(beneath.length);
  return segment === "" || segment.includes("/") ? undefined : segment;
};

export const placeAt = <Held extends Area>(
  areas: readonly Held[],
  pathname: string,
): Place<Held> | undefined => {
  const places = areas.flatMap(placesIn);
  const exact = places.find((place) => place.page.path === pathname);
  if (exact !== undefined) return exact;
  for (const place of places) {
    const detail = detailIn(place.page, pathname);
    if (detail !== undefined) return { ...place, detail };
  }
  return undefined;
};

export const detailAt = (page: Page, value: string): string => {
  if (page.detail === undefined) throw new Error(`${page.path} declares no detail address`);
  return `${page.path}/${encodeURIComponent(value)}`;
};

export const hides = (tree: VisibleTree, path: string): boolean =>
  tree.home !== undefined && placeAt(tree.areas, path) === undefined;

export const headingOf = (page: Page): string => {
  const place = placeAt(EVERY_AREA, page.path);
  return place?.menuGroup?.name ?? place?.area.name ?? page.name;
};

export type Moved = { readonly from: string; readonly to: readonly Page[] };

const movesOf = (from: readonly string[] = [], to: readonly Page[]): readonly Moved[] =>
  from.map((address) => ({ from: address, to }));

export const movedWithin = (areas: readonly Area[]): readonly Moved[] =>
  areas.flatMap((area) =>
    area.menuGroups.flatMap((group) => [
      ...movesOf(group.movedFrom, group.pages),
      ...group.pages.flatMap((page) => movesOf(page.movedFrom, [page])),
    ]),
  );

export const leadsTo = (tree: VisibleTree, moved: Moved): Page | undefined => {
  const shown = pagesOf(tree.areas);
  return moved.to.find((page) => shown.includes(page));
};
