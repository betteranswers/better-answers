import type { Auth } from "./auth.ts";

export const mountedPaths = (auth: Auth): readonly string[] => {
  const paths = new Set<string>();
  for (const endpoint of Object.values<MountedEndpoint>(auth.api)) {
    if (typeof endpoint.path === "string") paths.add(endpoint.path);
  }
  return [...paths].sort();
};

type MountedEndpoint = { readonly path?: string };
