export type FileToSave = {
  readonly name: string;
  readonly type: string;
  readonly content: BlobPart;
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
