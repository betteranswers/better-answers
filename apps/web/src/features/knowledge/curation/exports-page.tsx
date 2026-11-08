import { useId, useState, type ReactNode } from "react";

import { ceilingLiftsIn, refusalOf, type ApiError, type RefusalWord } from "@/shared/api/trpc.ts";
import { Icon } from "@/shared/icon.tsx";
import { useKeystroke, usePageKeystrokes, type Keystroke } from "@/shared/keystrokes.tsx";
import { failedReadWords } from "@/shared/knowledge/refusal.tsx";
import { KNOWLEDGE, menuGroupIn, pageNamed } from "@/shared/navigation.ts";
import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { PageHead } from "@/shared/page/page-head.tsx";
import { refusalsOf, refusedWith } from "@/shared/refusal-outcome.tsx";
import { stockWait, type OwnSentences } from "@/shared/refusal-words.ts";
import { saveFile, type FileToSave } from "@/shared/save-file.ts";
import { Button } from "@/shared/ui/button.tsx";
import { Card } from "@/shared/ui/card.tsx";
import { Label } from "@/shared/ui/label.tsx";
import { NativeSelect, NativeSelectOption } from "@/shared/ui/native-select.tsx";

import {
  useExportGuide,
  useExportKnowledgeBase,
  useExportRecords,
  useGuides,
  type GuideExported,
  type GuideSummary,
  type KnowledgeBaseExported,
  type RecordsExported,
} from "../knowledge-api.ts";
import { EXPORTS_KEYSTROKES as KEY } from "./curation-state.ts";
import {
  EXPORTS_WORDS as WORDS,
  SAID_OF_EXPORTED_GUIDE,
  SAID_OF_EXPORTED_KNOWLEDGE_BASE,
  SAID_OF_EXPORTED_RECORDS,
} from "./curation-words.ts";
import { bytesOfBase64, MARKDOWN, ZIP } from "./file-bytes.ts";

const CURATION = menuGroupIn(KNOWLEDGE, "curation");

const EXPORTS_PAGE = pageNamed(CURATION, "Exports");

const LISTED = Object.values(KEY);

const NO_GUIDES: readonly GuideSummary[] = [];

const ANSWERED_BY_THE_DIALOG = "confirmation-too-old" satisfies RefusalWord;

type Say = (outcome: Outcome | undefined) => void;

type Named = { readonly name: string; readonly keystroke: Keystroke };

type Way<Answer> = Named & {
  readonly file: (answer: Answer) => FileToSave;
  readonly saved: (answer: Answer) => string;
  readonly failed: (failure: Error | ApiError) => Outcome;
};

type Callbacks<Answer> = {
  readonly onSuccess: (answer: Answer) => void;
  readonly onError: (failure: Error | ApiError) => void;
};

type Exporting<Answer> = {
  readonly pending: boolean;
  readonly start: ((callbacks: Callbacks<Answer>) => void) | undefined;
};

type Download = {
  readonly pending: boolean;
  readonly off: boolean;
  readonly run: () => void;
  readonly id: string;
};

const failureOf = (said: OwnSentences) => {
  const { outcomeOfFailure } = refusalsOf(said);
  return (failure: Error | ApiError): Outcome => {
    const liftsInSeconds = ceilingLiftsIn(failure);
    return liftsInSeconds === undefined
      ? outcomeOfFailure(failure, "action")
      : refusedWith(stockWait(liftsInSeconds));
  };
};

const KNOWLEDGE_BASE: Way<KnowledgeBaseExported> = {
  name: WORDS.knowledgeBase.name,
  keystroke: KEY.knowledgeBase,
  file: ({ name, base64 }) => ({ name, type: ZIP, content: bytesOfBase64(base64) }),
  saved: ({ name, files }) => WORDS.knowledgeBase.saved(name, files),
  failed: failureOf(SAID_OF_EXPORTED_KNOWLEDGE_BASE),
};

const RECORDS: Way<RecordsExported> = {
  name: WORDS.records.name,
  keystroke: KEY.records,
  file: ({ name, base64 }) => ({ name, type: ZIP, content: bytesOfBase64(base64) }),
  saved: ({ name, families }) => WORDS.records.saved(name, families),
  failed: failureOf(SAID_OF_EXPORTED_RECORDS),
};

const GUIDE: Way<GuideExported> = {
  name: WORDS.guide.name,
  keystroke: KEY.guide,
  file: ({ name, markdown }) => ({ name, type: MARKDOWN, content: markdown }),
  saved: ({ name, sections }) => WORDS.guide.saved(name, sections),
  failed: failureOf(SAID_OF_EXPORTED_GUIDE),
};

/** The mutation saves the file itself, so a person who leaves the page mid-export still receives it. */
const saveIn =
  <Answer,>(way: Way<Answer>) =>
  (answer: Answer): void => {
    saveFile(way.file(answer));
  };

function useDownload<Answer>(way: Way<Answer>, exporting: Exporting<Answer>, say: Say): Download {
  const { pending, start } = exporting;
  const off = pending || start === undefined;
  const id = useId();
  const run = () => {
    if (off) return;
    say({ tone: "said", words: WORDS.preparingSaid(way.name) });
    start({
      onSuccess: (answer) => {
        say({ tone: "said", words: way.saved(answer) });
        if (document.activeElement === document.body) document.getElementById(id)?.focus();
      },
      onError: (failure) => {
        say(refusalOf(failure)?.word === ANSWERED_BY_THE_DIALOG ? undefined : way.failed(failure));
      },
    });
  };
  useKeystroke(way.keystroke, run);
  return { pending, off, run, id };
}

