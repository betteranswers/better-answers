import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { createAppClients, Providers } from "./app/providers.tsx";
import { createAppRouter } from "./app/router.tsx";

import "./index.css";

const root = document.getElementById("root");
if (root === null) throw new Error("the page has no #root to mount into");

const clients = createAppClients();

createRoot(root).render(
  <StrictMode>
    <Providers clients={clients}>
      <RouterProvider router={createAppRouter(clients)} />
    </Providers>
  </StrictMode>,
);
