export const pruneUndefinedKeys = <T extends Record<string, unknown>>(
  value: T | undefined,
): Partial<T> | undefined => {
  if (!value) return undefined;

  const nextValue = Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as Partial<T>;

  return Object.keys(nextValue).length > 0 ? nextValue : undefined;
};
