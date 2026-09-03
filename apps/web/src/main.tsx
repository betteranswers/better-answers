import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Providers } from "./app/providers.tsx";
import { router } from "./app/router.tsx";
import "./index.css";

const root = document.getElementById("root");
if (root === null) throw new Error("the page has no #root to mount into");

createRoot(root).render(
  <StrictMode>
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  </StrictMode>,
);
