import { useState } from "react";

/** A row a read no longer lists stays as last read while it is still the one asked for, so its sheet stays open. */
export const useLastRead = <Row extends { readonly id: string }>(
  rows: readonly Row[],
  id: string | undefined,
): Row | undefined => {
  const found = rows.find((listed) => listed.id === id);
  const [lastRead, setLastRead] = useState(found);
  if (found !== undefined && found !== lastRead) setLastRead(found);
  return found ?? (lastRead?.id === id ? lastRead : undefined);
};
