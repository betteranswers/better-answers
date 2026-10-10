import { useQuery } from "@tanstack/react-query";
import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import type { inferOutput } from "@trpc/tanstack-react-query";
import { useId } from "react";

import { useTRPC } from "@/shared/api/trpc.ts";
import { FilterRow } from "@/shared/filter-row.tsx";
import { GridTable } from "@/shared/grid-table.tsx";
import { usePageKeystrokes } from "@/shared/keystrokes.tsx";
import { CONSOLE, menuGroupIn } from "@/shared/navigation.ts";
import { ListHead, PageHead } from "@/shared/page-head.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { Card } from "@/shared/ui/card.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/shared/ui/collapsible.tsx";
import { useHiddenColumns } from "@/shared/wide-layout.ts";
import { counted, dayWords } from "@/shared/words.ts";

import { Facts } from "./facts.tsx";
import { countOf, NothingListed, ReadSaid, useNarrowedRows } from "./list-parts.tsx";
import { WORKSPACES_WORDS as WORDS } from "./list-words.ts";
import { WORKSPACES_KEYSTROKES } from "./people-keystrokes.ts";

type ListedWorkspace = inferOutput<
  ReturnType<typeof useTRPC>["console"]["workspaces"]["list"]
>[number];

const workspaces = menuGroupIn(CONSOLE, "workspaces");

const LISTED = Object.values(WORKSPACES_KEYSTROKES);

const useWorkspaces = () => {
  const api = useTRPC();
  return useQuery(api.console.workspaces.list.queryOptions());
};

const features = tableFeatures({});

const column = createColumnHelper<typeof features, ListedWorkspace>();

function WorkspaceCell(properties: { readonly workspace: ListedWorkspace }) {
  const { workspace } = properties;
  return (
    <div className="grid justify-items-start gap-0.5">
      <span className="font-medium wrap-anywhere">{workspace.name}</span>
      {/* The one disclosure: what an ops command needs, never what the list is read for. */}
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button
            variant="link"
            size="sm"
            className="h-auto px-0 text-left wrap-anywhere whitespace-normal"
          >
            {WORDS.moreAbout(workspace.name)}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <Facts>
            <dt className="text-muted-foreground">Workspace id</dt>
            <dd>
              <code className="font-mono break-all">{workspace.id}</code>
            </dd>
          </Facts>
          <p className="mt-1 text-muted-foreground">
            An ops command names this workspace by its id, after <code>--workspace</code>.
          </p>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

const HEADS = WORDS.columns;

const columns = column.columns([
  column.display({
    id: "workspace",
    header: HEADS.workspace,
    cell: ({ row }) => <WorkspaceCell workspace={row.original} />,
  }),
  column.accessor("shortName", {
    header: HEADS.shortName,
    cell: ({ getValue }) => <code className="font-mono break-all">{getValue()}</code>,
  }),
  column.accessor("memberCount", {
    header: HEADS.memberCount,
    cell: ({ getValue }) => counted(getValue(), "member", "members"),
  }),
  column.accessor("createdAt", {
    header: HEADS.createdAt,
    cell: ({ getValue }) => dayWords(getValue()),
  }),
]);

/** Every column but the workspace can hide, so a row always says which it is. */
const HIDEABLE = [
  { id: "shortName", label: HEADS.shortName },
  { id: "memberCount", label: HEADS.memberCount },
  { id: "createdAt", label: HEADS.createdAt },
] as const;

/** Four columns outrun a narrow window, so it opens on two; the rest can be shown again. */
const NARROW_HIDES: ReadonlySet<string> = new Set(["memberCount", "createdAt"]);

const NO_WORKSPACE: readonly ListedWorkspace[] = [];

const wordsOf = (workspace: ListedWorkspace): string => `${workspace.name}\n${workspace.shortName}`;

function NoneProvisioned() {
  return (
    <p className="px-4 py-10">
      No workspace is provisioned yet. The ops command <code>provision-workspace</code> makes the
      first.
    </p>
  );
}

function WorkspacesList() {
  const headingId = useId();
  const listed = useWorkspaces();
  const [hidden, setHidden] = useHiddenColumns(NARROW_HIDES);
  // A refused read of it again leaves nothing listed: what it held may no longer be theirs.
  const read = listed.error === null ? listed.data : undefined;
  const narrowed = useNarrowedRows(read ?? NO_WORKSPACE, wordsOf);
  const table = useTable({
    features,
    columns,
    data: narrowed.shown,
    getRowId: (workspace) => workspace.id,
  });

  return (
    <section aria-labelledby={headingId} className="mt-6">
      <ListHead
        heading={WORDS.heading}
        headingId={headingId}
        description={WORDS.description}
        count={read === undefined ? "" : countOf(WORDS, read.length, narrowed)}
      />
      <ReadSaid read={listed} loading={WORDS.loading} />

      <Card className="mt-4">
        {/* Drawn whatever the read says, so a refused read of it again takes no focus from the search. */}
        <FilterRow
          search={{
            label: WORDS.search,
            value: narrowed.typed,
            onChange: narrowed.setTyped,
            keystroke: WORKSPACES_KEYSTROKES.search,
            inputRef: narrowed.searchRef,
          }}
          columns={{ columns: HIDEABLE, hidden, onHiddenChange: setHidden }}
        />
        {read === undefined ? null : (
          <GridTable
            table={table}
            caption={WORDS.caption}
            hidden={hidden}
            empty={
              <NothingListed
                search={narrowed.search}
                noneMatch={WORDS.noneMatch}
                onClear={narrowed.clear}
                searchRef={narrowed.searchRef}
              >
                <NoneProvisioned />
              </NothingListed>
            }
          />
        )}
      </Card>
    </section>
  );
}

export function WorkspacesPage() {
  usePageKeystrokes(LISTED);

  return (
    <>
      <PageHead heading={workspaces.name} summary={workspaces.summary} />
      <WorkspacesList />
    </>
  );
}
