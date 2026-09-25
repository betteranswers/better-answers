import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render } from "@testing-library/react";

import { createAppClients, Providers, type AppClients } from "@/app/providers.tsx";
import { createAppRouter } from "@/app/router.tsx";

/** A router loaded at `path` and never rendered, so a test reads where it landed. */
export const appAt = async (path: string, clients: AppClients = createAppClients()) => {
  const router = createAppRouter(clients, createMemoryHistory({ initialEntries: [path] }));
  await router.load();
  return { router, clients };
};

/** The whole app rendered at `path` inside its providers; the caller unmounts it. */
export const openApp = async (path: string, clients: AppClients = createAppClients()) => {
  const { router } = await appAt(path, clients);
  const rendered = render(
    <Providers clients={clients}>
      <RouterProvider router={router} />
    </Providers>,
  );
  return { router, clients, rendered };
};
