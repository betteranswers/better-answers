import { useState } from "react";

import { useKeystroke } from "@/shared/keystrokes.tsx";
import { Badge } from "@/shared/ui/badge.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { Checkbox } from "@/shared/ui/checkbox.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/shared/ui/collapsible.tsx";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui/table.tsx";

import { outcomeOfFailure } from "./refusal.tsx";
import { KeepInTextAct, NarrowDocumentsAct } from "./review-acts.tsx";
import {
  groupIsIn,
  groupKeyText,
  keyOf,
  useFindings,
  usePreview,
  type FindingGroup,
  type FindingGroupKey,
  type ListedBinding,
} from "./sources-api.ts";
import { SOURCES_KEYSTROKES, useTickedGroups } from "./sources-state.ts";
import { counted, spokenWord } from "./words.ts";

const NOTHING_FOUND = {
  landed: "No index run has finished yet, so nothing has been found.",
  indexing: "The index run has not finished, so nothing has been found yet.",
  indexed: "The last run found nothing to withhold in this binding.",
  published: "The last run found nothing to withhold in this binding.",
} satisfies Record<ListedBinding["state"], string>;

function GroupNotes(properties: {
  readonly group: FindingGroup;
  readonly narrowedBySeam: boolean;
}) {
  const { group, narrowedBySeam } = properties;
  return (
    <>
      <Badge variant="outline">{group.sensitivity}</Badge>
      {narrowedBySeam ? (
        <p className="mt-1">
          <Badge variant="outline">Already narrowed</Badge>{" "}
          <span className="text-muted-foreground">
            A special category finding narrowed this document at the seam.
          </span>
        </p>
      ) : null}
      {group.overriddenByErasure === 0 ? null : (
        <p className="mt-1">
          <Badge variant="outline">Kept, still withheld</Badge>{" "}
          <span className="text-muted-foreground">
            {counted(group.overriddenByErasure, "kept span", "kept spans")} overridden by an erasure
            request: an erasure outranks a keep.
          </span>
        </p>
      )}
    </>
  );
}

function Preview(properties: { readonly binding: ListedBinding }) {
  const [open, setOpen] = useState(false);
  const preview = usePreview(properties.binding.bindingId, open);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-6">
      <CollapsibleTrigger asChild>
        <Button variant="link" size="sm" className="h-auto px-0 text-left whitespace-normal">
          Preview the chunks a reader would see once published
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p className="mt-2 text-muted-foreground">
          Seen by Admins here and by nobody else anywhere until the binding is published.
        </p>
        <div aria-live="polite" className="mt-2">
          {preview.isPending && open ? <p>The chunks are still loading.</p> : null}
          {preview.error === null ? null : <p>{outcomeOfFailure(preview.error).words}</p>}
          {preview.data?.length === 0 ? <p>No chunk has landed yet.</p> : null}
          {preview.data === undefined || preview.data.length === 0 ? null : (
            <ol className="grid gap-2">
              {preview.data.map((chunk) => (
                <li key={chunk.id} className="border border-border bg-muted p-3">
                  {chunk.content}
                </li>
              ))}
            </ol>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function FindingsTable(properties: {
  readonly binding: ListedBinding;
  readonly groups: readonly FindingGroup[];
}) {
  const { binding, groups } = properties;
  const [ticked, tick] = useTickedGroups();
  const [inFocus, setInFocus] = useState<FindingGroupKey>();
  const held = ticked?.bindingId === binding.bindingId ? ticked.groups : [];

  const toggle = (group: FindingGroup) => {
    tick({
      bindingId: binding.bindingId,
      groups: groupIsIn(held, group)
        ? held.filter((each) => !groupIsIn([keyOf(group)], each))
        : [...held, group],
    });
  };
  useKeystroke(SOURCES_KEYSTROKES.select, () => {
    const group =
      inFocus === undefined ? undefined : groups.find((each) => groupIsIn([inFocus], each));
    if (group !== undefined) toggle(group);
  });

  const narrowedBySeam = new Set(
    groups.filter((group) => group.specialCategory).map((group) => group.documentId),
  );

  return (
    <Table>
      <TableCaption>
        {counted(held.length, "finding group", "finding groups")} selected. Select a group with{" "}
        <kbd className="font-mono">{SOURCES_KEYSTROKES.select.key}</kbd>, then keep it in text or
        narrow its document with the acts above.
      </TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>
            <span className="sr-only">Selected</span>
          </TableHead>
          <TableHead>Category</TableHead>
          <TableHead>Rule</TableHead>
          <TableHead>Document</TableHead>
          <TableHead className="text-right">Found</TableHead>
          <TableHead>Class</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {groups.map((group) => (
          <TableRow key={groupKeyText(group)}>
            <TableCell>
              <Checkbox
                onFocus={() => {
                  setInFocus(keyOf(group));
                }}
                checked={groupIsIn(held, group)}
                onCheckedChange={() => {
                  toggle(group);
                }}
                aria-keyshortcuts={SOURCES_KEYSTROKES.select.key}
                aria-label={`Select ${spokenWord(group.category)} by ${group.ruleId} in ${group.title}`}
              />
            </TableCell>
            <TableCell>
              {spokenWord(group.category)}
              <span className="block text-muted-foreground">{spokenWord(group.tier)}</span>
            </TableCell>
            <TableCell className="font-mono">{group.ruleId}</TableCell>
            <TableCell className="whitespace-normal">{group.title}</TableCell>
            <TableCell className="text-right tabular-nums">{group.found}</TableCell>
            <TableCell className="whitespace-normal">
              <GroupNotes group={group} narrowedBySeam={narrowedBySeam.has(group.documentId)} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export const REVIEW_HEADING = "review-of-the-binding";

export function Review(properties: { readonly binding: ListedBinding }) {
  const { binding } = properties;
  const findings = useFindings(binding.bindingId);

  return (
    <section aria-labelledby={REVIEW_HEADING} className="mt-8 border-t border-border pt-6">
      <h2 id={REVIEW_HEADING} tabIndex={-1}>
        Review of {binding.name}
      </h2>
      <p className="mt-2 text-muted-foreground">
        What the last run found, per category and rule, counted. No value is shown: the two acts
        take a finding group, never what it found.
      </p>

      <div aria-live="polite" className="mt-4">
        {findings.isPending ? <p>The findings are still loading.</p> : null}
        {findings.error === null ? null : <p>{outcomeOfFailure(findings.error).words}</p>}
        {findings.data?.length === 0 ? <p>{NOTHING_FOUND[binding.state]}</p> : null}
      </div>
      {findings.data === undefined || findings.data.length === 0 ? null : (
        <>
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
            <KeepInTextAct bindingId={binding.bindingId} />
            <NarrowDocumentsAct bindingId={binding.bindingId} />
          </div>
          <FindingsTable binding={binding} groups={findings.data} />
        </>
      )}

      {binding.state === "published" ? null : <Preview binding={binding} />}
    </section>
  );
}
