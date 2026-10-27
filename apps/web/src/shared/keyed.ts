type Keyed<T> = { readonly key: string; readonly item: T };

export const keyed = <T>(
  items: readonly T[],
  identity: (item: T) => string,
): readonly Keyed<T>[] => {
  const seen = new Map<string, number>();
  return items.map((item) => {
    const id = identity(item);
    const repeats = seen.get(id) ?? 0;
    seen.set(id, repeats + 1);
    return { key: `${id}#${String(repeats)}`, item };
  });
};
