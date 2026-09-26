import { useQuery } from "@tanstack/react-query";
import type { inferOutput } from "@trpc/tanstack-react-query";
import { useId } from "react";

import { useTRPC } from "@/shared/api/trpc.ts";
import { RefusalLine } from "@/shared/refusal-outcome.tsx";
import { consoleScreenById } from "@/shared/screens.ts";
import { Button } from "@/shared/ui/button.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/shared/ui/collapsible.tsx";
import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";
import { counted, dayWords } from "@/shared/words.ts";

import { Facts } from "./facts.tsx";
import { readRefused } from "./words.ts";

type ListedWorkspace = inferOutput<
  ReturnType<typeof useTRPC>["console"]["workspaces"]["list"]
>[number];

const workspaces = consoleScreenById("workspaces");

const useWorkspaces = () => {
  const api = useTRPC();
  return useQuery(api.console.workspaces.list.queryOptions());
};

const TERM = "text-muted-foreground";

function WorkspaceItem(properties: { readonly workspace: ListedWorkspace }) {
  const { workspace } = properties;
  const headingId = useId();

  return (
    <li
      aria-labelledby={headingId}
      className="border-t border-border py-4 first:border-t-0 first:pt-0"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 id={headingId} className="font-medium text-foreground">
          {workspace.name}
        </h3>
        <Pill>{counted(workspace.memberCount, "member", "members")}</Pill>
      </div>

      <Facts>
        <dt className={TERM}>Slug</dt>
        <dd>
          <code className="font-mono break-all">{workspace.slug}</code>
        </dd>
        <dt className={TERM}>Provisioned</dt>
        <dd>{dayWords(workspace.createdAt)}</dd>
      </Facts>

      {/* The one disclosure: what an ops command needs, never what the list is read for. */}
      <Collapsible className="mt-2">
        <CollapsibleTrigger asChild>
          <Button variant="link" size="sm" className="h-auto px-0 text-left whitespace-normal">
            More about {workspace.name}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <Facts>
            <dt className={TERM}>Workspace id</dt>
            <dd>
              <code className="font-mono break-all">{workspace.id}</code>
            </dd>
          </Facts>
          <p className="mt-1 text-muted-foreground">
            An ops command names this workspace by its id, after <code>--workspace</code>.
          </p>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}

function ListState(properties: { readonly listed: ReturnType<typeof useWorkspaces> }) {
  const { listed } = properties;
  if (listed.isPending) return <p>The workspaces are still loading.</p>;
  if (listed.error !== null) {
    return (
      <p>
        <RefusalLine {...readRefused(listed.error)} />
      </p>
    );
  }
  if (listed.data.length === 0) {
    return (
      <p>
        No workspace is provisioned yet. The ops command <code>provision-workspace</code> makes the
        first.
      </p>
    );
  }
  return <p>{counted(listed.data.length, "workspace", "workspaces")} on the platform.</p>;
}

export function WorkspacesView() {
  const listed = useWorkspaces();
  const listId = useId();

  return (
    <>
      <h1>{workspaces.name}</h1>
      <p className="mt-2 text-muted-foreground">{workspaces.summary}</p>

      <section aria-labelledby={listId} className="mt-6">
        <h2 id={listId}>Every workspace</h2>

        <div aria-live="polite" className="mt-2 text-muted-foreground">
          <ListState listed={listed} />
        </div>

        {/* A refused read of it again leaves nothing listed: what it held may no longer be theirs. */}
        {listed.error !== null || listed.data === undefined || listed.data.length === 0 ? null : (
          <ul className="mt-4">
            {listed.data.map((workspace) => (
              <WorkspaceItem key={workspace.id} workspace={workspace} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
