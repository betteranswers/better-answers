export const refusalFor = <Refusal extends string>(
  error: Error,
  byConstraint: Readonly<Record<string, Refusal>>,
): Refusal | Error => {
  const constraint =
    "constraint" in error && typeof error.constraint === "string" ? error.constraint : "";
  const named = byConstraint[constraint];
  if (named !== undefined) return named;

  for (const [name, refusal] of Object.entries(byConstraint)) {
    if (error.message.includes(name)) return refusal;
  }
  return error;
};
