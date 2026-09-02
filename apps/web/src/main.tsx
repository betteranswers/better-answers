import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { router } from "./app/router.tsx";
import "./index.css";

const root = document.getElementById("root");
if (root === null) throw new Error("the page has no #root to mount into");

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
