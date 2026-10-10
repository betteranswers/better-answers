import { useState, type ReactNode } from "react";

import { useKeystroke } from "@/shared/keystrokes.tsx";
import { useReadSaid } from "@/shared/read-said.ts";
import { Button } from "@/shared/ui/button.tsx";
import { Checkbox } from "@/shared/ui/checkbox.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/shared/ui/collapsible.tsx";
import { Pill } from "@/shared/ui/kibo-ui/pill.tsx";
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
import { ReviewActions, RuleWord } from "./review-actions.tsx";
import {
  groupIsIn,
  groupKeyText,
  keyOf,
  useFindings,
  usePreview,
  type GroupOfFindings,
  type GroupOfFindingsKey,
  type ListedConnectedSource,
} from "./sources-api.ts";
import {
  groupsTickedIn,
  REVIEW_HEADING,
  SOURCES_KEYSTROKES,
  useTickedGroups,
} from "./sources-state.ts";
import { groupsCounted, REVIEW_WORDS, sentenceCased } from "./words.ts";

const NOTHING_FOUND = {
  received: "No sync has finished yet, so nothing has been found.",
  indexing: "The sync has not finished, so nothing has been found yet.",
  indexed: "The last sync found nothing to withhold in this connected source.",
  published: "The last sync found nothing to withhold in this connected source.",
} satisfies Record<ListedConnectedSource["state"], string>;

function Note(properties: { readonly tag: string; readonly children: ReactNode }) {
  return (
    <p className="mt-1">
      <Pill>{properties.tag}</Pill>{" "}
      <span className="text-muted-foreground">{properties.children}</span>
    </p>
  );
}

function GroupNotes(properties: {
  readonly group: GroupOfFindings;
  readonly narrowedBySeam: boolean;
}) {
  const { group, narrowedBySeam } = properties;
  return (
    <>
      <Pill>{group.sensitivity}</Pill>
      {narrowedBySeam ? (
        <Note tag={REVIEW_WORDS.alreadyNarrowed.tag}>{REVIEW_WORDS.alreadyNarrowed.says}</Note>
      ) : null}
      {group.dismissed === 0 ? null : (
        <Note tag={REVIEW_WORDS.dismissed.tag}>{REVIEW_WORDS.dismissed.says(group.dismissed)}</Note>
      )}
      {group.overriddenByErasure === 0 ? null : (
        <Note tag={REVIEW_WORDS.keptStillWithheld.tag}>
          {REVIEW_WORDS.keptStillWithheld.says(group.overriddenByErasure)}
        </Note>
      )}
    </>
  );
}

/** Its own component, so the region and the read's words it holds mount together, on opening. */
function PreviewPassages(properties: {
  readonly preview: ReturnType<typeof usePreview>;
  readonly open: boolean;
}) {
  const { preview } = properties;
  const said = useReadSaid(preview);

  return (
    <div aria-live="polite" className="mt-2">
      {said.isPending && properties.open ? <p>The passages are still loading.</p> : null}
      {said.error === null ? null : <p>{outcomeOfFailure(said.error, "read").words}</p>}
      {preview.data?.length === 0 ? <p>{REVIEW_WORDS.noPassages}</p> : null}
      {preview.data === undefined || preview.data.length === 0 ? null : (
        <ol className="grid gap-2">
          {preview.data.map((passage) => (
            <li key={passage.id} className="border border-border bg-muted p-3">
              {passage.content}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Preview(properties: { readonly connectedSource: ListedConnectedSource }) {
  const [open, setOpen] = useState(false);
  const preview = usePreview(properties.connectedSource.connectedSourceId, open);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-6">
      <CollapsibleTrigger asChild>
        <Button variant="link" size="sm" className="h-auto px-0 text-left whitespace-normal">
          Preview the passages a reader would see once published
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <p className="mt-2 text-muted-foreground">
          Seen by Admins here and by nobody else anywhere until the connected source is published.
        </p>
        <PreviewPassages preview={preview} open={open} />
      </CollapsibleContent>
    </Collapsible>
  );
}

function FindingsTable(properties: {
  readonly connectedSource: ListedConnectedSource;
  readonly groups: readonly GroupOfFindings[];
}) {
  const { connectedSource, groups } = properties;
  const [ticked, tick] = useTickedGroups();
  const [inFocus, setInFocus] = useState<GroupOfFindingsKey>();
  const selected = groupsTickedIn(ticked, connectedSource.connectedSourceId);

  const toggle = (group: GroupOfFindings) => {
    tick({
      connectedSourceId: connectedSource.connectedSourceId,
      groups: groupIsIn(selected, group)
        ? selected.filter((each) => !groupIsIn([keyOf(group)], each))
        : [...selected, group],
    });
  };
  useKeystroke(SOURCES_KEYSTROKES.select, () => {
    const group =
      inFocus === undefined ? undefined : groups.find((each) => groupIsIn([inFocus], each));
    if (group !== undefined) toggle(group);
  });

  /**
   * A dismissed span narrows nothing once a sync reads it, so only a span nobody dismissed says the
   * seam narrowed its document.
   */
  const narrowedBySeam = new Set(
    groups
      .filter((group) => group.specialCategory && group.dismissed < group.found)
      .map((group) => group.documentId),
  );

  return (
    <Table>
      <TableCaption>
        {groupsCounted(selected.length)} selected. Select a group with{" "}
        <kbd className="font-mono">{SOURCES_KEYSTROKES.select.key}</kbd>, then keep it in text,
        narrow its document or dismiss it as not special category with the actions above.
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
          <TableHead>Sensitivity</TableHead>
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
                checked={groupIsIn(selected, group)}
                onCheckedChange={() => {
                  toggle(group);
                }}
                aria-keyshortcuts={SOURCES_KEYSTROKES.select.key}
                aria-label={REVIEW_WORDS.select(group)}
              />
            </TableCell>
            <TableCell>
              {sentenceCased(group.category)}
              <span className="block text-muted-foreground">{sentenceCased(group.tier)}</span>
            </TableCell>
            <TableCell className="whitespace-normal">
              <RuleWord ruleId={group.ruleId} />
            </TableCell>
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

export function Review(properties: { readonly connectedSource: ListedConnectedSource }) {
  const { connectedSource } = properties;
  const findings = useFindings(connectedSource.connectedSourceId);
  const said = useReadSaid(findings);

  return (
    <section aria-labelledby={REVIEW_HEADING} className="mt-4 border-t border-border pt-4">
      <h4 id={REVIEW_HEADING} tabIndex={-1} className="font-medium text-foreground">
        {REVIEW_WORDS.heading(connectedSource.name)}
      </h4>
      <p className="mt-2 text-muted-foreground">{REVIEW_WORDS.lead}</p>

      <div aria-live="polite" className="mt-4">
        {said.isPending ? <p>The findings are still loading.</p> : null}
        {said.error === null ? null : <p>{outcomeOfFailure(said.error, "read").words}</p>}
        {findings.data?.length === 0 ? <p>{NOTHING_FOUND[connectedSource.state]}</p> : null}
      </div>
      {findings.data === undefined || findings.data.length === 0 ? null : (
        <>
          <ReviewActions connectedSourceId={connectedSource.connectedSourceId} />
          <FindingsTable connectedSource={connectedSource} groups={findings.data} />
        </>
      )}

      {connectedSource.state === "published" ? null : <Preview connectedSource={connectedSource} />}
    </section>
  );
}
