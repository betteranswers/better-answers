import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { WorkspaceScreen } from "@/features/workspace/workspace-screen.tsx";
import "@/index.css";

const root = document.getElementById("root");
if (root === null) throw new Error("the page has no #root to mount into");
createRoot(root).render(
  <StrictMode>
    <WorkspaceScreen />
  </StrictMode>,
);
