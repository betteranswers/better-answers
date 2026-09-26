import { ulid } from "@better-answers/schema/ulid";
import { useId, useState, type FormEvent } from "react";

import { ActDialog } from "@/shared/act-dialog.tsx";
import { watchUpload, type UploadProgress } from "@/shared/api/upload-progress.ts";
import { useKeystroke } from "@/shared/keystrokes.tsx";
import { OutcomeLine, type Outcome } from "@/shared/outcome.tsx";
import { Button } from "@/shared/ui/button.tsx";
import { Input } from "@/shared/ui/input.tsx";
import { Label } from "@/shared/ui/label.tsx";
import { Progress } from "@/shared/ui/progress.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select.tsx";

import { outcomeOfFailure, refusedFor } from "./refusal.tsx";
import { CLASSES, EVERYONE, NARROWEST, useBind } from "./sources-api.ts";
import { SOURCES_KEYSTROKES } from "./sources-state.ts";
import { AUDIENCE_WORDS, UPLOAD_CAP_MB } from "./words.ts";

const UPLOAD_BYTE_CAP = UPLOAD_CAP_MB * 1024 * 1024;

/**
 * The api's allow-list, stated not imported: the web takes nothing from the api at runtime, and
 * the api refuses alike.
 */
const MEDIA_TYPE_OF_EXTENSION = new Map([
  ["md", "text/markdown"],
  ["markdown", "text/markdown"],
  ["txt", "text/plain"],
  ["docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  ["pdf", "application/pdf"],
]);

const MEDIA_TYPES = new Set(MEDIA_TYPE_OF_EXTENSION.values());

const ACCEPTED = [
  ...[...MEDIA_TYPE_OF_EXTENSION.keys()].map((extension) => `.${extension}`),
  ...MEDIA_TYPES,
].join(",");

/**
 * A browser names a markdown file's type inconsistently, so the extension decides where it is
 * silent.
 */
const mediaTypeOf = (file: File): string | undefined => {
  if (MEDIA_TYPES.has(file.type)) return file.type;
  return MEDIA_TYPE_OF_EXTENSION.get(file.name.split(".").at(-1)?.toLowerCase() ?? "");
};

type Uploading = UploadProgress & { readonly fileName: string };

const percentOf = (uploading: Uploading): number =>
  uploading.totalBytes === 0 ? 0 : Math.round((uploading.sentBytes / uploading.totalBytes) * 100);

const textOf = (form: FormData, field: string): string => {
  const value = form.get(field);
  return typeof value === "string" ? value.trim() : "";
};

export function BindAct() {
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>();
  const [uploading, setUploading] = useState<Uploading>();
  const bind = useBind();
  const ids = {
    form: useId(),
    name: useId(),
    sensitivity: useId(),
    audience: useId(),
    file: useId(),
  };

  const show = () => {
    setOutcome(undefined);
    setOpen(true);
  };
  useKeystroke(SOURCES_KEYSTROKES.bind, show);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const file = form.get("file");
    if (!(file instanceof File)) return;

    const mediaType = mediaTypeOf(file);
    if (mediaType === undefined) {
      setOutcome(refusedFor("media-type-refused", "inapplicable"));
      return;
    }
    if (file.size > UPLOAD_BYTE_CAP) {
      setOutcome(refusedFor("too-large", "inapplicable"));
      return;
    }

    const name = textOf(form, "name");
    const bindingId = ulid();
    setOutcome(undefined);
    setUploading({ fileName: file.name, sentBytes: 0, totalBytes: file.size });
    const unwatch = watchUpload(bindingId, (progress) => {
      setUploading({ fileName: file.name, ...progress });
    });

    bind.mutate(
      {
        file,
        descriptor: {
          bindingId,
          name,
          fileName: file.name,
          mediaType,
          byteSize: file.size,
          sensitivity: textOf(form, "sensitivity"),
          audience: EVERYONE,
        },
      },
      {
        onSuccess: () => {
          setOpen(false);
          setOutcome({
            tone: "said",
            words: `Bound “${name}”: ${file.name} landed and its index run is queued.`,
          });
        },
        onError: (failure) => {
          setOutcome(outcomeOfFailure(failure));
        },
        onSettled: () => {
          unwatch();
          setUploading(undefined);
        },
      },
    );
  };

  return (
    <>
      {/* Heard, not seen: the new row is what the eye reads, and the band has no width at 320px. */}
      <OutcomeLine outcome={open ? undefined : outcome} className="sr-only" />
      <Button size="sm" aria-keyshortcuts={SOURCES_KEYSTROKES.bind.key} onClick={show}>
        Bind a document
      </Button>
      <ActDialog
        open={open}
        onOpenChange={setOpen}
        title="Bind a document"
        consequence="The binding starts unpublished: nobody but an Admin reads a word of it until you publish it. Its index run starts once the file lands."
        commit={
          <Button type="submit" form={ids.form} disabled={bind.isPending}>
            {bind.isPending ? "Binding the document" : "Bind the document"}
          </Button>
        }
      >
        <form id={ids.form} onSubmit={submit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor={ids.name}>Name</Label>
            <Input id={ids.name} name="name" required autoComplete="off" />
          </div>

          <div className="grid gap-2">
            <Label htmlFor={ids.sensitivity}>Class</Label>
            <Select name="sensitivity" defaultValue={NARROWEST}>
              <SelectTrigger id={ids.sensitivity}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CLASSES.map((word) => (
                  <SelectItem key={word} value={word}>
                    {word}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor={ids.audience}>Audience</Label>
            <Select name="audience" defaultValue={EVERYONE}>
              <SelectTrigger id={ids.audience} aria-describedby={`${ids.audience}-hint`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={EVERYONE}>{AUDIENCE_WORDS.everyone}</SelectItem>
                <SelectItem value="groups" disabled>
                  {AUDIENCE_WORDS.groups}
                </SelectItem>
              </SelectContent>
            </Select>
            <p id={`${ids.audience}-hint`} className="text-sm text-muted-foreground">
              Named groups are chosen here once the People screen lists them.
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor={ids.file}>File</Label>
            <Input
              id={ids.file}
              name="file"
              type="file"
              required
              accept={ACCEPTED}
              aria-describedby={`${ids.file}-hint`}
            />
            <p id={`${ids.file}-hint`} className="text-sm text-muted-foreground">
              Markdown, plain text, Word (.docx) or PDF, up to {UPLOAD_CAP_MB} MB.
            </p>
          </div>

          {uploading === undefined ? null : (
            <div className="grid gap-2">
              <Progress
                value={percentOf(uploading)}
                aria-label={`Upload of ${uploading.fileName}`}
                aria-valuetext={`${uploading.sentBytes} of ${uploading.totalBytes} bytes sent`}
              />
              <p className="text-sm text-muted-foreground">
                {uploading.sentBytes} of {uploading.totalBytes} bytes of {uploading.fileName} sent.
              </p>
            </div>
          )}

          <OutcomeLine outcome={outcome} className="text-sm" />
        </form>
      </ActDialog>
    </>
  );
}
