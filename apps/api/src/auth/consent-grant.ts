import { AsyncLocalStorage } from "node:async_hooks";

/** The workspace a consent page drew, and whether the library found the session had left it. */
type Grant = { readonly drawn: string; moved: boolean };

/** The library hands its consent hook no request, and its body schema drops unknown fields. */
const grants = new AsyncLocalStorage<Grant>();

/** Runs the library's consent so its hook binds the grant to `drawn`. */
export const grantingFor = async <T>(
  drawn: string,
  work: () => Promise<T>,
): Promise<{ readonly answered: T; readonly moved: boolean }> => {
  const grant: Grant = { drawn, moved: false };
  const answered = await grants.run(grant, work);
  return { answered, moved: grant.moved };
};

/** Marks the grant moved, so the route can say why; false outside a grant from the consent page. */
export const grantLeftItsWorkspace = (consented: string | undefined): boolean => {
  const grant = grants.getStore();
  if (grant === undefined || grant.drawn === consented) return false;
  grant.moved = true;
  return true;
};
