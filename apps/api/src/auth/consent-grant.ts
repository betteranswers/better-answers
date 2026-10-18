import { AsyncLocalStorage } from "node:async_hooks";

type Grant = { readonly drawn: string; moved: boolean };

/** The library hands its consent hook no request, and its body schema drops unknown fields. */
const grants = new AsyncLocalStorage<Grant>();

export const grantingFor = async <T>(
  drawn: string,
  work: () => Promise<T>,
): Promise<{ readonly answered: T; readonly moved: boolean }> => {
  const grant: Grant = { drawn, moved: false };
  const answered = await grants.run(grant, work);
  return { answered, moved: grant.moved };
};

export const grantLeftItsWorkspace = (consented: string | undefined): boolean => {
  const grant = grants.getStore();
  if (grant === undefined || grant.drawn === consented) return false;
  grant.moved = true;
  return true;
};
