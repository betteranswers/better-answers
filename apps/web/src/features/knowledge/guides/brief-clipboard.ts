import type { BriefCopied } from "../knowledge-api.ts";
import { GUIDE_WORDS as WORDS } from "./guide-words.ts";

export type Copying =
  | { readonly kind: "copied"; readonly copy: BriefCopied; readonly recorded: boolean }
  | { readonly kind: "not-allowed" };

const blobOf = (
  reading: Promise<BriefCopied>,
  type: string,
  pick: (copy: BriefCopied) => string,
): Promise<Blob> => {
  const blob = reading.then((copy) => new Blob([pick(copy)], { type }));
  blob.catch(() => undefined);
  return blob;
};

/** The write starts before the read answers, so it keeps the gesture that asked for it. */
const written = (reading: Promise<BriefCopied>): Promise<boolean> => {
  try {
    const item = new ClipboardItem({
      "text/html": blobOf(reading, "text/html", (copy) => copy.html),
      "text/plain": blobOf(reading, "text/plain", (copy) => copy.text),
    });
    return navigator.clipboard.write([item]).then(
      () => true,
      () => false,
    );
  } catch {
    return Promise.resolve(false);
  }
};

export const copyBrief = async (
  read: () => Promise<BriefCopied>,
  record: (copy: BriefCopied) => Promise<void>,
): Promise<Copying> => {
  const reading = read();
  const allowed = await written(reading);
  const copy = await reading;
  if (!allowed) return { kind: "not-allowed" };
  const recorded = await record(copy).then(
    () => true,
    () => false,
  );
  return { kind: "copied", copy, recorded };
};

export const copyingWords = (number: string, copying: Copying): string => {
  if (copying.kind === "not-allowed") return WORDS.notAllowed;
  const copied = WORDS.copied(number, copying.copy.footnotes);
  return copying.recorded ? copied : `${copied} ${WORDS.notRecorded}`;
};
