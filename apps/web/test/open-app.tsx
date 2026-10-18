import { RouterProvider, createMemoryHistory } from "@tanstack/react-router";
import { render } from "@testing-library/react";

import { createAppClients, Providers, type AppClients } from "@/app/providers.tsx";
import { createAppRouter } from "@/app/router.tsx";

export const appAt = async (path: string, clients: AppClients = createAppClients()) => {
  const router = createAppRouter(clients, createMemoryHistory({ initialEntries: [path] }));
  await router.load();
  return { router, clients };
};

export const openApp = async (path: string, clients: AppClients = createAppClients()) => {
  const { router } = await appAt(path, clients);
  const rendered = render(
    <Providers clients={clients}>
      <RouterProvider router={router} />
    </Providers>,
  );
  return { router, clients, rendered };
};
