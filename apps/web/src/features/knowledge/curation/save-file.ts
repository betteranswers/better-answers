export type FileToSave = {
  readonly name: string;
  readonly type: string;
  readonly content: BlobPart;
};

export const ZIP = "application/zip";

export const MARKDOWN = "text/markdown;charset=utf-8";

export const bytesOfBase64 = (base64: string): Uint8Array<ArrayBuffer> => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at);
  return bytes;
};

export const saveFile = ({ name, type, content }: FileToSave): void => {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 0);
};