function DownloadButton(properties: { readonly of: Named; readonly download: Download }) {
  const { of, download } = properties;
  return (
    <Button
      id={download.id}
      type="button"
      variant="outline"
      aria-disabled={download.off}
      aria-keyshortcuts={of.keystroke.key}
      className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
      onClick={download.run}
    >
      <Icon name="exports" />
      {download.pending ? WORDS.preparing : WORDS.download}
      <span className="sr-only">{WORDS.ofThe(of.name)}</span>
    </Button>
  );
}

function ExportRow(properties: {
  readonly name: string;
  readonly holds: string;
  readonly children: ReactNode;
}) {
  const headingId = useId();
  return (
    <li aria-labelledby={headingId} className="border-t border-border px-4 py-4 first:border-t-0">
      <h3 id={headingId} className="font-medium text-foreground">
        {properties.name}
      </h3>
      <p className="mt-1 text-muted-foreground">{properties.holds}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">{properties.children}</div>
    </li>
  );
}

function KnowledgeBaseExport(properties: { readonly say: Say }) {
  const exporting = useExportKnowledgeBase(saveIn(KNOWLEDGE_BASE));
  const download = useDownload(
    KNOWLEDGE_BASE,
    {
      pending: exporting.isPending,
      start: (callbacks) => {
        exporting.mutate({}, callbacks);
      },
    },
    properties.say,
  );
  return (
    <ExportRow name={KNOWLEDGE_BASE.name} holds={WORDS.knowledgeBase.holds}>
      <DownloadButton of={KNOWLEDGE_BASE} download={download} />
    </ExportRow>
  );
}

function RecordsExport(properties: { readonly say: Say }) {
  const exporting = useExportRecords(saveIn(RECORDS));
  const download = useDownload(
    RECORDS,
    {
      pending: exporting.isPending,
      start: (callbacks) => {
        exporting.mutate({}, callbacks);
      },
    },
    properties.say,
  );
  return (
    <ExportRow name={RECORDS.name} holds={WORDS.records.holds}>
      <DownloadButton of={RECORDS} download={download} />
    </ExportRow>
  );
}

type GuidesRead = ReturnType<typeof useGuides>;

function GuidesUnread(properties: { readonly read: GuidesRead }) {
  const { error, refetch } = properties.read;
  if (error === null) {
    return <output className="text-muted-foreground">{WORDS.guide.loading}</output>;
  }
  return (
    <>
      <p role="alert">{failedReadWords(error)}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          void refetch();
        }}
      >
        {WORDS.guide.retry}
      </Button>
    </>
  );
}

function GuideChoice(properties: {
  readonly guides: readonly GuideSummary[];
  readonly chosen: string;
  readonly onChoose: (guideId: string) => void;
}) {
  const pickerId = useId();
  return (
    <>
      <Label htmlFor={pickerId}>{WORDS.guide.picker}</Label>
      <NativeSelect
        id={pickerId}
        size="sm"
        value={properties.chosen}
        onChange={(event) => {
          properties.onChoose(event.target.value);
        }}
      >
        {properties.guides.map((guide) => (
          <NativeSelectOption key={guide.guideId} value={guide.guideId}>
            {WORDS.guide.option(guide)}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </>
  );
}

function GuideControls(properties: {
  readonly read: GuidesRead;
  readonly chosen: string | undefined;
  readonly onChoose: (guideId: string) => void;
  readonly download: Download;
}) {
  const { read, chosen, onChoose, download } = properties;
  if (read.data === undefined) return <GuidesUnread read={read} />;
  if (chosen === undefined) return <p className="text-muted-foreground">{WORDS.guide.none}</p>;
  return (
    <>
      <GuideChoice guides={read.data} chosen={chosen} onChoose={onChoose} />
      <DownloadButton of={GUIDE} download={download} />
    </>
  );
}

function GuideExport(properties: { readonly say: Say }) {
  const read = useGuides();
  const exporting = useExportGuide(saveIn(GUIDE));
  const [picked, setPicked] = useState<string>();
  const listed = read.data ?? NO_GUIDES;
  const guideId = listed.find((guide) => guide.guideId === picked)?.guideId ?? listed[0]?.guideId;
  const download = useDownload(
    GUIDE,
    {
      pending: exporting.isPending,
      start:
        guideId === undefined
          ? undefined
          : (callbacks) => {
              exporting.mutate({ guideId }, callbacks);
            },
    },
    properties.say,
  );

  return (
    <ExportRow name={GUIDE.name} holds={WORDS.guide.holds}>
      <GuideControls read={read} chosen={guideId} onChoose={setPicked} download={download} />
    </ExportRow>
  );
}

const EXPORTS = [
  { id: "knowledge-base", Export: KnowledgeBaseExport },
  { id: "records", Export: RecordsExport },
  { id: "guide", Export: GuideExport },
] as const;

function ExportsRegion() {
  const headingId = useId();
  const [outcome, say] = useState<Outcome>();

  return (
    <section aria-labelledby={headingId} className="mt-6">
      <h2 id={headingId} className="sr-only">
        {EXPORTS_PAGE.name}
      </h2>
      <OutcomeLine outcome={outcome} className="mt-2" />
      <Card marks className="mt-4">
        <ul>
          {EXPORTS.map(({ id, Export }) => (
            <Export key={id} say={say} />
          ))}
        </ul>
      </Card>
    </section>
  );
}

export function ExportsPage() {
  usePageKeystrokes(LISTED);

  return (
    <>
      <PageHead title={EXPORTS_PAGE.name} />
      <ExportsRegion />
    </>
  );
}
